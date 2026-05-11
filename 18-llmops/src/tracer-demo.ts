/**
 * 18-llmops / tracer-demo.ts
 *
 * 演示 Tracer 的使用：模拟一次完整的 RAG 调用流程
 *
 * Trace: rag-query
 * ├─ Span: retrieve                （向量检索）
 * ├─ Span: rerank                  （重排序）
 * └─ Generation: answer             （LLM 生成答案）
 *
 * 运行完成后，traces/<traceId>.jsonl 会记录所有观测数据，
 * 可以直接用于后续的性能分析、成本统计、Bad Case 回放。
 *
 * 运行：pnpm tracer-demo
 */

import { readFileSync, readdirSync } from 'fs'
import { chat, MODELS } from '@ai-series/shared'
import type { Message, LLMConfig, LLMResponse } from '@ai-series/shared'
import { Tracer, type Observation } from './tracer.js'

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
} catch { /* 使用系统环境变量 */ }

// ─── 模拟 RAG 的知识库 ──────────────────────────────────────────────────────

const KNOWLEDGE_BASE = [
  { id: 'doc1', text: 'Next.js 15 引入了 App Router 作为默认的路由方式，取代了旧的 Pages Router。' },
  { id: 'doc2', text: 'React 19 正式支持 Server Components，允许组件在服务端渲染。' },
  { id: 'doc3', text: 'Tailwind CSS v4 改用 Rust 编写的引擎，构建速度比 v3 快 10 倍以上。' },
  { id: 'doc4', text: 'PostgreSQL 17 改进了 VACUUM 性能，长时间运行的事务影响更小。' },
  { id: 'doc5', text: 'Claude Opus 4.6 支持 1M 上下文窗口，适合处理整个代码仓库级别的任务。' },
]

// 中转站偶尔返回空响应，重试最多 3 次
async function chatWithRetry(messages: Message[], config: LLMConfig): Promise<LLMResponse> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chat(messages, config)
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 1500))
    }
  }
  throw lastErr
}

// 模拟检索：按关键词简单匹配
function mockRetrieve(query: string, topK: number): typeof KNOWLEDGE_BASE {
  const keywords = query.toLowerCase().split(/\s+/)
  return KNOWLEDGE_BASE
    .map(doc => ({
      doc,
      score: keywords.filter(k => doc.text.toLowerCase().includes(k)).length,
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.doc)
}

// 模拟重排序：这里简单反转，实际会调用 rerank 模型
function mockRerank(docs: typeof KNOWLEDGE_BASE): typeof KNOWLEDGE_BASE {
  return [...docs].reverse()
}

// ─── 一次完整的 RAG 调用（带 Tracing） ──────────────────────────────────────

const tracer = new Tracer({ console: true, outDir: './traces' })

async function runRagQuery(query: string, userId: string): Promise<string> {
  const trace = tracer.trace('rag-query', { userId, query })

  // Step 1: 向量检索
  const retrieveSpan = trace.span('retrieve', { topK: 3 })
  const retrieved = mockRetrieve(query, 3)
  retrieveSpan.end({ hits: retrieved.length, docIds: retrieved.map(d => d.id) })

  // Step 2: 重排序
  const rerankSpan = trace.span('rerank')
  const reranked = mockRerank(retrieved)
  rerankSpan.end({ orderedIds: reranked.map(d => d.id) })

  // Step 3: LLM 生成答案
  const context = reranked.map(d => `[${d.id}] ${d.text}`).join('\n')
  const messages: Message[] = [
    { role: 'system', content: '你是一个技术问答助手。基于提供的上下文回答问题，答案控制在 50 字以内。' },
    { role: 'user', content: `上下文:\n${context}\n\n问题: ${query}` },
  ]

  const generation = trace.generation('answer', {
    model: MODELS.GPT5_CODEX,
    input: messages,
    metadata: { contextDocCount: reranked.length },
  })

  try {
    const response = await chatWithRetry(messages, {
      model: MODELS.GPT5_CODEX,
      maxTokens: 150,
      temperature: 0,
    })

    generation.end({
      output: response.content,
      usage: response.usage,
    })
    trace.end({ answer: response.content })
    return response.content
  } catch (err) {
    const error = err as Error
    generation.end({ usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, error })
    trace.end({ error: error.message })
    throw err
  }
}

// ─── 从 JSONL 汇总 Trace 统计信息 ───────────────────────────────────────────

interface TraceSummary {
  traceId: string
  name: string
  durationMs: number
  totalTokens: number
  totalCostUsd: number
  spanCount: number
  generationCount: number
}

function summarizeTraces(outDir: string): TraceSummary[] {
  const files = readdirSync(outDir).filter(f => f.endsWith('.jsonl'))
  const summaries: TraceSummary[] = []

  for (const file of files) {
    const lines = readFileSync(`${outDir}/${file}`, 'utf-8').split('\n').filter(Boolean)
    const observations = lines.map(l => JSON.parse(l) as Observation)

    const traceEnd = observations.find(o => o.type === 'trace' && o.endTime)
    if (!traceEnd) continue

    let totalTokens = 0
    let totalCostUsd = 0
    let spanCount = 0
    let generationCount = 0

    for (const o of observations) {
      if (o.type === 'span' && o.endTime) spanCount++
      if (o.type === 'generation' && o.endTime) {
        generationCount++
        totalTokens += o.usage?.totalTokens ?? 0
        totalCostUsd += o.costUsd ?? 0
      }
    }

    summaries.push({
      traceId: traceEnd.traceId,
      name: traceEnd.name.replace(' [end]', ''),
      durationMs: traceEnd.durationMs ?? 0,
      totalTokens,
      totalCostUsd,
      spanCount,
      generationCount,
    })
  }

  return summaries
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('Tracer Demo: 3 RAG queries with full observability')
console.log('='.repeat(60))

const queries = [
  'Next.js 15 有什么新特性',
  'Tailwind CSS v4 的性能改进',
  'Claude Opus 4.6 上下文窗口多大',
]

for (const q of queries) {
  console.log(`\n[Query] ${q}`)
  const answer = await runRagQuery(q, 'demo-user')
  console.log(`[Answer] ${answer}`)
}

// 从 JSONL 汇总所有 trace
console.log('\n' + '='.repeat(60))
console.log('Trace summary (loaded from JSONL):')
console.log('='.repeat(60))

const summaries = summarizeTraces('./traces')
for (const s of summaries) {
  console.log(
    `  ${s.name.padEnd(12)} | ${String(s.durationMs).padStart(5)}ms | ${String(s.totalTokens).padStart(5)}tok | $${s.totalCostUsd.toFixed(6)} | spans=${s.spanCount} gens=${s.generationCount}`,
  )
}

const aggregate = summaries.reduce(
  (acc, s) => ({
    tokens: acc.tokens + s.totalTokens,
    cost: acc.cost + s.totalCostUsd,
    duration: acc.duration + s.durationMs,
  }),
  { tokens: 0, cost: 0, duration: 0 },
)

console.log('\n' + '-'.repeat(60))
console.log(`  Aggregate: ${summaries.length} traces, ${aggregate.tokens} tokens, $${aggregate.cost.toFixed(6)}, ${aggregate.duration}ms total`)
console.log('='.repeat(60))
console.log('\nRaw trace data: ./traces/<traceId>.jsonl')
console.log('每行一条观测记录，可以用 jq、DuckDB 或直接导入 LangFuse 分析。')
