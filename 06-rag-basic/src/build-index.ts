/**
 * RAG 知识库索引构建
 *
 * 演示：把一批文档 chunk embed 后，存入内存向量数据库，
 * 模拟"知识库初始化"这个一次性操作。
 *
 * 真实场景下，这里会对接 Qdrant / Pinecone，把向量持久化。
 *
 * Embedding 方案：
 *   本地演示：TF-IDF 稀疏向量（零依赖，无需网络，可直接运行）
 *   生产替换：把 embed() 换成 OpenAI API 调用即可，其余 RAG 逻辑完全不变：
 *     const response = await client.embeddings.create({ model: 'text-embedding-3-small', input: text })
 *     return response.data[0].embedding
 *
 * 运行：pnpm build-index
 */

import { KNOWLEDGE_DOCS, type KnowledgeDoc } from './knowledge-docs.js'

// ─── TF-IDF Embedding（本地实现）──────────────────────────────────────────────

/**
 * 中英文混合分词：
 * - 英文/数字：按空格和标点分割，过滤单字符
 * - 中文：用 bigram（相邻两个汉字组成 token），兼顾词义和召回率
 *
 * 生产环境建议用 jieba 等专业中文分词库，精度更高。
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()

  // 提取英文单词和数字（长度 > 1）
  const enTokens = lower.match(/[a-z0-9][a-z0-9]*/g) ?? []
  tokens.push(...enTokens.filter(t => t.length > 1))

  // 提取中文字符，做 bigram 切割
  const zhChars = lower.match(/[\u4e00-\u9fa5]+/g) ?? []
  for (const segment of zhChars) {
    // 单字也保留（有语义价值的单字，如"退款"中的"退"）
    if (segment.length === 1) {
      tokens.push(segment)
    } else {
      // 滑动窗口 bigram
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2))
      }
      // 也加入独立字符，提升单字查询的召回
      for (const ch of segment) {
        tokens.push(ch)
      }
    }
  }

  return tokens
}

/**
 * 计算 TF（词频）：某词在当前文档中出现的频率
 */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  // 归一化为频率
  for (const [t, count] of tf) {
    tf.set(t, count / tokens.length)
  }
  return tf
}

/**
 * 计算 IDF（逆文档频率）：词在越少文档中出现，IDF 越高（越有区分度）
 * IDF(t) = log((N + 1) / (df(t) + 1)) + 1  —— 带平滑的标准公式
 */
function computeIDF(allTokenSets: string[][]): Map<string, number> {
  const N = allTokenSets.length
  const df = new Map<string, number>() // 文档频率

  for (const tokens of allTokenSets) {
    const unique = new Set(tokens)
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  for (const [t, count] of df) {
    idf.set(t, Math.log((N + 1) / (count + 1)) + 1)
  }
  return idf
}

/**
 * TF-IDF Embedder：维护全局词汇表和 IDF，把文本转成固定维度的 TF-IDF 向量。
 *
 * 流程：
 *  1. fit(docs)：统计全局 IDF，建立词汇表（词 → 向量维度下标）
 *  2. embed(text)：计算文本的 TF-IDF 向量
 */
class TFIDFEmbedder {
  private vocab: Map<string, number> = new Map() // 词 → 向量下标
  private idf: Map<string, number> = new Map()
  private dim: number = 0

  /** 用语料库拟合，建立词汇表和 IDF */
  fit(docs: string[]): void {
    const allTokenSets = docs.map(tokenize)
    this.idf = computeIDF(allTokenSets)

    // 按 IDF 降序保留前 N 个最有区分度的词（控制向量维度）
    const MAX_VOCAB = 2000
    const sortedTerms = [...this.idf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_VOCAB)

    this.vocab = new Map(sortedTerms.map(([term], i) => [term, i]))
    this.dim = this.vocab.size
  }

  /** 把文本转成 TF-IDF 向量，并做 L2 归一化（方便余弦相似度计算） */
  embed(text: string): number[] {
    const tokens = tokenize(text)
    const tf = computeTF(tokens)
    const vec = new Array<number>(this.dim).fill(0)

    for (const [term, tfScore] of tf) {
      const idx = this.vocab.get(term)
      if (idx !== undefined) {
        const idfScore = this.idf.get(term) ?? 1
        vec[idx] = tfScore * idfScore
      }
    }

    // L2 归一化
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    return norm === 0 ? vec : vec.map(v => v / norm)
  }
}

// 全局 embedder 单例，在 buildIndex 中初始化
let _embedder: TFIDFEmbedder | null = null

/**
 * 初始化 embedder：用知识库语料拟合 TF-IDF 词汇表。
 * 必须在 buildIndex 之前调用一次。
 */
export function initEmbedder(docs: string[]): void {
  _embedder = new TFIDFEmbedder()
  _embedder.fit(docs)
}

/**
 * 把文本转成 embedding 向量（TF-IDF，本地实现）。
 *
 * 替换成 OpenAI API 时：
 *   const response = await client.embeddings.create({ model: 'text-embedding-3-small', input: text })
 *   return response.data[0].embedding
 */
export function embed(text: string): number[] {
  if (!_embedder) throw new Error('embedder not initialized, call initEmbedder() first')
  return _embedder.embed(text)
}

// ─── 数据类型 ──────────────────────────────────────────────────────────────────

/**
 * 向量数据库中的一条记录。
 * 在生产级向量数据库（Qdrant 等）中，结构完全类似，
 * 只是多了持久化、ANN 索引和过滤条件。
 */
export interface VectorRecord {
  id: string
  category: string
  title: string
  content: string
  /** 对应的 embedding 向量 */
  embedding: number[]
}

export interface SearchResult {
  record: VectorRecord
  score: number
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return dot / (normA * normB)
}

// ─── 内存向量数据库 ────────────────────────────────────────────────────────────

/**
 * 极简的内存向量数据库，演示核心逻辑。
 * 替换成 Qdrant / Pinecone 时，只需要把 insert/search 方法换成对应 SDK 调用，
 * 其余 RAG 逻辑完全不变。
 */
export class InMemoryVectorDB {
  private records: VectorRecord[] = []

  insert(record: VectorRecord): void {
    this.records.push(record)
  }

  /**
   * 向量相似度搜索（暴力全扫描 + 相似度门槛过滤）。
   *
   * @param queryEmbedding 查询向量
   * @param topK 返回结果数量，默认 3
   * @param threshold 最低相似度门槛，低于此值的结果会被过滤，默认 0.6
   */
  search(queryEmbedding: number[], topK: number = 3, threshold: number = 0.15): SearchResult[] {
    return this.records
      .map(record => ({ record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
      .filter(result => result.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  size(): number {
    return this.records.length
  }

  /** 导出所有记录，用于持久化或调试 */
  getAll(): VectorRecord[] {
    return [...this.records]
  }
}

// ─── 构建索引 ──────────────────────────────────────────────────────────────────

/**
 * 把知识库文档批量 embed，存入向量数据库。
 * 这个操作在真实场景中只需要执行一次（文档更新时增量追加）。
 *
 * TF-IDF 方案：同步执行，先用全量语料拟合词汇表，再逐条生成向量。
 * 切换到 OpenAI Embedding API 时，把 embed() 替换成 API 调用即可，
 * buildIndex 改回 async 即可，其余 RAG 逻辑不用改。
 */
export function buildIndex(db: InMemoryVectorDB): void {
  // 先用全部语料拟合 TF-IDF 词汇表（生成全局 IDF）
  initEmbedder(KNOWLEDGE_DOCS.map(doc => doc.content))

  console.log(`开始构建索引，共 ${KNOWLEDGE_DOCS.length} 条文档...`)

  for (const doc of KNOWLEDGE_DOCS) {
    const embedding = embed(doc.content)
    db.insert({ ...doc, embedding })
    process.stdout.write('.')
  }

  console.log(`\n索引构建完成，共 ${db.size()} 条记录`)
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

function main(): void {
  const db = new InMemoryVectorDB()
  buildIndex(db)

  // 展示索引内容概览
  console.log('\n索引内容概览:')
  const categories = [...new Set(db.getAll().map(r => r.category))]
  for (const cat of categories) {
    const docs = db.getAll().filter(r => r.category === cat)
    console.log(`  [${cat}] ${docs.length} 条文档`)
    for (const doc of docs) {
      console.log(`    - ${doc.title}`)
    }
  }
}

main()
