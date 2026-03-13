/**
 * 向量搜索示例（内存版向量数据库）
 *
 * 演示：
 * 1. 用内存数组模拟向量数据库的存储结构（无需安装 Qdrant / Pinecone）
 * 2. 把一批「知识文档」embed 后存入内存索引
 * 3. 对用户查询做向量检索，返回最相关的 Top-K 文档
 * 4. 把检索结果喂给 LLM，让它基于上下文回答问题（mini RAG 演示）
 *
 * 运行：pnpm search
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'

// 加载 .env
const dotenvPath = new URL('../.env', import.meta.url).pathname
try {
  const envContent = readFileSync(dotenvPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && !key.startsWith('#') && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim()
    }
  }
} catch {
  // .env 不存在时跳过
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

const MODEL = 'gpt-5.2-codex'

// ─── 数据类型 ──────────────────────────────────────────────────────────────────

/**
 * 向量数据库中的一条记录。
 * 真实的向量数据库（如 Qdrant）结构类似，多了持久化和索引能力。
 */
interface VectorRecord {
  id: string
  /** 原始文本内容 */
  text: string
  /** 来源标记，方便展示检索结果的出处 */
  source: string
  /** 对应的 embedding 向量 */
  embedding: number[]
}

/**
 * 检索结果，包含相似度分数。
 */
interface SearchResult {
  record: VectorRecord
  score: number
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return dot / (normA * normB)
}

// ─── 内存向量数据库 ────────────────────────────────────────────────────────────

/**
 * 极简的内存向量数据库。
 * 核心逻辑和生产级向量数据库（Qdrant、Pinecone、Weaviate）完全一致：
 * - 存储：文本 + 元数据 + 向量
 * - 检索：计算查询向量与所有记录的余弦相似度，返回 Top-K
 *
 * 区别只在于：生产级数据库有持久化、ANN 近似索引（比暴力搜索快得多）、
 * 以及丰富的过滤条件。
 */
class InMemoryVectorDB {
  private records: VectorRecord[] = []

  /** 插入一条记录（需要提前计算好 embedding） */
  insert(record: VectorRecord): void {
    this.records.push(record)
  }

  /**
   * 向量相似度搜索（暴力全扫描）。
   * 对所有记录计算余弦相似度，返回 Top-K 结果。
   * 数据量小时和 ANN 索引效果相同，数据量大时需要换真正的向量数据库。
   */
  search(queryEmbedding: number[], topK: number = 3): SearchResult[] {
    const scored = this.records.map(record => ({
      record,
      score: cosineSimilarity(queryEmbedding, record.embedding),
    }))

    // 按相似度降序排列，取前 K 个
    return scored.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  size(): number {
    return this.records.length
  }
}

// ─── 知识库内容 ────────────────────────────────────────────────────────────────

/**
 * 模拟一个小型 AI 产品知识库，包含产品介绍、技术说明和常见问题。
 * 真实场景下，这些文���可能来自 Confluence、Notion、PDF、代码注释等。
 */
const KNOWLEDGE_DOCS = [
  {
    id: 'doc-001',
    source: '产品介绍',
    text: 'SmartBot 是一款基于大语言模���的智能客服系统，支持多轮对话、意图识别和工单自动分类。它可以处理用户的退款申请、订单查询、产品咨询等常见场景，平均响应时间低于 2 秒。',
  },
  {
    id: 'doc-002',
    source: '技术文档',
    text: 'SmartBot 使用 RAG（检索增强生成）架构。用户提问时，系统先从向量数据库中检索相关知识文档，再将检索结果和问题一起传给 LLM，确保回答的准确性和时效性。',
  },
  {
    id: 'doc-003',
    source: '技术文档',
    text: '向量数据库使用 Qdrant 部署，存储了超过 10 万条产品文档、FAQ 和历史工单的 embedding。检索使用余弦相似度，Top-3 的召回率在测试集上达到 92%。',
  },
  {
    id: 'doc-004',
    source: '常见问题',
    text: '如果 SmartBot 回答不准确，可能是知识库内容过时或问题涉及知识库未覆盖的领域。建议定期同步最新的产品文档到知识库，并为长尾问题配置人工兜底。',
  },
  {
    id: 'doc-005',
    source: '常见问题',
    text: '退款流程：用户提交退款申请后，SmartBot 自动识别订单信息并检查退款资格。符合条件的申请会在 24 小时内自动处理，不符合条件的会转给人工客服处理。',
  },
  {
    id: 'doc-006',
    source: '部署说明',
    text: 'SmartBot 支持私有化部署，需要准备：4 核 8G 的服务器、Docker 环境、Qdrant 向量数据库、以及 OpenAI 或兼容的 LLM API 接口。首次部署预计需要 2 个工作日。',
  },
  {
    id: 'doc-007',
    source: '定价说明',
    text: 'SmartBot 按对话次数计费，基础版 0.05 元/次对话，企业版支持私有化部署和定制化开发，价格面议。每月前 1000 次对话免费，适合中小团队试用。',
  },
  {
    id: 'doc-008',
    source: '集成指南',
    text: 'SmartBot 提供 REST API 和 WebSocket 两种接入方式。REST API 适合单次问答场景，WebSocket 适合需要实时流式输出的对话场景。SDK 支持 JavaScript、Python 和 Java。',
  },
]

// ─── 构建向量索引 ──────────────────────────────────────────────────────────────

async function buildIndex(db: InMemoryVectorDB): Promise<void> {
  console.log(`正在为 ${KNOWLEDGE_DOCS.length} 条文档生成 embedding...`)

  // 批量 embed，实际生产中通常做批次处理（避免并发过高）
  for (const doc of KNOWLEDGE_DOCS) {
    const embedding = await embed(doc.text)
    db.insert({ ...doc, embedding })
    process.stdout.write('.')
  }

  console.log(`\n索引构建完成，共 ${db.size()} 条记录`)
}

// ─── 向量检索 + LLM 问答 ───────────────────────────────────────────────────────

/**
 * 完整的 RAG 流程：
 * 1. 把用户问题转成向量
 * 2. 从知识库检索最相关的 Top-3 文档
 * 3. 把检索结果拼进 system prompt
 * 4. 让 LLM 基于上下文回答问题
 */
async function ragQuery(db: InMemoryVectorDB, question: string): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log(`用户问题: ${question}`)
  console.log('='.repeat(60))

  // 步骤 1：把问题转成向量
  const queryEmbedding = await embed(question)

  // 步骤 2：向量检索 Top-3
  const results = db.search(queryEmbedding, 3)

  console.log('\n检索结果（按相似度排序）:')
  for (const { record, score } of results) {
    console.log(`  [${score.toFixed(4)}] [${record.source}] ${record.text.slice(0, 60)}...`)
  }

  // 步骤 3：把检索到的文档拼成上下文
  const context = results.map(({ record }) => `[${record.source}]\n${record.text}`).join('\n\n')

  // 步骤 4：带上下文调用 LLM
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content: `你是 SmartBot 的智能助手。请根据以下知识库内容回答用户问题。
如果知识库中没有相关信息，请直接说"这个问题我暂时没有相关资料"。

知识库内容：
${context}`,
      },
      {
        role: 'user',
        content: question,
      },
    ],
  })

  console.log(`\n助手: ${response.choices[0].message.content}`)
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = new InMemoryVectorDB()

  // 构建知识库索引（真实场景中只需要构建一次，后续复用）
  await buildIndex(db)

  // 模拟几个不同类型的用户问题
  const questions = [
    'SmartBot 是怎么保证回答准确的？',
    '退款申请多久能处理完？',
    '我们公司想私有化部署，需要什么配置？',
    '它支持 Python 接入吗？',
  ]

  for (const question of questions) {
    await ragQuery(db, question)
  }
}

main().catch(console.error)
