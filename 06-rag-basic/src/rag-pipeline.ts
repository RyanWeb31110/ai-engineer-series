/**
 * RAG 完整流水线演示
 *
 * 把 RAG 的三个阶段清晰分开：
 * - Indexing（索引构建）：文档 → Chunk → Embed → 存入向量数据库
 * - Retrieval（检索）：问题 → Embed → 向量检索 → Top-K 文档
 * - Generation（生成）：检索结果 + 问题 → LLM → 答案
 *
 * 同时演示两种失效模式：
 * 1. 相似度门槛过低导致检索到不相关内容
 * 2. 知识库缺失时的"幻觉"风险
 *
 * 运行：pnpm pipeline
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { buildIndex, embed, InMemoryVectorDB } from './build-index.js'

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

// ─── 工具函数 ───────────────────────────────────────────────────��──────────────

function printSection(title: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(`  ${title}`)
  console.log('='.repeat(60))
}

// ─── 三阶段分解展示 ────────────────────────────────────────────────────────────

/**
 * 阶段一：索引构建
 * 文档 → Chunk → Embed → 存储
 *
 * 重点：分块策略直接影响检索质量
 */
async function phaseIndexing(db: InMemoryVectorDB): Promise<void> {
  printSection('阶段一：Indexing（索引构建）')
  console.log('文档 → Chunk → Embed → 存入向量数据库\n')

  const startTime = Date.now()
  buildIndex(db) // 同步执行（TF-IDF 方案无需异步）
  const elapsed = Date.now() - startTime

  console.log(`\n耗时 ${elapsed}ms，平均每条文档 ${Math.round(elapsed / db.size())}ms`)
  console.log('(切换到 OpenAI Embedding API 后，主要耗时在网络请求，可以离线批量预处理)')
}

/**
 * 阶段二：检索
 * 问题 → Embed → 向量检索 → Top-K 文档
 *
 * 重点：相似度门槛的作用
 */
async function phaseRetrieval(db: InMemoryVectorDB, question: string): Promise<string[]> {
  printSection('阶段二：Retrieval（检索）')
  console.log(`问题: "${question}"\n`)

  const queryEmbedding = embed(question) // 同步

  // 对比：不设门槛 vs 设门槛
  const allResults = db.search(queryEmbedding, 5, 0) // 不过滤
  const filteredResults = db.search(queryEmbedding, 3, 0.15) // 过滤低于 0.15 的（TF-IDF 阈值）

  console.log('未过滤（Top-5）：')
  for (const { record, score } of allResults) {
    const marker = score >= 0.15 ? '✓' : '✗'
    console.log(`  ${marker} [${score.toFixed(4)}] [${record.category}] ${record.title}`)
  }

  console.log(`\n过滤后（threshold=0.15，保留 ${filteredResults.length} 条）：`)
  for (const { record, score } of filteredResults) {
    console.log(`  [${score.toFixed(4)}] [${record.category}] ${record.title}`)
  }

  return filteredResults.map(
    ({ record }) => `[${record.category}] ${record.title}\n${record.content}`
  )
}

/**
 * 阶段三：生成
 * 检索结果 + 问题 → LLM → 答案
 *
 * 重点：System prompt 中如何引导模型
 */
async function phaseGeneration(question: string, contextDocs: string[]): Promise<void> {
  printSection('阶段三：Generation（生成）')

  if (contextDocs.length === 0) {
    console.log('无相关文档，直接拒绝回答（防止幻觉）')
    console.log('\n回答: 这个问题超出了我的知识库范围，建议联系技术支持。')
    return
  }

  const context = contextDocs.join('\n\n---\n\n')

  console.log(`拼入 ${contextDocs.length} 条检索文档到 system prompt...`)

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content: `你是技术支持助手，只根据知识库内容回答问题，不编造任何知识库中没有的内容。

知识库内容：
${context}`,
      },
      { role: 'user', content: question },
    ],
  })

  console.log(`\n回答:\n${response.choices[0].message.content}`)
}

// ─── 主入口 ─────���─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = new InMemoryVectorDB()

  // 阶段一：构建索引（一次性操作）
  await phaseIndexing(db)

  // 阶段二 + 三：检索 + 生成（每次查询都会执行）
  const question = 'API 请求频率太高被拒绝了，怎么处理？'
  const contextDocs = await phaseRetrieval(db, question)
  await phaseGeneration(question, contextDocs)

  // 演示：知识库外的问题
  printSection('边界测试：知识库外的问题')
  const outOfScopeQuestion = '支持微信支付吗？'
  const outOfScopeContext = await phaseRetrieval(db, outOfScopeQuestion)
  await phaseGeneration(outOfScopeQuestion, outOfScopeContext)
}

main().catch(console.error)
