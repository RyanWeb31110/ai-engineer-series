# RAG 实战：给 AI 接上你的私有知识库

> 三个阶段，一条流水线，把你的文档变成 AI 可以回答的知识

---

你搭了个 AI 助手，测试时表现不错。但上线第一天，用户就问了一个你们内部系统的问题，AI 给了一个听起来合理但完全错误的答案。

这不是模型太笨，而是它根本不知道你的私有数据。LLM 的训练知识截止到某个时间点，你的公司文档、产品手册、内部 FAQ，它一条都没见过。

**RAG（Retrieval-Augmented Generation，检索增强生成）** 解决的就是这个问题。原理直接：用户提问时，先从你的私有知识库里找相关文档，把找到的内容连同问题一起发给 LLM，让它基于这些内容回答。

上一篇介绍了 Embedding 和向量数据库的原理，这篇直接上实战：把 RAG 拆成三个阶段，逐一搞清楚每个阶段在做什么、有哪些坑。

---

## RAG 的三个阶段

RAG 的完整流程可以拆成三个独立阶段，理解这个分法很重要，因为三个阶段的优化方向完全不同：

```
Indexing（索引构建）  →  Retrieval（检索）  →  Generation（生成）
文档处理 / 向量化            向量搜索                 LLM 问答
一次性操作（离线）           每次查询都执行             每次查询都执行
```

**Indexing** 是预处理阶段，把你的文档切成合适大小的片段（Chunk），每个 Chunk 用 Embedding 模型转成向量，存入向量数据库。这个操作只做一次，文档更新时增量追加就好。

**Retrieval** 是每次用户提问时执行的：把问题也转成向量，和知识库里的所有向量算相似度，取最相关的前几条（Top-K）。

**Generation** 是最后一步：把检索到的文档内容格式化成上下文，和用户问题一起发给 LLM，让它基于这些内容生成回答。

---

## Indexing：文档入库

### 分块策略

把文档 embed 成一整个向量，精度很差。原因：一篇 5000 字的文档需要用一个 1536 维的向量"压缩"所有信息，语义会严重稀释，检索时匹配精度大幅下降。

正确做法是先切块（Chunking），每块 200-500 字，单独 embed。

分块粒度的经验：

| Chunk 大小 | 问题 |
|-----------|------|
| < 100 字 | 上下文太少，LLM 看不懂片段 |
| 200~500 字 | 推荐范围 |
| > 800 字 | 语义稀释，相似度计算不准 |

项目里的知识库（`knowledge-docs.ts`）已经预先切好了 chunk，每条大约 100-200 字，覆盖部署手册、API 文档、故障排查、计费说明四个类别：

```typescript
// knowledge-docs.ts 节选

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    id: 'deploy-001',
    category: '部署手册',
    title: '系统最低配置要求',
    content: '生产环境最低配置：4 核 CPU、16GB 内存、100GB SSD 存储...',
  },
  {
    id: 'api-002',
    category: 'API 文档',
    title: '限流规则',
    content: '默认限流：每个 API Key 每分钟最多 60 次请求（RPM）...',
  },
  // ... 共 10 条文档
]
```

### 批量 Embed

有了分好的 chunk，逐条调用 Embedding API：

```typescript
// build-index.ts 节选

export async function buildIndex(db: InMemoryVectorDB): Promise<void> {
  const BATCH_SIZE = 5 // 每批 5 条，避免触发 API 速率限制

  for (let i = 0; i < KNOWLEDGE_DOCS.length; i += BATCH_SIZE) {
    const batch = KNOWLEDGE_DOCS.slice(i, i + BATCH_SIZE)

    // 批内并发 embed
    await Promise.all(
      batch.map(async (doc: KnowledgeDoc) => {
        const embedding = await embed(doc.content)
        db.insert({ ...doc, embedding })
        process.stdout.write('.')
      })
    )
  }

  console.log(`\n索引构建完成，共 ${db.size()} 条记录`)
}
```

注意这里用了两层循环：外层按批次，内层批内并发。如果一次性并发几百个请求，大概率触发 API 限流（429）。

运行 `pnpm build-index`，可以看到每个类别下的文档清单——这就是你的知识库索引。

---

## Retrieval：向量检索

### 相似度门槛是关键

检索的核心代码很简单，上一篇已经介绍过：把问题 embed 成向量，对知识库里的所有记录算余弦相似度，取 Top-K：

```typescript
// build-index.ts 节选

search(queryEmbedding: number[], topK: number = 3, threshold: number = 0.15): SearchResult[] {
  return this.records
    .map(record => ({ record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
    .filter(result => result.score >= threshold)  // 过滤低相关结果
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
```

这里有一个很容易忽略的细节：**相似度门槛（threshold）**。

`search()` 不设门槛的话，永远会返回"最相似的 K 条"，哪怕这 K 条和问题完全无关。比如用户问了一个知识库里根本没有的问题，`search()` 还是会返回一些看起来相关但实际上是"凑数"的文档。LLM 拿到这些内容，要么给出错误答案，要么出现幻觉。

**加了门槛之后的效果对比：**

```
问题: "支持微信支付吗？"（知识库中没有这个信息）

未过滤（Top-5）：
  ✓ [0.1818] [计费说明] 套餐对比
  ✓ [0.1623] [计费说明] 发票与退款
  ✗ [0.0979] [部署手册] 系统最低配置要求
  ✗ [0.0714] [API 文档] 限流规则
  ✗ [0.0596] [API 文档] 错误码说明

过滤后（threshold=0.15，保留 2 条）：
  → LLM 拿到计费文档，但知识库里没有微信支付信息，正确回答"超出知识库范围"
```

门槛值和所用的 embedding 方案密切相关：神经网络模型（OpenAI `text-embedding-3-small`）的余弦相似度通常在 0.5~0.9 之间，可以设 0.6；本地 TF-IDF 方案的分数范围更低（0.15~0.5），需要对应调整。**换了 embedding 方案，记得重新标定门槛值**。

### 如何确认检索质量

检索阶段是整个 RAG 链路中最容易出问题的地方。回答质量差，70% 的情况是检索出了问题，不是 LLM 的锅。

调试检索质量的方法：**打印相似度分数**。

`rag-query.ts` 每次检索都会打印带分数的结果：

```
问题: "遇到 429 错误怎么办？"

向量检索结果（相似度 ≥ 0.15，共 1 条）:
  [0.5303] [API 文档] 错误码说明
```

看到这个输出，马上就能判断检索是否命中了正确文档。如果检索结果明显不对，说明是 Chunking 策略或者相似度门槛有问题，而不是 LLM 的问题。

---

## Generation：让 LLM 基于文档回答

### System Prompt 的写法

检索到了相关文档，怎么组织 prompt 让 LLM 给出好答案？

`rag-query.ts` 里用的 system prompt 有几个要点：

```typescript
// rag-query.ts 节选

const SYSTEM_PROMPT_TEMPLATE = (context: string) => `你是一个技术支持助手，专门解答关于我们平台的问题。

请严格根据以下知识库内容回答用户问题：
- 如果知识库中有明确答案，直接引用相关内容回答
- 如果知识库中没有相关信息，回答"这个问题超出了我的知识库范围，建议联系技术支持"
- 不要凭空推断或编造不在知识库中的内容
- 回答结束后，用"参考来源：[文档分类] 文档标题"格式标注出处

知识库内容：
${context}`
```

几个关键点：
1. **明确边界**：告诉模型只能用知识库内容，不能推断
2. **处理未命中**：给模型一个明确的"没有答案时该说什么"指令
3. **要求引用来源**：方便用户核实，也方便你调试

### 完整的调用流程

把三个阶段串起来，就是每次 RAG 查询的完整代码：

```typescript
// rag-query.ts 节选

async function ragQuery(db: InMemoryVectorDB, question: string): Promise<void> {
  // 步骤 1：问题 → 向量
  const queryEmbedding = embed(question)

  // 步骤 2：向量检索（带相似度门槛）
  const results = db.search(queryEmbedding, 3, 0.15)

  // 步骤 3：没有检索结果，直接拒绝
  if (results.length === 0) {
    console.log('回答: 这个问题超出了我的知识库范围，建议联系技术支持。')
    return
  }

  // 步骤 4：格式化检索结果
  const context = results
    .map(({ record }) => `[${record.category}] ${record.title}\n${record.content}`)
    .join('\n\n---\n\n')

  // 步骤 5：带上下文调用 LLM
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_TEMPLATE(context) },
      { role: 'user', content: question },
    ],
  })

  console.log(`回答:\n${response.choices[0].message.content}`)
}
```

运行 `pnpm query`，可以看到 5 个测试问题的完整输出：4 个在知识库范围内的问题会给出带来源的答案，最后一个"支持微信支付吗"虽然检索到了计费相关文档，但 LLM 正确识别出知识库里没有微信支付信息，回答"超出知识库范围"。

---

## 踩坑与最佳实践

### 1. 先调查检索，再怪 LLM

RAG 系统回答质量差，第一反应不是换更贵的模型，而是检查检索阶段：

- 打印检索结果的相似度分数
- 确认命中的文档是不是真的相关
- 分数普遍低（< 0.5）：说明知识库覆盖不足，需要补充文档
- 分数还行（0.6+）但回答错：才可能是 LLM 的问题

三个阶段独立调试，排查问题会快很多。

### 2. Embedding 方案选定后不要随意换

配套代码用的是本地 TF-IDF 方案（零依赖，无需 API key），生产环境可以替换为 OpenAI `text-embedding-3-small`，只需把 `build-index.ts` 里的 `embed()` 函数改成 API 调用即可，其余 RAG 逻辑完全不变。

但有一个规则：**构建索引和检索时必须用同一套 embedding 方案**。比如索引用 `text-embedding-ada-002` 构建，后来切换成 `text-embedding-3-small`，旧向量全部作废，必须重建索引。

实践建议：把 embedding 方案版本存进知识库的元数据里，每次检索前做一致性校验。

### 3. Context 别塞太多

Top-K 的 K 设多少合适？不是越多越好。

每条检索结果都会占用 LLM 的 Context 空间，K 设太大会稀释有效信息（「Lost in the Middle」问题：模型对 Context 中间部分的注意力较弱）。通常 K=3 是个好起点，如果发现漏掉了相关文档再适当调高。

### 4. 知识库要定期更新

知识库是静态的，产品文档在持续迭代。如果知识库 6 个月没更新，用户问最新功能的问题，AI 会基于旧文档回答——这比直接说"不知道"更危险。

建议做增量更新机制：文档变动时，自动触发对应 chunk 的重新 embed 和入库。

### 5. Chunking 的边界要有语义

按固定字数硬切，可能会把一段完整的内容切断。比如：

```
第 499 字：退款申请被自动处理后，会
第 500 字（下一个 chunk 开头）：在 24 小时内通知用户...
```

上面这个 chunk 单独看，完全不知道在说什么。

更好的做法：按段落或小节切割，保持语义完整性。这也是 RAG 进阶中 Chunking 策略要解决的核心问题，下一篇会详细展开。

---

## 小结

- **三个阶段各自独立**：Indexing（建索引）是一次性操作，Retrieval（检索）和 Generation（生成）每次查询都执行；调试时要分阶段排查，不要把检索问题归咎于 LLM
- **相似度门槛不可少**：没有门槛的检索会把不相关内容喂给 LLM，是引入幻觉的主要原因之一；门槛值要根据 embedding 方案标定（神经网络模型约 0.6，TF-IDF 方案约 0.15），换方案时必须重新调整
- **System prompt 要明确边界**：告诉模型只能用知识库内容、没有信息时如何回答，是防止 RAG 胡说的关键

基础 RAG 流程到这里已经完整了。真实项目中，这条流水线还有很多优化空间：文档分块策略、关键词搜索和向量搜索的混合检索、检索结果的重排序……这些放在下一篇 RAG 进阶里逐一展开。

---

**下一篇**：RAG 进阶：Chunking、Hybrid Search、Reranking

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 06 篇*
