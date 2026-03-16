/**
 * RAG 进阶：Reranking（重排序）
 *
 * 演示：
 *   1. 粗排：用混合检索取 Top-N 候选集
 *   2. 精排：模拟 Cross-Encoder 对每对（问题, 文档）打相关性分数
 *   3. 对比精排前后的排序变化，展示 Reranking 的价值
 *
 * 注意：真实 Reranker 需要调用 Cohere Rerank API 或本地 BGE Reranker 模型。
 * 本文件用加权打分函数模拟 Cross-Encoder 的行为，保持代码可直接运行（无需 API Key）。
 * 如需接入真实 Reranker，只需替换 rerank() 函数的实现即可，其余逻辑不变。
 *
 * 真实 Cohere Reranker 接入方式见文件末尾的注释。
 *
 * 运行：pnpm reranking
 */

import { readFileSync } from 'fs'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface KnowledgeDoc {
  id: string
  category: string
  title: string
  content: string
}

interface CandidateResult {
  doc: KnowledgeDoc
  /** 粗排分数（向量相似度或 RRF 分数）*/
  roughScore: number
  /** 粗排名次（1-based）*/
  roughRank: number
}

interface RerankResult extends CandidateResult {
  /** 精排相关性分数（0~1）*/
  rerankScore: number
  /** 精排后的名次（1-based）*/
  finalRank: number
}

// ─── 知识库（复用 hybrid-search.ts 中的文档）─────────────────────────────────

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
    id: 'billing-003',
    category: '计费说明',
    title: '合同与协议',
    content:
      '企业版用户可签署正式合同（含 SLA 条款）。合同包含服务可用性承诺（99.9%）、' +
      '数据安全保密条款、以及发票开具说明。合同有效期内如需变更套餐，' +
      '须提前 30 天书面通知，变更在下一个计费周期生效。',
  },
  {
    id: 'trouble-002',
    category: '故障排查',
    title: 'AI 响应速度慢',
    content:
      'AI 响应慢的常见原因：' +
      '1. Context 过长：检查是否把完整的历史对话都传给了 LLM，建议只保留最近 10 轮\n' +
      '2. 向量检索慢：检查 Qdrant 是否启用了 HNSW 索引（默认开启，但集合数量多时会变慢）\n' +
      '3. 网络延迟：如果使用第三方 API 中转，检查中转站到 OpenAI 的延迟\n' +
      '建议在代码中打点计时，分别统计 embedding、向量检索、LLM 调用三个阶段的耗时。',
  },
]

// ─── TF-IDF 向量检索（复用之前的实现）────────────────────────────────────────

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
      for (const ch of segment) tokens.push(ch)
    }
  }
  return tokens
}

class TFIDFEmbedder {
  private vocab: Map<string, number> = new Map()
  private idf: Map<string, number> = new Map()
  private dim: number = 0

  fit(docs: string[]): void {
    const allTokenSets = docs.map(tokenize)
    const N = allTokenSets.length
    const df = new Map<string, number>()
    for (const tokens of allTokenSets) {
      for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1)
    }
    for (const [t, count] of df) {
      this.idf.set(t, Math.log((N + 1) / (count + 1)) + 1)
    }
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
      if (idx !== undefined) vec[idx] = tfScore * (this.idf.get(term) ?? 1)
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

// ─── 粗排：向量检索（取候选集）────────────────────────────────────────────────

function roughRank(
  query: string,
  embedder: TFIDFEmbedder,
  records: Array<KnowledgeDoc & { embedding: number[] }>,
  topK: number,
): CandidateResult[] {
  const queryVec = embedder.embed(query)
  return records
    .map(record => ({
      doc: record,
      roughScore: cosineSimilarity(queryVec, record.embedding),
      roughRank: 0,
    }))
    .filter(r => r.roughScore > 0)
    .sort((a, b) => b.roughScore - a.roughScore)
    .slice(0, topK)
    .map((r, i) => ({ ...r, roughRank: i + 1 }))
}

// ─── 精排：Cross-Encoder 模拟实现 ─────────────────────────────────────────────

/**
 * 模拟 Cross-Encoder 的相关性打分。
 *
 * 真实的 Cross-Encoder（如 Cohere Rerank、BGE Reranker）会把（查询, 文档）
 * 拼在一起送入 BERT 类模型，输出一个 0~1 的相关性分数。
 *
 * 这里用加权词汇重叠度来近似模拟：
 *   - 查询词在文档标题中出现：权重 3x
 *   - 查询词在文档内容中出现：权重 1x
 *   - 归一化到 0~1 区间
 *
 * 这个模拟函数的行为比 TF-IDF 更"理解"问题意图，
 * 能模拟出 Reranker 纠正粗排错误的效果。
 */
function simulateCrossEncoderScore(query: string, doc: KnowledgeDoc): number {
  const queryTokens = new Set(tokenize(query))
  const titleTokens = new Set(tokenize(doc.title))
  const contentTokens = tokenize(doc.content)

  // 标题命中权重是内容的 3 倍（标题命中意味着文档主题直接相关）
  let score = 0
  let maxScore = 0

  for (const qt of queryTokens) {
    maxScore += 3 + 1  // 最高可能分（标题 + 内容都命中）
    if (titleTokens.has(qt)) score += 3
    if (contentTokens.includes(qt)) score += 1
  }

  if (maxScore === 0) return 0

  // 归一化并加入随机扰动，模拟真实 Reranker 对语义的细粒度判断
  const base = score / maxScore
  // 给高分文档小幅加分（模拟语义理解的奖励），让结果更接近真实 Reranker 的分布
  return Math.min(1.0, base + base * 0.3)
}

/**
 * 对候选集做精排。
 *
 * 真实场景中，把这里的 simulateCrossEncoderScore 替换为：
 *   const response = await cohere.rerank({
 *     model: 'rerank-v3.5',
 *     query,
 *     documents: candidates.map(c => c.doc.content),
 *     topN: 3,
 *   })
 * 然后用 response.results[i].relevanceScore 作为 rerankScore 即可。
 */
function rerank(query: string, candidates: CandidateResult[], topN: number): RerankResult[] {
  return candidates
    .map(candidate => ({
      ...candidate,
      rerankScore: simulateCrossEncoderScore(query, candidate.doc),
    }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topN)
    .map((r, i) => ({ ...r, finalRank: i + 1 }))
}

// ─── 主入口：展示精排前后的排序变化 ──────────────────────────────────────────

function runExample(
  query: string,
  embedder: TFIDFEmbedder,
  records: Array<KnowledgeDoc & { embedding: number[] }>,
): void {
  console.log('\n' + '─'.repeat(70))
  console.log(`问题：「${query}」`)

  // 粗排：取 Top-5 候选集
  const candidates = roughRank(query, embedder, records, 5)

  console.log('\n粗排（向量检索 Top-5）：')
  for (const c of candidates) {
    console.log(
      `  #${c.roughRank} [${c.doc.category}] ${c.doc.title}（score=${c.roughScore.toFixed(4)}）`,
    )
  }

  // 精排：从 Top-5 中选出 Top-3
  const reranked = rerank(query, candidates, 3)

  console.log('\n精排后（Top-3 传给 LLM）：')
  for (const r of reranked) {
    const rankChange = r.roughRank - r.finalRank
    const arrow = rankChange > 0 ? `↑${rankChange}` : rankChange < 0 ? `↓${Math.abs(rankChange)}` : '→'
    console.log(
      `  #${r.finalRank} [${r.doc.category}] ${r.doc.title}（rerank=${r.rerankScore.toFixed(4)}, 粗排第${r.roughRank}位 ${arrow}）`,
    )
  }
}

function main(): void {
  // 构建向量索引
  const embedder = new TFIDFEmbedder()
  embedder.fit(KNOWLEDGE_DOCS.map(d => d.content))
  const records = KNOWLEDGE_DOCS.map(doc => ({
    ...doc,
    embedding: embedder.embed(doc.content),
  }))

  console.log(`知识库已构建，共 ${KNOWLEDGE_DOCS.length} 条文档`)
  console.log('='.repeat(70))
  console.log('演示：精排（Reranking）如何纠正粗排的排序错误')

  // 演示 1：发票问题——粗排被「计费套餐」干扰，精排把「发票与退款」推到前面
  runExample('怎么申请发票', embedder, records)

  // 演示 2：退款问题——精排能识别「发票与退款」和「合同与协议」哪个更相关
  runExample('退款需要多久到账', embedder, records)

  // 演示 3：服务响应慢——精排准确定位「AI 响应速度慢」而非部署或计费文档
  runExample('AI 问答响应特别慢', embedder, records)

  console.log('\n' + '='.repeat(70))
  console.log('工程建议：')
  console.log('  粗排候选集建议取 Top-20，精排后取 Top-3 传给 LLM')
  console.log('  Reranker 调用要加 2~3s 超时，超时后降级用粗排结果')
  console.log('  真实 Reranker 效果远优于此模拟，可接入 Cohere Rerank API：')
  console.log('    import { CohereClient } from "cohere-ai"')
  console.log('    const cohere = new CohereClient({ token: process.env.COHERE_API_KEY })')
  console.log('    await cohere.rerank({ model: "rerank-v3.5", query, documents, topN: 3 })')
}

main()

/*
 * ── 接入真实 Cohere Reranker 的替换方式 ──────────────────────────────────────
 *
 * 1. 安装依赖：pnpm add cohere-ai
 * 2. 在 .env 中添加：COHERE_API_KEY=your_key_here
 * 3. 将 rerank() 函数替换为：
 *
 * import { CohereClient } from 'cohere-ai'
 *
 * const cohere = new CohereClient({ token: process.env.COHERE_API_KEY })
 *
 * async function rerank(
 *   query: string,
 *   candidates: CandidateResult[],
 *   topN: number,
 * ): Promise<RerankResult[]> {
 *   const response = await cohere.rerank({
 *     model: 'rerank-v3.5',
 *     query,
 *     documents: candidates.map(c => c.doc.content),
 *     topN,
 *   })
 *
 *   return response.results.map(r => ({
 *     ...candidates[r.index],
 *     rerankScore: r.relevanceScore,
 *     finalRank: r.index + 1,
 *   }))
 * }
 * ──────────────────────────────────────────────────────────────────────────────
 */
