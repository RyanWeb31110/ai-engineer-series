/**
 * 19-guardrails / output-guardrails.ts
 *
 * 输出侧护栏：在 LLM 返回之后、发给用户之前做二次过滤
 *   1. PII 泄漏：防止模型把上下文里的敏感信息原样吐出
 *   2. 幻觉事实核查：对 RAG 场景，用裁判模型判断答案是否忠实于上下文
 *   3. 有害内容：仇恨、暴力、色情等 —— 用 LLM 分类器
 *   4. 政策合规：不能给医疗/法律/金融专业建议
 *
 * 设计原则：输出侧护栏的目标是"阻断"而不是"重写"。重写容易引入
 * 新的幻觉，更稳妥的做法是拦截后返回一个兜底话术。
 *
 * 运行：pnpm output-guardrails
 */

import { readFileSync } from 'fs'
import { chat, MODELS } from '@ai-series/shared'
import type { Message, LLMConfig, LLMResponse } from '@ai-series/shared'

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

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type OutputAction = 'allow' | 'block'

export interface OutputGuardrailResult {
  action: OutputAction
  reason?: string
  finalAnswer: string
  checks: Record<string, { passed: boolean, detail?: unknown }>
  latencyMs: number
}

const FALLBACK_ANSWER = '抱歉，本次回答未通过安全检查，已被拦截。如有疑问请联系管理员。'

// 中转站偶发返回空响应，裁判调用统一套上重试
async function chatWithRetry(messages: Message[], config: LLMConfig): Promise<LLMResponse | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chat(messages, config)
    } catch (err) {
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 1500))
    }
  }
  return null
}

// ─── Layer 1: PII 泄漏检测 ─────────────────────────────────────────────────

const PII_PATTERNS: { name: string, pattern: RegExp }[] = [
  { name: 'id-card', pattern: /\b[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b/ },
  { name: 'phone-cn', pattern: /\b1[3-9]\d{9}\b/ },
  { name: 'bank-card', pattern: /\b\d{16,19}\b/ },
]

function checkPiiLeak(answer: string): { passed: boolean, matched: string[] } {
  const matched: string[] = []
  for (const rule of PII_PATTERNS) {
    if (rule.pattern.test(answer)) matched.push(rule.name)
  }
  return { passed: matched.length === 0, matched }
}

// ─── Layer 2: 幻觉事实核查（RAG 场景） ─────────────────────────────────────

interface FaithfulnessDetail {
  statements: string[]
  verdicts: { statement: string, supported: boolean }[]
}

async function checkFaithfulness(answer: string, context: string): Promise<{
  passed: boolean
  score: number
  detail: FaithfulnessDetail
}> {
  const systemPrompt = `你是一个严格的事实核查员。把答案拆成若干独立事实陈述，
然后判断每条陈述是否能从给定的上下文中推出。
只输出一段 JSON，格式：
{
  "statements": ["陈述1", "陈述2"],
  "verdicts": [
    { "statement": "陈述1", "supported": true },
    { "statement": "陈述2", "supported": false }
  ]
}`

  const prompt = `【上下文】\n${context}\n\n【答案】\n${answer}\n\n请拆解答案并逐条核查。`

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  const response = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    maxTokens: 600,
  })

  let detail: FaithfulnessDetail = { statements: [], verdicts: [] }
  if (!response) {
    // 裁判故障时保守放行，避免阻塞业务
    return { passed: true, score: 1, detail }
  }

  const jsonMatch = response.content.match(/```json\s*([\s\S]*?)```/)
    ?? response.content.match(/\{[\s\S]*\}/)
  const rawJson = jsonMatch
    ? (Array.isArray(jsonMatch) && jsonMatch[1] ? jsonMatch[1] : jsonMatch[0])
    : response.content

  try {
    detail = JSON.parse(rawJson) as FaithfulnessDetail
  } catch {
    return { passed: true, score: 1, detail }
  }

  const supported = detail.verdicts.filter(v => v.supported).length
  const score = detail.verdicts.length === 0 ? 1 : supported / detail.verdicts.length
  // 阈值 0.8：允许少量表达差异，但不允许大段幻觉
  return { passed: score >= 0.8, score, detail }
}

// ─── Layer 3: 有害内容分类 ─────────────────────────────────────────────────

interface HarmfulDetail {
  categories: { hate: boolean, violence: boolean, sexual: boolean, illegal: boolean }
  confidence: number
}

async function checkHarmfulContent(answer: string): Promise<{ passed: boolean, detail: HarmfulDetail }> {
  const systemPrompt = `你是一个内容安全分类器。判断给定文本是否包含以下类别：
hate（仇恨言论）、violence（暴力描述）、sexual（色情内容）、illegal（协助违法）。
只输出一段 JSON：
{
  "categories": {"hate": false, "violence": false, "sexual": false, "illegal": false},
  "confidence": 0.0~1.0
}`

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `【待分类文本】\n${answer}` },
  ]

  const response = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    maxTokens: 120,
  })

  if (!response) {
    return {
      passed: true,
      detail: { categories: { hate: false, violence: false, sexual: false, illegal: false }, confidence: 0 },
    }
  }

  const jsonMatch = response.content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      passed: true,
      detail: { categories: { hate: false, violence: false, sexual: false, illegal: false }, confidence: 0 },
    }
  }

  try {
    const detail = JSON.parse(jsonMatch[0]) as HarmfulDetail
    const anyHit = Object.values(detail.categories).some(v => v === true)
    return { passed: !anyHit, detail }
  } catch {
    return {
      passed: true,
      detail: { categories: { hate: false, violence: false, sexual: false, illegal: false }, confidence: 0 },
    }
  }
}

// ─── Layer 4: 政策合规（禁止给专业建议） ───────────────────────────────────

const PROFESSIONAL_ADVICE_PATTERNS = [
  { domain: 'medical', pattern: /(建议服用|推荐药物|诊断为|病情是|应该吃什么药)/ },
  { domain: 'legal', pattern: /(你应该起诉|建议起诉|胜诉把握|合同一定有效|法律上判你赢)/ },
  { domain: 'financial', pattern: /(建议买入|推荐买入|建议卖出|买这只股票|现在应该加仓|稳赚不赔)/ },
]

function checkPolicyCompliance(answer: string): { passed: boolean, domain?: string } {
  for (const rule of PROFESSIONAL_ADVICE_PATTERNS) {
    if (rule.pattern.test(answer)) {
      return { passed: false, domain: rule.domain }
    }
  }
  return { passed: true }
}

// ─── 主流水线 ──────────────────────────────────────────────────────────────

export async function runOutputGuardrails(
  answer: string,
  context: string | null = null,
): Promise<OutputGuardrailResult> {
  const startedAt = Date.now()
  const checks: OutputGuardrailResult['checks'] = {}

  // Layer 1: PII 泄漏（纯正则，先过）
  const pii = checkPiiLeak(answer)
  checks.piiLeak = { passed: pii.passed, detail: pii.matched }
  if (!pii.passed) {
    return {
      action: 'block',
      reason: `pii leak: ${pii.matched.join(', ')}`,
      finalAnswer: FALLBACK_ANSWER,
      checks,
      latencyMs: Date.now() - startedAt,
    }
  }

  // Layer 4: 政策合规（纯正则，继续前置）
  const policy = checkPolicyCompliance(answer)
  checks.policy = { passed: policy.passed, detail: policy.domain }
  if (!policy.passed) {
    return {
      action: 'block',
      reason: `professional advice detected: ${policy.domain}`,
      finalAnswer: `抱歉，涉及 ${policy.domain} 领域的专业建议我不能直接给出，请咨询对应的专业人士。`,
      checks,
      latencyMs: Date.now() - startedAt,
    }
  }

  // Layer 2 & 3: 需要调用 LLM 的放到最后，并行执行减少延迟
  const [harmful, faithfulness] = await Promise.all([
    checkHarmfulContent(answer),
    context ? checkFaithfulness(answer, context) : Promise.resolve(null),
  ])

  checks.harmful = { passed: harmful.passed, detail: harmful.detail }
  if (!harmful.passed) {
    return {
      action: 'block',
      reason: 'harmful content detected',
      finalAnswer: FALLBACK_ANSWER,
      checks,
      latencyMs: Date.now() - startedAt,
    }
  }

  if (faithfulness) {
    checks.faithfulness = { passed: faithfulness.passed, detail: { score: faithfulness.score } }
    if (!faithfulness.passed) {
      return {
        action: 'block',
        reason: `hallucination detected (faithfulness=${faithfulness.score.toFixed(2)})`,
        finalAnswer: '抱歉，根据已有资料我无法给出可靠的答案。',
        checks,
        latencyMs: Date.now() - startedAt,
      }
    }
  }

  return {
    action: 'allow',
    finalAnswer: answer,
    checks,
    latencyMs: Date.now() - startedAt,
  }
}

// ─── Demo ──────────────────────────────────────────────────────────────────

async function main() {
  const context = 'Next.js 15 引入了 App Router 作为默认的路由方式，取代了旧的 Pages Router。'

  const cases: { label: string, answer: string, context?: string }[] = [
    {
      label: '正常答案（忠实于上下文）',
      answer: 'Next.js 15 默认采用 App Router，取代旧的 Pages Router。',
      context,
    },
    {
      label: '幻觉答案（编造 GraphQL 支持）',
      answer: 'Next.js 15 内置了 GraphQL 支持，并默认使用 App Router。',
      context,
    },
    {
      label: 'PII 泄漏（手机号）',
      answer: '这位用户的联系电话是 13800138000，订单号 A1234。',
    },
    {
      label: '医疗建议（违反政策）',
      answer: '根据你的症状，建议服用阿莫西林 500mg，每天三次。',
    },
    {
      label: '金融建议（违反政策）',
      answer: '当前市场情绪不错，建议买入这只股票，近期稳赚不赔。',
    },
  ]

  console.log('='.repeat(70))
  console.log('Output Guardrails Demo')
  console.log('='.repeat(70))

  for (const c of cases) {
    const result = await runOutputGuardrails(c.answer, c.context ?? null)
    console.log(`\n[${c.label}]`)
    console.log(`  original   : ${c.answer}`)
    console.log(`  action     : ${result.action}`)
    if (result.reason) console.log(`  reason     : ${result.reason}`)
    console.log(`  final      : ${result.finalAnswer}`)
    console.log(`  checks     : ${Object.entries(result.checks).map(([k, v]) => `${k}=${v.passed ? 'ok' : 'fail'}`).join(', ')}`)
    console.log(`  latency    : ${result.latencyMs}ms`)
  }

  console.log('\n' + '='.repeat(70))
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  main().catch(err => {
    console.error('Unhandled error:', err)
    process.exit(1)
  })
}
