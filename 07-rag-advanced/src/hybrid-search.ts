/**
 * RAG 进阶：Hybrid Search（混合检索）
 *
 * 演示：
 *   1. BM25 关键词检索（精确词语匹配）
 *   2. TF-IDF 向量检索（语义相似度）
 *   3. RRF（倒数排名融合）合并两组结果
 *   4. 对比三种方式在不同类型问题上的命中差异
 *
 * 核心结论：
 *   - 向量检索擅长语义理解，但对精确词语（错误码、型号等）不够可靠
 *   - BM25 擅长精确词语匹配，但不理解语义
 *   - Hybrid = 两种优势叠加，用 RRF 合并，不需要手动调权重
 *
 * 运行：pnpm hybrid-search
 */

import { readFileSync } from 'fs'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface KnowledgeDoc {
  id: string
  category: string
  title: string
  content: string
}

interface VectorRecord extends KnowledgeDoc {
  embedding: number[]
}

interface SearchResult {
  doc: KnowledgeDoc
  score: number
  rank: number
}

interface HybridSearchResult {
  doc: KnowledgeDoc
  rrfScore: number
  vectorRank: number | null
  bm25Rank: number | null
}

// ─── 知识��（含一个精确错误码文档，用来演示向量检索的盲区）────────────────────

const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    id: 'deploy-001',
    category: '部署手册',
    title: '系统最低配置要求',
    content:
      '生产环境最低配置：4 核 CPU、16GB 内存、100GB SSD 存储。' +
      '推荐配置：8 核 CPU、32GB 内存、500GB SSD。' +
      '操作系统支持 Ubuntu 22.04 LTS 或 CentOS 8+。' +
      '需要预装 Docker 24.0+ 和 Docker Compose v2。',
  },
  {
    id: 'api-002',
    category: 'API 文档',
    title: '限流规则',
    content:
      '默认限流：每个 API Key 每分钟最多 60 次请求（RPM）。' +
      '超出限流返回 429 状态码，响应头中包含 Retry-After 字段（单位：秒）。' +
      '企业版用户可申请提高限流上限，最高支持 1000 RPM。' +
      '批量处理场景建议使用异步队列接口，不受 RPM 限制。',
  },
  {
    id: 'api-003',
    category: 'API 文档',
    title: '错误码说明',
    content:
      '常见错误码：400（请求参数格式错误）、401（未认证或 token 过期）、' +
      '403（权限不足）、404（资源不存在）、429（触发限流）、500（服务内部错误）。' +
      'ERR_QUOTA_EXCEEDED 表示当月 AI 对话配额已用完，需要升级套餐或等到下月重置。' +
      'ERR_INVALID_KEY 表示 API Key 格式错误或已失效，需要在控制台重新生成。' +
      '遇到 500 错误建议保存 requestId（响应头 X-Request-Id）并联系技术支持。',
  },
  {
    id: 'billing-001',
    category: '计费说明',
    title: '套餐对比',
    content:
      '基础版：每月 ¥299，包含 10,000 次 AI 对话，5GB 向量存储，社区支持。' +
      '专业版：每月 ¥999，包含 50,000 次 AI 对话，50GB 向量存储，邮件支持。' +
      '企业版：面议，支持私有化部署、SSO、专属客服、SLA 保障。' +
      '所有套餐超出包含量后按量计费：对话 ¥0.03/次，存储 ¥0.5/GB/月。',
  },
  {
    id: 'billing-002',
    category: '计费说明',
    title: '发票与退款',
    content:
      '发票：支持开具增值税普通发票和专用发票，在控制台"账户-发票管理"申请，' +
      '3 个工作日内开具并发送到注册邮箱。' +
      '退款：年付套餐在购买后 7 天内可申请全额退款；超过 7 天按已使用天数扣除费用后退款。' +
      '月付套餐不支持退款，建议先申请 14 天免费试用。',
  },
  {
    id: 'trouble-001',
    category: '故障排查',
    title: '服务无法启动',
    content:
      '服务无法启动时，优先检查：' +
      '1. 查看日志：docker compose logs api --tail 50\n' +
      '2. 检查环境变量是否全部配置（DATABASE_URL 和 OPENAI_API_KEY）\n' +
      '3. 确认端口未被占用：lsof -i :3000\n' +
      '如果日志显示 connection refused，通常是数据库还没完全启动，等 30 秒后重试。',
  },
  {
    id: 'trouble-003',
    category: '故障排查',
    title: '内存不足导致服务崩溃',
    content:
      '服务崩溃且日志中包含 OOM（Out of Memory）时：' +
      '1. 检查当前内存用量：docker stats\n' +
      '2. 确认服务器内存满��最低要求（16GB）\n' +
      '3. 减少 MAX_WORKERS 配置（默认 4，可调整为 2）\n' +
      '4. 如果是向量检索导致的，考虑启用 HNSW 近似索引而非暴力全扫描。',
  },
]

// ─── TF-IDF 向量检索（复用 06-rag-basic 的实现）──────────────────────────────

function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  const enTokens = lower.match(/[a-z0-9_][a-z0-9_]*/g) ?? []
  tokens.push(...enTokens.filter(t => t.length > 1))
  const zhChars = lower.match(/[\u4e00-\u9fa5]+/g) ?? []
  for (const segment of zhChars) {
    if (segment.length === 1) {
      tokens.push(segment)
    } else {
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2))
      }
      for (const ch of segment) {
        tokens.push(ch)
      }
    }
  }
  return tokens
}

function computeIDF(allTokenSets: string[][]): Map<string, number> {
  const N = allTokenSets.length
  const df = new Map<string, number>()
  for (const tokens of allTokenSets) {
    for (const t of new Set(tokens)) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [t, count] of df) {
    idf.set(t, Math.log((N + 1) / (count + 1)) + 1)
  }
  return idf
}

class TFIDFEmbedder {
  private vocab: Map<string, number> = new Map()
  private idf: Map<string, number> = new Map()
  private dim: number = 0

  fit(docs: string[]): void {
    const allTokenSets = docs.map(tokenize)
    this.idf = computeIDF(allTokenSets)
    const MAX_VOCAB = 2000
    const sortedTerms = [...this.idf.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VOCAB)
    this.vocab = new Map(sortedTerms.map(([term], i) => [term, i]))
    this.dim = this.vocab.size
  }

  embed(text: string): number[] {
    const tokens = tokenize(text)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const [t, count] of tf) tf.set(t, count / tokens.length)

    const vec = new Array<number>(this.dim).fill(0)
    for (const [term, tfScore] of tf) {
      const idx = this.vocab.get(term)
      if (idx !== undefined) {
        vec[idx] = tfScore * (this.idf.get(term) ?? 1)
      }
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    return norm === 0 ? vec : vec.map(v => v / norm)
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  if (normA === 0 || normB === 0) return 0
  return dot / (normA * normB)
}

// ─── BM25 关键词检索 ──────────────────────────────────────────────────────────

/**
 * BM25 评分算法实现。
 *
 * 核心公式：
 *   score(q, d) = Σ IDF(t) * (tf(t,d) * (k1+1)) / (tf(t,d) + k1*(1 - b + b*|d|/avgdl))
 *
 * 参数说明：
 *   k1=1.5：词频饱和系数（词频越高，得分增量越平缓）
 *   b=0.75：文档长度归一化系数（越长的文档单词贡献越小）
 */
class BM25 {
  private k1 = 1.5
  private b = 0.75
  private idf: Map<string, number> = new Map()
  private avgDocLength: number = 0
  private docs: string[][] = []

  fit(docs: string[]): void {
    this.docs = docs.map(tokenize)
    const N = this.docs.length
    this.avgDocLength = this.docs.reduce((sum, d) => sum + d.length, 0) / N

    // 计算 BM25 IDF：log((N - df + 0.5) / (df + 0.5) + 1)
    const df = new Map<string, number>()
    for (const tokens of this.docs) {
      for (const t of new Set(tokens)) {
        df.set(t, (df.get(t) ?? 0) + 1)
      }
    }
    for (const [t, count] of df) {
      this.idf.set(t, Math.log((N - count + 0.5) / (count + 0.5) + 1))
    }
  }

  /**
   * 对单个文档计算 BM25 得分
   *
   * @param queryTokens 查询词的 token 列表
   * @param docIndex 文档在 docs 中的下标
   */
  score(queryTokens: string[], docIndex: number): number {
    const docTokens = this.docs[docIndex]
    const docLength = docTokens.length

    // 统计文档中每个词的词频
    const tf = new Map<string, number>()
    for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1)

    let score = 0
    for (const term of new Set(queryTokens)) {
      const idfScore = this.idf.get(term) ?? 0
      if (idfScore === 0) continue
      const termFreq = tf.get(term) ?? 0
      const numerator = termFreq * (this.k1 + 1)
      const denominator =
        termFreq + this.k1 * (1 - this.b + (this.b * docLength) / this.avgDocLength)
      score += idfScore * (numerator / denominator)
    }
    return score
  }

  /** 对所有文档打分，返回按分数降序的结果列表 */
  search(query: string, topK: number = 5): Array<{ docIndex: number; score: number }> {
    const queryTokens = tokenize(query)
    return this.docs
      .map((_, i) => ({ docIndex: i, score: this.score(queryTokens, i) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

// ─── RRF 合并 ─────────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion（倒数排名融合）。
 *
 * 把多组检索结果按排名合并，不需要归一化原始分数。
 * RRF 分数 = Σ 1 / (k + rank_i)，k=60 是行业经验默认值。
 *
 * 优点：对两种检索的原始分数量级不敏感，合并结果稳定。
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  bm25Results: SearchResult[],
  k: number = 60,
): HybridSearchResult[] {
  const rrfScores = new Map<string, number>()
  const vectorRanks = new Map<string, number>()
  const bm25Ranks = new Map<string, number>()
  const docMap = new Map<string, KnowledgeDoc>()

  for (const [index, result] of vectorResults.entries()) {
    const id = result.doc.id
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (k + index + 1))
    vectorRanks.set(id, index + 1)
    docMap.set(id, result.doc)
  }

  for (const [index, result] of bm25Results.entries()) {
    const id = result.doc.id
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (k + index + 1))
    bm25Ranks.set(id, index + 1)
    docMap.set(id, result.doc)
  }

  return [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      doc: docMap.get(id)!,
      rrfScore,
      vectorRank: vectorRanks.get(id) ?? null,
      bm25Rank: bm25Ranks.get(id) ?? null,
    }))
}

// ─── 主入口：三种检索方式对比 ──────────────────────────────────────────────────

function buildIndex(): { embedder: TFIDFEmbedder; bm25: BM25; records: VectorRecord[] } {
  const contents = KNOWLEDGE_DOCS.map(d => d.content)

  const embedder = new TFIDFEmbedder()
  embedder.fit(contents)

  const bm25 = new BM25()
  bm25.fit(contents)

  const records: VectorRecord[] = KNOWLEDGE_DOCS.map(doc => ({
    ...doc,
    embedding: embedder.embed(doc.content),
  }))

  return { embedder, bm25, records }
}

function vectorSearch(
  query: string,
  embedder: TFIDFEmbedder,
  records: VectorRecord[],
  topK: number,
): SearchResult[] {
  const queryVec = embedder.embed(query)
  return records
    .map((record, i) => ({ doc: KNOWLEDGE_DOCS[i], score: cosineSimilarity(queryVec, record.embedding), rank: 0 }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

function bm25Search(query: string, bm25: BM25, topK: number): SearchResult[] {
  return bm25
    .search(query, topK)
    .map((r, i) => ({ doc: KNOWLEDGE_DOCS[r.docIndex], score: r.score, rank: i + 1 }))
}

function compareSearch(
  query: string,
  embedder: TFIDFEmbedder,
  bm25: BM25,
  records: VectorRecord[],
): void {
  console.log('\n' + '─'.repeat(70))
  console.log(`问题：「${query}」`)

  const topK = 3
  const vResults = vectorSearch(query, embedder, records, topK)
  const bResults = bm25Search(query, bm25, topK)
  const hResults = reciprocalRankFusion(
    vectorSearch(query, embedder, records, topK * 2),
    bm25Search(query, bm25, topK * 2),
  ).slice(0, topK)

  const fmt = (results: Array<{ doc: KnowledgeDoc; score: number }>) =>
    results.length > 0
      ? results
          .map(r => `[${r.doc.category}] ${r.doc.title}（${r.score.toFixed(4)}）`)
          .join('\n            ')
      : '（无结果）'

  console.log(`  向量检索：${fmt(vResults)}`)
  console.log(
    `  BM25    ：${fmt(bResults)}`,
  )
  console.log(
    `  混合检索：${hResults.map(r => `[${r.doc.category}] ${r.doc.title}（rrf=${r.rrfScore.toFixed(4)}, v=${r.vectorRank ?? '-'}, b=${r.bm25Rank ?? '-'}）`).join('\n            ')}`,
  )
}

function main(): void {
  const { embedder, bm25, records } = buildIndex()
  console.log(`知识库已构建，共 ${KNOWLEDGE_DOCS.length} 条文档`)
  console.log('='.repeat(70))
  console.log('对比三种检索方式在不同类型问题上的命中差异')

  // 语义类问题：向量和 BM25 都能处理
  compareSearch('内存不够怎么办', embedder, bm25, records)
  compareSearch('怎么申请退款', embedder, bm25, records)

  // 精确错误码：向量检索的盲区，BM25 能精确命中
  compareSearch('ERR_QUOTA_EXCEEDED 是什么意思', embedder, bm25, records)
  compareSearch('ERR_INVALID_KEY 怎么处理', embedder, bm25, records)

  // 同义词/换说法：BM25 无法识别，向量检索擅长
  compareSearch('API 调用太频繁被限制了', embedder, bm25, records)

  console.log('\n' + '='.repeat(70))
  console.log('结论：混合检索 = 向量的语义理解 + BM25 的精确匹配，两种短板互补')
}

main()
