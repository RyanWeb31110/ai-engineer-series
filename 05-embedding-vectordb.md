# Embedding 与向量数据库：AI 的长期记忆

> 搞懂这一块，你就明白 RAG 为什么有效，以及它在哪里会失败

---

你给 ChatGPT 发了一份 200 页的产品手册，然后问它"第 87 页说的退款政策是什么"，它大概率答不准——因为它根本没看到那份手册，那是你的私有数据，不在它的训练集里。

即便你把手册全文塞进 Context，超出 Context Window 怎么办？费用怎么算？

**Embedding 和向量数据库**解决的就是这个问题：把你的私有知识变成 AI 可以快速检索的"外部记忆"，让模型在需要的时候取用相关片段，而不是试图把所有内容都塞进 Context。

这是 RAG（检索增强生成）的基础，也是当前 AI 应用层最重要的工程能力之一。

---

## Embedding 是什么

**Embedding（嵌入）** 是把文本转换成一串浮点数向量的过程。

举个具体的例子：把"猫喜欢睡觉"这句话送进 embedding 模型，出来的是一个 1536 维的向量，大概长这样：

```
[0.0231, -0.1045, 0.0782, 0.0394, -0.0621, ...]  // 共 1536 个数字
```

这 1536 个数字不是随机的。embedding 模型（本质上也是一个神经网络）被训练成：**语义相近的文本，输出的向量在空间中距离也近**。

来看几个例子：

| 句子对 | 相似度 |
|--------|--------|
| "猫喜欢睡觉" vs "Cats love to sleep" | 0.93（非常相近） |
| "今天天气真好" vs "今日天空晴朗" | 0.91（语义几乎相同） |
| "今天天气真好" vs "机器学习是 AI 的分支" | 0.21（语义很远） |

**数字就是语义距离**。这是 embedding 最核心的特性：它把"是否相关"这个模糊的问题，变成了可以计算的数学问题。

### 用起来有多简单

```typescript
// embedding.ts 节选

async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}
```

一次 API 调用，输入字符串，输出向量数组。`text-embedding-3-small` 是 OpenAI 当前性价比最高的嵌入模型，每 100 万 Token 约 $0.02，比 GPT-4o 便宜几十倍。

### 余弦相似度：衡量向量距离

有了向量之后，如何判断两段文本是否相关？最常用的是**余弦相似度（Cosine Similarity）**：计算两个向量夹角的余弦值，范围是 [-1, 1]，越接近 1 表示越相似。

```typescript
// embedding.ts 节选

function cosineSimilarity(a: number[], b: number[]): number {
  // 点积除以两个向量的模的乘积
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return dot / (normA * normB)
}
```

实际中文本相似度通常在 [0, 1] 之间。经验上：
- 0.9 以上：几乎相同的意思
- 0.7~0.9：明显相关
- 0.5~0.7：有一定关联
- 0.5 以下：基本不相关

运行 `pnpm embed`，你会看到不同句子对之间的相似度计算结果，包括一个很有意思的测试：中文"猫喜欢睡觉"和英文"Cats love to sleep"的相似度高达 0.93——**embedding 模型天然支持跨语言语义对齐**，不需要翻译。

---

## 向量数据库：Embedding 的存储和检索引擎

单条文本的 embedding 已经很有用了，但真正的价值在于：**把大量文档全部 embed 后存起来，然后用向量相似度做快速检索**。这就是向量数据库的核心功能。

### 存储结构

向量数据库里，每条记录通常包含三部分：

```typescript
interface VectorRecord {
  id: string
  text: string        // 原始文本
  source: string      // 来源元数据（方便展示出处）
  embedding: number[] // 对应的向量
}
```

元数据（metadata）不只是 `source`，真实项目中可能还有：文档分类、创建时间、权限标签……这些字段可以在检索时做过滤，比如"只在技术文档里搜"。

### 检索逻辑

用户提问时，检索过程只有两步：

1. **把问题转成向量**（和存入时用同一个 embedding 模型）
2. **计算问题向量与所有存储向量的相似度，返回 Top-K**

**Top-K** 就是"相似度最高的前 K 条结果"，K 是你自己指定的数字。

类比搜索引擎：你搜东西，它不会把所有网页都返回，而是只给你最相关的前 10 条，这里的"前 10 条"就是 Top-10，K=10。

向量检索的道理完全一样：把所有文档向量和查询向量算一遍相似度，按分数从高到低排列，取前 K 条返回。

K 通常设 3~5。这些检索结果最终要拼进 LLM 的 Context，够用就好，太多反而稀释上下文质量。代码里 `search(queryEmbedding, 3)` 这个 `3` 就是 K。

```typescript
// vector-search.ts 节选

search(queryEmbedding: number[], topK: number = 3): SearchResult[] {
  const scored = this.records.map(record => ({
    record,
    score: cosineSimilarity(queryEmbedding, record.embedding),
  }))

  // 按相似度降序，取前 K 条
  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
```

这段代码实现的是**暴力全扫描**：对每条记录都算一次相似度。数据量小的时候完全够用，但如果有几百万条记录，就需要用到向量数据库的核心能力：**ANN（Approximate Nearest Neighbor，近似最近邻）索引**。

ANN 牺牲一点精度，换取大幅提升的检索速度，百万级数据下毫秒级返回。Qdrant、Pinecone、Weaviate 等产品的核心价值正在这里。

### 代码实战：从文档到问答

`vector-search.ts` 展示了一个完整的小型 RAG 流程：

**第一步：构建索引**

把 8 篇产品文档全部 embed，存入内存向量数据库：

```typescript
// vector-search.ts 节选

async function buildIndex(db: InMemoryVectorDB): Promise<void> {
  for (const doc of KNOWLEDGE_DOCS) {
    const embedding = await embed(doc.text)
    db.insert({ ...doc, embedding })
  }
  console.log(`索引构建完成，共 ${db.size()} 条记录`)
}
```

**第二步：检索 + 问答**

用户提问时，先检索最相关的 3 条文档，再把文档内容拼进 prompt 给 LLM：

```typescript
// vector-search.ts 节选

async function ragQuery(db: InMemoryVectorDB, question: string): Promise<void> {
  // 把问题转成向量，检索 Top-3 文档
  const queryEmbedding = await embed(question)
  const results = db.search(queryEmbedding, 3)

  // 把检索结果拼成上下文
  const context = results.map(({ record }) =>
    `[${record.source}]\n${record.text}`
  ).join('\n\n')

  // 带上下文调用 LLM
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `你是 SmartBot 的智能助手。请根据以下知识库内容回答问题。\n\n知识库内容：\n${context}`,
      },
      { role: 'user', content: question },
    ],
  })
}
```

运行 `pnpm search`，终端会打出每个问题的检索过程（带相似度分数）和最终回答：

```
用户问题: SmartBot 是怎么保证回答准确的？

检索结果（按相似度排序）:
  [0.8923] [技术文档] SmartBot 使用 RAG（检索增强生成）架构。用户提问时...
  [0.7512] [产品介绍] SmartBot 是一款基于大语言模型的智能客服系统...
  [0.6834] [常见问题] 如果 SmartBot 回答不准确，可能是知识库内容过时...

助手: SmartBot 通过 RAG 架构保证回答准确性：用户提问时，系统先从向量
数据库中检索相关知识文档，再将检索结果和问题一起传给 LLM...
```

---

## 主流向量数据库选型

做产品用的话，内存数组当然不够，需要专门的向量数据库。几个常见选项：

| 数据库 | 定位 | 特点 |
|--------|------|------|
| **Qdrant** | 开源，可自托管 | Rust 编写，性能好，支持私有化部署，国内团队常用 |
| **Pinecone** | 云服务 | 全托管，接入简单，适合快速验证 |
| **Weaviate** | 开源，可自托管 | 内置多模态支持，GraphQL 查询接口 |
| **pgvector** | PostgreSQL 扩展 | 已有 PG 的团队可以直接加，不用引入新组件 |
| **Chroma** | 开源 | 轻量，适合本地开发和原型 |

**选型建议：**
- 快速验证原型：Chroma 本地运行，零配置
- 生产部署，需要数据主权：Qdrant 自托管
- 已有 PostgreSQL 且数据量不大：pgvector
- 不想管基础设施：Pinecone 托管服务

不同向量数据库的 API 写法有差异，但核心操作都是三个：**upsert（写入）、search（检索）、delete（删除）**。切换数据库只是换 SDK，核心逻辑不变。

---

## 踩坑与最佳实践

### 1. Embedding 模型要前后一致

构建索引用什么 embedding 模型，检索时就必须用同一个模型。这是很基础的规则，但实际出过很多问题：比如最开始用 `text-embedding-ada-002`，后来想切换到 `text-embedding-3-small`，结果忘记重新 embed 历史数据，查出来的结果全是乱的。

**工程实践：把 embedding 模型名称作为索引的元数据存起来**，每次检索前校验一致性。

### 2. 文本分块的粒度很关键

一篇 5000 字的文档，直接 embed 成一个向量，精度会很差，因为向量需要"压缩"太多信息，语义会稀释。更好的做法是把文档切成合理大小的块（Chunk），每块单独 embed。

**粒度经验：**
- 太小（< 100 字）：单个 chunk 缺乏上下文，检索出来模型看不懂
- 太大（> 800 字）：语义稀释，相似度计算不准
- 推荐：200~500 字左右，或者按段落/小节切割

分块策略（Chunking）是 RAG 里的重要议题，会在下一篇 RAG 实战里详细展开。

### 3. 相似度分数需要设门槛

`search()` 返回的始终是"最相似的 K 条"，但不代表真的相关。如果用户问的问题知识库里根本没有，`search()` 还是会返回分数最高的几条——只不过分数很低。

**工程实践：加一个最低分数门槛（threshold）**，低于门槛就不喂给 LLM，而是直接回答"这个问题我没有相关资料"：

```typescript
const results = db.search(queryEmbedding, 3).filter(r => r.score > 0.6)
if (results.length === 0) {
  return '这个问题我暂时没有相关资料，建议咨询人工客服。'
}
```

门槛值需要根据实际场景调试，通常在 0.5~0.7 之间。

### 4. 向量检索不等于精确匹配

向量检索是语义匹配，不是关键词匹配。这有好处（同义词能找到），也有陷阱：

- 用户问"张三的手机号"，如果知识库里的文档没有提到张三，向量检索会返回最"语义相关"的文档（比如某个员工通讯录的片段），但不包含张三的信息。模型可能会基于这个不相关的上下文编造一个答案。
- 精确数字、代码、型号等内容，向量检索不可靠。这类场景需要配合传统关键词搜索（BM25 等），也就是**混合检索（Hybrid Search）**，这个会在 RAG 进阶章节介绍。

### 5. 索引构建不要用无脑并发

批量 embed 大量文档时，一次性并发几千个请求会触发 API 限流。推荐用批次处理：

```typescript
// 每次处理 20 条，避免超过 API 速率限制
const BATCH_SIZE = 20
for (let i = 0; i < docs.length; i += BATCH_SIZE) {
  const batch = docs.slice(i, i + BATCH_SIZE)
  await Promise.all(batch.map(async doc => {
    doc.embedding = await embed(doc.text)
    db.insert(doc)
  }))
}
```

---

## 小结

- **Embedding** 把文本转成向量，语义相近的文本向量距离也近，余弦相似度是衡量语义相关性的标准方式
- **向量数据库**存储文本和对应向量，检索时把查询转成向量，找出最相似的 Top-K 条文档；生产环境用 ANN 索引解决大规模检索的性能问题
- **工程重点**：embedding 模型保持一致、文本分块粒度适中、检索结果加相似度门槛过滤噪声

有了 Embedding 和向量检索，AI 就有了"外部记忆"。下一篇直接上手 RAG 全流程：如何把文档导入、如何做检索、如何让模型给出可靠的答案，以及常见的失效模式和修复方法。

---

**下一篇**：RAG 实战：给 AI 接上你的私有知识库

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 05 篇*
