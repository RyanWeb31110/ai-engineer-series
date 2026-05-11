/**
 * 18-llmops / ragas-metrics.ts
 *
 * LLM-as-Judge 评估指标实现（RAGAS 核心三件套）
 *
 * 三个指标：
 *   faithfulness       → 答案是否忠实于提供的上下文（防幻觉）
 *   answerRelevancy    → 答案是否针对问题（防跑题）
 *   contextPrecision   → 检索到的上下文和问题的相关度（防召回噪音）
 *
 * 每个指标都输出 0~1 的分数，越高越好。
 *
 * 运行：pnpm ragas-metrics
 */

import { readFileSync } from 'fs'
import { chat, MODELS } from '@ai-series/shared'
import type { Message } from '@ai-series/shared'

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

// ─── 工具：强制 LLM 输出 JSON（带重试） ─────────────────────────────────────

async function judgeWithJson<T>(prompt: string, systemPrompt: string): Promise<T> {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  // 中转站偶尔返回空响应，重试最多 3 次
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chat(messages, {
        model: MODELS.GPT5_CODEX,
        maxTokens: 500,
        temperature: 0,
      })

      const content = response.content.trim()
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/\{[\s\S]*\}/)
      const rawJson = jsonMatch ? (Array.isArray(jsonMatch) && jsonMatch[1] ? jsonMatch[1] : jsonMatch[0]) : content

      return JSON.parse(rawJson) as T
    } catch (err) {
      lastErr = err
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1500))
      }
    }
  }
  throw lastErr
}

// ─── 指标 1：Faithfulness（答案忠实度） ──────────────────────────────────────
//
// 思路：把答案拆成若干"事实陈述"，逐条判断是否能从上下文中推出。
// 分数 = 可推出的陈述数 / 总陈述数。

interface FaithfulnessJudgement {
  statements: string[]
  verdicts: { statement: string; supported: boolean; reason: string }[]
}

export async function faithfulness(answer: string, context: string): Promise<{ score: number; detail: FaithfulnessJudgement }> {
  const systemPrompt = `你是一个严格的事实核查员。你需要把答案拆成若干独立的事实陈述，然后判断每条陈述是否能从给定的上下文中推出。
只输出 JSON，格式：
{
  "statements": ["陈述1", "陈述2"],
  "verdicts": [
    { "statement": "陈述1", "supported": true, "reason": "上下文中明确提到..." },
    { "statement": "陈述2", "supported": false, "reason": "上下文中没有提到..." }
  ]
}`

  const prompt = `【上下文】
${context}

【答案】
${answer}

请拆解答案并逐条核查。`

  const detail = await judgeWithJson<FaithfulnessJudgement>(prompt, systemPrompt)
  const supported = detail.verdicts.filter(v => v.supported).length
  const score = detail.verdicts.length === 0 ? 0 : supported / detail.verdicts.length

  return { score, detail }
}

// ─── 指标 2：AnswerRelevancy（答案相关度） ──────────────────────────────────
//
// 思路：让 LLM 根据答案"反推"出若干个问题，计算这些问题和原问题的语义相似度。
// 这里为了简化，直接让 LLM 给出 0-1 的评分（标准 RAGAS 用 embedding 算相似度）。

interface RelevancyJudgement {
  score: number
  reason: string
  reversedQuestions: string[]
}

export async function answerRelevancy(question: string, answer: string): Promise<{ score: number; detail: RelevancyJudgement }> {
  const systemPrompt = `你是一个问答相关性评估员。根据答案反推出 3 个可能的问题，然后评估这些反推问题和原问题的相关度。
只输出 JSON，格式：
{
  "reversedQuestions": ["反推问题1", "反推问题2", "反推问题3"],
  "score": 0.85,
  "reason": "反推问题和原问题方向一致..."
}
评分标准：
- 1.0：答案完全针对问题，没有跑题
- 0.7-0.9：答案基本相关，有少量无关内容
- 0.3-0.6：答案部分相关，大量无关内容
- 0-0.2：答案完全跑题`

  const prompt = `【原问题】
${question}

【答案】
${answer}

请反推问题并评分。`

  const detail = await judgeWithJson<RelevancyJudgement>(prompt, systemPrompt)
  return { score: Math.max(0, Math.min(1, detail.score)), detail }
}

// ─── 指标 3：ContextPrecision（上下文精度） ─────────────────────────────────
//
// 思路：对每个检索到的上下文片段，判断它是否和回答问题有关。
// 分数 = 相关片段的加权平均（前排片段权重更高）。

interface PrecisionJudgement {
  verdicts: { chunkIndex: number; relevant: boolean; reason: string }[]
}

export async function contextPrecision(question: string, chunks: string[]): Promise<{ score: number; detail: PrecisionJudgement }> {
  const systemPrompt = `你是一个检索相关性评估员。对每个上下文片段，判断它对回答问题是否有直接帮助。
只输出 JSON，格式：
{
  "verdicts": [
    { "chunkIndex": 0, "relevant": true, "reason": "包含了问题的直接答案" },
    { "chunkIndex": 1, "relevant": false, "reason": "和问题主题无关" }
  ]
}`

  const prompt = `【问题】
${question}

【检索到的上下文片段】
${chunks.map((c, i) => `[${i}] ${c}`).join('\n')}

请逐条评估相关性。`

  const detail = await judgeWithJson<PrecisionJudgement>(prompt, systemPrompt)

  // 按 RAGAS 原始公式：sum(precision@k * v_k) / sum(v_k)
  // 其中 precision@k 是前 k 条里相关片段的比例，v_k 是第 k 条是否相关
  let sumWeighted = 0
  let relevantCount = 0
  for (let k = 0; k < detail.verdicts.length; k++) {
    const v = detail.verdicts[k]
    if (v.relevant) {
      relevantCount++
      const precisionAtK = relevantCount / (k + 1)
      sumWeighted += precisionAtK
    }
  }
  const score = relevantCount === 0 ? 0 : sumWeighted / relevantCount

  return { score, detail }
}

// ─── Demo：用一个正面案例和一个负面案例对比 ────────────────────────────────

async function runDemo(): Promise<void> {
  console.log('='.repeat(60))
  console.log('RAGAS 三件套指标 Demo')
  console.log('='.repeat(60))

  // 案例 1：好答案（高 faithfulness + 高 relevancy）
  console.log('\n【案例 1：高质量答案】')
  const question1 = 'Next.js 15 默认使用的路由方式是什么'
  const context1 = 'Next.js 15 引入了 App Router 作为默认的路由方式，取代了旧的 Pages Router。'
  const answer1 = 'Next.js 15 默认使用 App Router，取代了旧的 Pages Router。'

  const [f1, r1, p1] = await Promise.all([
    faithfulness(answer1, context1),
    answerRelevancy(question1, answer1),
    contextPrecision(question1, [context1, 'PostgreSQL 17 改进了 VACUUM 性能。']),
  ])

  console.log(`  faithfulness     : ${f1.score.toFixed(2)}`)
  console.log(`  answerRelevancy  : ${r1.score.toFixed(2)}`)
  console.log(`  contextPrecision : ${p1.score.toFixed(2)}`)

  // 案例 2：差答案（幻觉 + 部分跑题）
  console.log('\n【案例 2：有幻觉 + 跑题的答案】')
  const question2 = 'Next.js 15 默认使用的路由方式是什么'
  const context2 = 'Next.js 15 引入了 App Router 作为默认的路由方式，取代了旧的 Pages Router。'
  const answer2 = 'Next.js 15 默认使用 Pages Router，支持文件系统路由。同时它还内置了 GraphQL 支持，可以自动生成 API。'

  const [f2, r2, p2] = await Promise.all([
    faithfulness(answer2, context2),
    answerRelevancy(question2, answer2),
    contextPrecision(question2, [context2, 'Tailwind CSS v4 用 Rust 引擎。']),
  ])

  console.log(`  faithfulness     : ${f2.score.toFixed(2)}  ← 应该很低（有幻觉）`)
  console.log(`  answerRelevancy  : ${r2.score.toFixed(2)}  ← 应该中等（部分跑题）`)
  console.log(`  contextPrecision : ${p2.score.toFixed(2)}`)

  console.log('\n' + '='.repeat(60))
  console.log('结论：同样的问题，不同答案质量，三项指标能清晰区分。')
  console.log('这就是为什么离线评估比人眼抽查更可靠——指标可量化、可自动化、可回归。')
  console.log('='.repeat(60))
}

await runDemo()
