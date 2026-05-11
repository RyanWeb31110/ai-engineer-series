/**
 * 18-llmops / evaluation-runner.ts
 *
 * 离线评估流水线：用小规模数据集跑完整的 RAGAS 评估
 *
 * 流程：
 *   1. 加载 eval dataset（question + ground_truth_context + reference_answer）
 *   2. 对每条数据跑 RAG pipeline，得到检索上下文 + 生成答案
 *   3. 对生成答案跑 faithfulness / answerRelevancy / contextPrecision
 *   4. 汇总结果，输出报告（均值、方差、pass/fail）
 *
 * 这是 LLMOps 的核心实践之一：把"模型效果"变成可以回归测试的数值。
 *
 * 运行：pnpm evaluation-runner
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { chat, MODELS } from '@ai-series/shared'
import type { Message, LLMConfig, LLMResponse } from '@ai-series/shared'
import { Tracer } from './tracer.js'
import { faithfulness, answerRelevancy, contextPrecision } from './ragas-metrics.js'

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

// ─── 评估数据集 ──────────────────────────────────────────────────────────────
// 真实项目里通常放在 JSON/CSV 文件里，每次 PR 跑一次做回归。

interface EvalCase {
  id: string
  question: string
  /** 真实相关的文档 ID（用于计算 Recall） */
  relevantDocIds: string[]
  /** 参考答案（人工标注，可选） */
  referenceAnswer?: string
}

const EVAL_DATASET: EvalCase[] = [
  {
    id: 'case-1',
    question: 'Next.js 15 默认使用什么路由方式',
    relevantDocIds: ['doc1'],
    referenceAnswer: 'App Router',
  },
  {
    id: 'case-2',
    question: 'Tailwind CSS v4 相比 v3 有什么性能提升',
    relevantDocIds: ['doc3'],
    referenceAnswer: '构建速度快 10 倍以上',
  },
  {
    id: 'case-3',
    question: 'Claude Opus 4.6 支持多大的上下文',
    relevantDocIds: ['doc5'],
    referenceAnswer: '1M tokens',
  },
]

// ─── 模拟知识库 + 检索 ──────────────────────────────────────────────────────

const KNOWLEDGE_BASE = [
  { id: 'doc1', text: 'Next.js 15 引入了 App Router 作为默认的路由方式，取代了旧的 Pages Router。' },
  { id: 'doc2', text: 'React 19 正式支持 Server Components。' },
  { id: 'doc3', text: 'Tailwind CSS v4 改用 Rust 编写的引擎，构建速度比 v3 快 10 倍以上。' },
  { id: 'doc4', text: 'PostgreSQL 17 改进了 VACUUM 性能。' },
  { id: 'doc5', text: 'Claude Opus 4.6 支持 1M 上下文窗口，适合处理整个代码仓库级别的任务。' },
]

function retrieve(query: string, topK: number): typeof KNOWLEDGE_BASE {
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

async function generateAnswer(question: string, context: string): Promise<string> {
  const messages: Message[] = [
    { role: 'system', content: '基于上下文回答问题，答案控制在 50 字以内，不要编造上下文没有的信息。' },
    { role: 'user', content: `上下文:\n${context}\n\n问题: ${question}` },
  ]
  const response = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 150,
    temperature: 0,
  })
  return response.content
}

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

// ─── 单条用例的评估 ──────────────────────────────────────────────────────────

interface EvalResult {
  caseId: string
  question: string
  answer: string
  faithfulness: number
  answerRelevancy: number
  contextPrecision: number
  /** 检索召回率：相关文档有多少被检出 */
  contextRecall: number
  overallScore: number
}

async function evaluateCase(testCase: EvalCase, tracer: Tracer): Promise<EvalResult> {
  const trace = tracer.trace('eval-case', { caseId: testCase.id })

  // 检索
  const retrieveSpan = trace.span('retrieve')
  const retrieved = retrieve(testCase.question, 3)
  const retrievedIds = retrieved.map(d => d.id)
  retrieveSpan.end({ docIds: retrievedIds })

  // Recall = 检出的相关文档数 / 真实相关文档总数
  const hitCount = testCase.relevantDocIds.filter(id => retrievedIds.includes(id)).length
  const contextRecall = testCase.relevantDocIds.length === 0 ? 0 : hitCount / testCase.relevantDocIds.length

  // 生成答案
  const context = retrieved.map(d => d.text).join('\n')
  const generation = trace.generation('answer', { model: MODELS.GPT5_CODEX, input: testCase.question })
  const answer = await generateAnswer(testCase.question, context)
  // 生成答案时没拿到 usage，这里传零值（简化处理）
  generation.end({ output: answer, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })

  // 并行跑三个 LLM-as-Judge 指标
  const judgeSpan = trace.span('judge')
  const [f, r, p] = await Promise.all([
    faithfulness(answer, context),
    answerRelevancy(testCase.question, answer),
    contextPrecision(testCase.question, retrieved.map(d => d.text)),
  ])
  judgeSpan.end({ f: f.score, r: r.score, p: p.score })

  const overallScore = (f.score + r.score + p.score + contextRecall) / 4
  trace.end({ overallScore })

  return {
    caseId: testCase.id,
    question: testCase.question,
    answer,
    faithfulness: f.score,
    answerRelevancy: r.score,
    contextPrecision: p.score,
    contextRecall,
    overallScore,
  }
}

// ─── 主逻辑：跑完整数据集 + 汇总报告 ────────────────────────────────────────

const PASS_THRESHOLD = 0.7

console.log('='.repeat(60))
console.log(`Offline Evaluation | ${EVAL_DATASET.length} cases | threshold=${PASS_THRESHOLD}`)
console.log('='.repeat(60))

const tracer = new Tracer({ outDir: './traces' })
const results: EvalResult[] = []

for (const testCase of EVAL_DATASET) {
  console.log(`\n[${testCase.id}] ${testCase.question}`)
  const result = await evaluateCase(testCase, tracer)
  results.push(result)
  console.log(`  answer            : ${result.answer.slice(0, 80)}${result.answer.length > 80 ? '...' : ''}`)
  console.log(`  faithfulness      : ${result.faithfulness.toFixed(2)}`)
  console.log(`  answerRelevancy   : ${result.answerRelevancy.toFixed(2)}`)
  console.log(`  contextPrecision  : ${result.contextPrecision.toFixed(2)}`)
  console.log(`  contextRecall     : ${result.contextRecall.toFixed(2)}`)
  console.log(`  overallScore      : ${result.overallScore.toFixed(2)} ${result.overallScore >= PASS_THRESHOLD ? '✓' : '✗'}`)
}

// 汇总
console.log('\n' + '='.repeat(60))
console.log('Aggregate Report')
console.log('='.repeat(60))

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

const avgF = avg(results.map(r => r.faithfulness))
const avgR = avg(results.map(r => r.answerRelevancy))
const avgP = avg(results.map(r => r.contextPrecision))
const avgRecall = avg(results.map(r => r.contextRecall))
const avgOverall = avg(results.map(r => r.overallScore))
const passRate = results.filter(r => r.overallScore >= PASS_THRESHOLD).length / results.length

console.log(`  avg faithfulness     : ${avgF.toFixed(3)}`)
console.log(`  avg answerRelevancy  : ${avgR.toFixed(3)}`)
console.log(`  avg contextPrecision : ${avgP.toFixed(3)}`)
console.log(`  avg contextRecall    : ${avgRecall.toFixed(3)}`)
console.log(`  avg overallScore     : ${avgOverall.toFixed(3)}`)
console.log(`  pass rate            : ${(passRate * 100).toFixed(1)}% (${results.filter(r => r.overallScore >= PASS_THRESHOLD).length}/${results.length})`)

// 持久化报告
mkdirSync('./reports', { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportPath = `./reports/eval-${timestamp}.json`
writeFileSync(
  reportPath,
  JSON.stringify({
    timestamp,
    threshold: PASS_THRESHOLD,
    dataset: EVAL_DATASET.length,
    aggregate: {
      faithfulness: avgF,
      answerRelevancy: avgR,
      contextPrecision: avgP,
      contextRecall: avgRecall,
      overallScore: avgOverall,
      passRate,
    },
    results,
  }, null, 2),
  'utf-8',
)

console.log(`\nReport saved to ${reportPath}`)
console.log(`Raw traces in ./traces/`)

if (passRate < 1) {
  console.log('\n⚠  部分用例未达标，真实项目里这里可以 process.exit(1) 阻断 CI')
}
