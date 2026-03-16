# RAG 进阶：Chunking、Hybrid Search、Reranking

> 基础 RAG 跑通了，但回答质量还不够好，这三个方向能帮你系统性地提升

---

上一篇把 RAG 的三阶段流程跑通了：Indexing → Retrieval → Generation。这套基础流程处理小型知识库没问题，但一旦文档量上去，或者问题变复杂，你会发现几个共同症状：

- 用户问的问题和文档里的表述不一样，检索就找不到（词汇不匹配）
- 同一个问题，在两篇文档里分别有半段答案，但检索只拿到了一篇
- 检索到的文档和问题有关，但是中间夹着一堆废话，LLM 的回答跑偏了

这三个问题分别对应 RAG 进阶的三个方向：**Chunking 策略**、**Hybrid Search（混合检索）** 和 **Reranking（重排序）**。这篇逐一拆解。

---

## Chunking：分块策略的学问

### 为什么硬切不行

最简单的分块方式是按字数硬切：每 500 字一块，结束。这在基础 RAG 里能用，但在实际项目里会遇到一个经典问题：**语义被割断**。

```
第 499 字：退款申请被自动批准后，会
第 500 字（下一块开头）：在 24 小时内通知用户，并原路退款。
```

上面这个 chunk 单独拿出来，LLM 完全不知道在说什么。更隐蔽的问题是：如果用户问「退款多久到账」，检索系统拿到的 chunk 里有「24 小时」但没有完整上下文，LLM 给出的答案可能是完整的，也可能是半截的。

### 三种主流分块策略

**策略一：固定大小 + 滑动窗口**

在固定大小切块的基础上，加上 **Overlap（重叠）**：每两个相邻的 chunk 共享一定比例的文字。

```
文档原文：A B C D E F G H I J K
Chunk 1：A B C D E（size=5）
Chunk 2：D E F G H（size=5，overlap=2）
Chunk 3：G H I J K（size=5，overlap=2）
```

这样即使语义跨越了两个 chunk 的边界，用户也能检索到包含完整上下文的那块。

实践参数：chunk size 400~600 字，overlap 约 15~20%（50~100 字）。

**策略二：语义分块（Semantic Chunking）**

不按字数切，而是按**语义边界**切：段落、小节、列表项。Markdown 文档按 `##` 标题切，PDF 按分页或章节切，HTML 按语义标签切。

```typescript
// 按 Markdown 标题切块的简单实现
function splitByHeadings(markdown: string): string[] {
  // 以 ## 开头的行作为切割点
  return markdown.split(/(?=^#{1,3}\s)/m).filter(chunk => chunk.trim().length > 0)
}
```

这种方式的好处：chunk 边界天然和文档结构对齐，语义完整。坏处：不同小节长度差异大，短的小节信息量不足，太长的小节又稀释了语义。

**策略三：父子 Chunk（Parent-Child Chunking）**

这是目前效果最好的策略之一，思路是：**用小 chunk 做检索，用大 chunk 做生成**。

具体做法：把文档切成两个粒度：
1. **父 chunk**（500~1000 字）：保留足够的上下文
2. **子 chunk**（100~200 字）：细粒度，用来 embed 和检索

检索阶段用子 chunk 匹配问题（粒度细，相似度精准）；命中子 chunk 后，返回它所属的父 chunk 给 LLM（上下文充分）。

```
父 chunk：整个「退款说明」小节（600 字）
  子 chunk 1：「申请条件」（150 字）
  子 chunk 2：「处理流程」（180 字）
  子 chunk 3：「到账时间」（120 字）

用户问「退款多久到账」
→ 检索命中子 chunk 3（相似度高，语义精准）
→ 返回父 chunk 给 LLM（完整的退款说明，600 字）
```

这样既保证了检索精度，也保证了 LLM 拿到的上下文足够丰富。

### Chunk 大小和 embedding 维度的关系

chunk 太小，一个向量要"压缩"的语义太少，相似度计算准；chunk 太大，信息密度过高，相似度反而下降。

一个粗略的经验：
- `text-embedding-3-small`（1536 维）：chunk 建议 300~600 字
- `text-embedding-3-large`（3072 维）：可以接受更大的 chunk（500~1000 字）

---

## Hybrid Search：关键词 + 向量，一起上

### 向量检索的盲区

向量检索（语义检索）很强，但有一个天然的弱点：**对专有名词、精确词语的检索不够可靠**。

举例：用户问「API 返回 ERR_QUOTA_EXCEEDED 怎么解决」，知识库里有一篇文章标题叫「错误码说明」，里面有 `ERR_QUOTA_EXCEEDED` 的详细解释。

但「ERR_QUOTA_EXCEEDED」这个字符串和「错误码说明」的语义距离不近——向量空间里，错误码字符串的 embedding 和文章标题的 embedding 相似度并不高。如果单靠向量检索，这篇文档很可能排名靠后甚至被过滤掉。

这就是 **BM25（关键词检索）** 的用武之地。

### BM25：老但管用的关键词算法

**BM25（Best Match 25）** 是一个经典的信息检索算法，本质是统计词频：问题中的词在文档里出现次数越多、文档越短，分数越高。

它解决的核心问题是：**精确词语的匹配**。错误码、型号、版本号、专有名词、缩写，这些 BM25 都比向量检索准。

BM25 的不足：只看词语，不理解语义。比如「恢复账号」和「找回密码」，语义高度相关，但 BM25 完全无法识别。

### 混合检索：两种分数合并

**Hybrid Search** 的做法很直接：同时跑向量检索和 BM25 检索，然后把两组结果的分数合并排序。

合并方式最常用的是 **RRF（Reciprocal Rank Fusion，倒数排名融合）**：

```typescript
// RRF 合并两组检索结果
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  bm25Results: SearchResult[],
  k: number = 60  // 平滑参数，通常取 60
): SearchResult[] {
  const scores = new Map<string, number>()

  // 把每个结果的排名转成倒数分数
  const addRanks = (results: SearchResult[]) => {
    results.forEach((result, index) => {
      const current = scores.get(result.id) ?? 0
      scores.set(result.id, current + 1 / (k + index + 1))
    })
  }

  addRanks(vectorResults)
  addRanks(bm25Results)

  // 按 RRF 分数重排
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }))
}
```

RRF 的好处：不需要对两种检索的原始分数做归一化（向量相似度是 0~1，BM25 分数是任意正数），直接用排名来合并，简单可靠。

### 实际效果对比

以下是同一个问题在三种检索策略下的结果对比（知识库包含 API 文档、错误码说明、部署手册）：

| 问题 | 向量检索 Top-1 | BM25 Top-1 | 混合检索 Top-1 |
|------|--------------|-----------|--------------|
| 「429 错误怎么解决」 | 限流规则 ✓ | 错误码说明 ✓ | 错误码说明 ✓ |
| 「内存不够怎么办」 | 部署手册 ✓ | 系统配置 ✓ | 部署手册 ✓ |
| `ERR_QUOTA_EXCEEDED` | 计费说明 ✗ | 错误码说明 ✓ | 错误码说明 ✓ |
| 「怎么申请退款」 | 计费说明 ✓ | 发票退款 ✓ | 计费说明 ✓ |

可以看到，精确错误码的查询，向量检索排错了，BM25 和混合检索都命中了正确文档。而语义相关的查询，两种方式都能找到，混合检索不会比单独的向量检索差。

Qdrant、Weaviate、ElasticSearch 等主流向量数据库都已内置了 Hybrid Search 支持，一般只需要在检索接口里开启一个参数即可。

---

## Reranking：在精度上再进一步

### 检索和排序是两回事

向量检索（包括混合检索）做的是**候选筛选**：从几千万条文档里快速找出可能相关的 Top-50。速度是首要目标。

**Reranking（重排序）** 做的是**精排**：对这 50 条候选文档，更精细地评估每条和问题的相关程度，重新排序，最后只取 Top-3 给 LLM。

两步的计算量不同：向量检索用的是向量点积（极快），Reranker 用的是 **Cross-Encoder（交叉编码器）**，把问题和文档拼在一起，用 BERT 类模型输出一个相关性分数（慢但准）。

### Cross-Encoder vs Bi-Encoder

普通的向量检索模型是 **Bi-Encoder（双编码器）**：问题和文档**分别** embed，然后算相似度。速度快，但问题 embedding 和文档 embedding 是在没有互相「看到」对方的情况下生成的，相关性判断有损。

**Cross-Encoder（交叉编码器）** 把问题和文档拼成一对，**一起**输入模型，输出的分数反映的是两者在语义上真正的契合程度。更准，但每对 (问题, 文档) 都要算一次，不能提前缓存，只适合做精排。

```
Bi-Encoder 流程：
  embed(问题) → 向量 A
  embed(文档) → 向量 B
  score = cosine(A, B)   ← 两者没有直接交互

Cross-Encoder 流程：
  score = model([CLS] 问题 [SEP] 文档 [SEP])   ← 两者一起处理，有完整的 attention 交互
```

### Reranking 的实际效果

以下是一个典型场景：

```
用户问题：「怎么申请发票」

向量检索 Top-5（顺序按相似度）：
  [0.71] 计费说明-套餐对比
  [0.68] 发票与退款处理
  [0.65] 账号管理-企业认证
  [0.61] API 计费规则
  [0.58] 合同与协议说明

Reranking 后 Top-3：
  [0.94] 发票与退款处理        ← 从第 2 位升到第 1 位
  [0.72] 合同与协议说明        ← 从第 5 位升到第 2 位
  [0.51] 计费说明-套餐对比     ← 从第 1 位降到第 3 位
```

「发票与退款处理」本来被「计费说明-套餐对比」压住了（因为「计费」和「发票」在向量空间里距离近），Reranker 把两者拼在一起评估后，发现「发票与退款处理」才是真正的相关文档，把它推到第一位。

### 常用的 Reranker 选择

| 方案 | 特点 |
|------|------|
| Cohere Rerank API | 商业 API，直接调用，效果好，有免费额度 |
| BGE Reranker（BAAI/bge-reranker-v2-m3） | 开源模型，中英文都不错，可本地部署 |
| Jina Reranker | 开源 + API 双模式，中文支持好 |

生产环境建议：先用 Cohere Rerank API 快速验证效果，确认提升明显后再考虑本地部署开源模型降低成本。

---

## 代码实战

`07-rag-advanced/src/` 目录下包含三个模块，对应本篇三个核心主题：

**`chunking.ts`：分块策略对比**

```typescript
// 三种分块策略的实现，可以直接对比效果

// 固定大小 + 滑动窗口
export function chunkWithOverlap(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap  // 下一块从 (start + size - overlap) 开始
  }
  return chunks
}

// 按 Markdown 标题语义切块
export function chunkByMarkdownHeadings(markdown: string): string[] {
  return markdown.split(/(?=^#{1,3}\s)/m).filter(chunk => chunk.trim().length > 50)
}

// 父子 chunk 构建
export function buildParentChildChunks(text: string): ParentChildChunk[] {
  const parents = chunkWithOverlap(text, 600, 0)    // 父 chunk：600 字，无重叠
  return parents.map(parent => ({
    parent,
    children: chunkWithOverlap(parent, 150, 20),    // 子 chunk：150 字，overlap 20
  }))
}
```

运行 `pnpm chunking` 可以看到同一篇文档用三种策略切出来的结果对比，以及每种策略的 chunk 数量和平均长度。

**`hybrid-search.ts`：混合检索**

```typescript
// 同时跑向量检索和 BM25，用 RRF 合并结果
export async function hybridSearch(
  query: string,
  topK: number = 5
): Promise<HybridSearchResult[]> {
  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(query, topK * 2),   // 候选扩大一倍，留给 RRF 合并
    bm25Search(query, topK * 2),
  ])

  return reciprocalRankFusion(vectorResults, bm25Results).slice(0, topK)
}
```

运行 `pnpm hybrid-search` 会跑一组对比测试：包含普通语义问题和精确错误码查询，直观展示向量检索、BM25、混合检索三种方式的命中差异。

**`reranking.ts`：Reranker 精排**

```typescript
// 先用混合检索取 Top-20，再用 Reranker 精排到 Top-3
export async function retrieveWithReranking(query: string): Promise<RerankResult[]> {
  // 第一步：粗排，取候选集
  const candidates = await hybridSearch(query, 20)

  // 第二步：精排（调用 Cohere Rerank API）
  const reranked = await rerankWithCohere(query, candidates)

  return reranked.slice(0, 3)  // 最终只给 LLM 3 条
}
```

运行 `pnpm reranking` 可以看到 Reranker 前后的排序变化，以及最终给 LLM 的文档质量对比。

---

## 踩坑与最佳实践

### 1. 先从 Chunking 入手，不要上来就加复杂组件

RAG 效果差的时候，按顺序排查：Chunking → Retrieval → Reranking。Chunking 策略改善了问题，就不需要上 Reranker；向量检索就够了，就不需要上混合检索。

每加一个组件，就多一个需要调优的参数和潜在的故障点。从最简单的方案开始，能解决问题就停下来。

### 2. Overlap 不是越大越好

Overlap 大了，相邻 chunk 之间重复内容多，向量库里存了大量近似重复的文档。检索时这些重复文档会互相竞争 Top-K 的名额，实际上减少了有效结果的多样性。

经验：overlap 控制在 chunk size 的 10%~20% 之间。

### 3. 混合检索的权重调不好，不如不加

BM25 分数和向量相似度的量级不同，如果直接加权平均，而不是用 RRF，很容易一种信号完全淹没另一种。

建议直接用 RRF，参数 k=60 是行业默认值，大多数场景不需要改。如果一定要调权重，先把两种信号的分数分布打印出来，做好归一化再加权。

### 4. Reranker 要加超时保护

Cross-Encoder 的计算比向量检索慢 10~50 倍。如果候选集很大（100+ 条）或者网络问题导致 Reranker API 超时，整个检索链路会卡死。

工程实践：Reranker 调用加 timeout（建议 2~3 秒），超时时降级用混合检索的原始排序结果，不要让精排失败影响整体可用性。

### 5. 重排序和生成分开评估

加了 Reranker 之后，评估要分层：
- **检索评估（Recall@K）**：候选集里有没有正确答案？
- **精排评估（NDCG/MRR）**：正确答案是否排在前面？
- **端到端评估**：最终回答质量怎么样？

不要只看端到端指标，那样无法判断是哪个环节在起作用（或不起作用）。RAGAS 框架提供了这套分层评估体系，会在第 18 篇详细介绍。

---

## 小结

- **Chunking 策略**决定了你的知识库质量：固定大小 + Overlap 解决边界问题，语义分块保持结构完整性，父子 Chunk 是效果最好的进阶方案
- **Hybrid Search** 结合了向量检索（理解语义）和 BM25（匹配精确词语）的优势，用 RRF 合并两组结果，对专有名词和错误码类查询提升明显
- **Reranking** 是在粗排候选集上做精排，Cross-Encoder 直接对问题+文档做交互编码，能把排序精度再推高一个台阶；但它会增加延迟，需要加超时保护

这三个方向可以按需叠加，但每加一层都要验证它真的带来了提升。RAG 的优化不是堆砌技术栈，而是找到当前链路的瓶颈，精准改善。

---

**下一篇**：ReAct：让 AI 学会边想边做

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 07 篇*
