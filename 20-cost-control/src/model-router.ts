// 模型路由演示
// 根据输入特征把请求路由到不同档位（small / medium / large），
// 同时提供一个 LLM 分类器作为规则模糊时的兜底（可按需开启）

import './env.js'

import type { Message } from '@ai-series/shared'
import { chat } from '@ai-series/shared'

import { PROFILES, calcCost, formatUSD, type ModelTier } from './pricing.js'

interface RouteDecision {
  tier: ModelTier
  reason: string
  matched: string[]
}

// 规则层：零成本启发式分类
// 返回 null 表示规则无法确信，需要调用 LLM 分类器兜底
function classifyByRule(input: string): RouteDecision | null {
  const matched: string[] = []
  const lower = input.toLowerCase()

  // 复杂任务关键词：设计、推理、对比、trade-off、分布式、架构等
  const heavyKeywords = [
    '设计', '架构', '推理', '证明', '对比', '权衡', '综述',
    '多步', '分布式', '一致性', '事务', '方案', 'trade-off',
    'design', 'architecture', 'reasoning', 'compare', 'trade off',
  ]
  for (const k of heavyKeywords) {
    if (lower.includes(k)) matched.push(`heavy:${k}`)
  }
  if (matched.length > 0) {
    return { tier: 'large', reason: 'heavy-keyword', matched }
  }

  // 简单任务特征：很短 + 问候 / 寒暄 / 感谢
  const lightKeywords = ['你好', '您好', '谢谢', '多谢', 'hi', 'hello', 'thanks', 'thank you', 'ok']
  const trimmed = input.trim()
  if (trimmed.length <= 25) {
    for (const k of lightKeywords) {
      if (lower.includes(k)) matched.push(`light:${k}`)
    }
    if (matched.length > 0 || trimmed.length <= 6) {
      return { tier: 'small', reason: 'short-or-greeting', matched }
    }
  }

  // 长度过长必定不是 small；在 medium 与 large 之间不确定，交给 LLM 兜底
  if (trimmed.length >= 120) {
    return null
  }

  // 默认走 medium
  return { tier: 'medium', reason: 'default', matched: [] }
}

// LLM 分类层：启发式模糊时调用便宜模型做二次判断
// 失败时保守回落到 medium，避免阻塞
async function classifyByLLM(input: string): Promise<RouteDecision> {
  const systemPrompt = `You are a request complexity classifier.
Classify the user request into one of: small, medium, large.
- small: greetings, classification, short factual questions
- medium: typical Q&A, summaries, light coding help
- large: multi-step reasoning, architecture, design trade-offs

Respond with a single JSON object: {"tier":"small|medium|large","confidence":0.0-1.0}`

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ]

  try {
    const response = await chat(messages, {
      model: PROFILES.small.model,
      temperature: 0,
      maxTokens: 40,
    })
    const match = response.content.match(/\{[\s\S]*?\}/)
    if (!match) return { tier: 'medium', reason: 'llm-fallback', matched: ['llm:no-json'] }
    const parsed = JSON.parse(match[0]) as { tier?: string, confidence?: number }
    if (parsed.tier === 'small' || parsed.tier === 'medium' || parsed.tier === 'large') {
      return {
        tier: parsed.tier,
        reason: `llm-classifier(conf=${(parsed.confidence ?? 0).toFixed(2)})`,
        matched: ['llm:classifier'],
      }
    }
    return { tier: 'medium', reason: 'llm-invalid-tier', matched: ['llm:invalid'] }
  } catch {
    return { tier: 'medium', reason: 'llm-error', matched: ['llm:error'] }
  }
}

export async function routeDecide(input: string): Promise<RouteDecision> {
  const ruleDecision = classifyByRule(input)
  if (ruleDecision) return ruleDecision
  return classifyByLLM(input)
}

export interface RoutedResponse {
  decision: RouteDecision
  answer: string
  inputTokens: number
  outputTokens: number
  cost: number
  totalLatencyMs: number
  routeLatencyMs: number
}

export async function routeChat(input: string): Promise<RoutedResponse> {
  const startedAt = Date.now()
  const decision = await routeDecide(input)
  const routeLatencyMs = Date.now() - startedAt

  const profile = PROFILES[decision.tier]
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant. Answer in Simplified Chinese.' },
    { role: 'user', content: input },
  ]
  const response = await chat(messages, {
    model: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  })

  const cost = calcCost(
    decision.tier,
    response.usage.inputTokens,
    response.usage.outputTokens,
  )

  return {
    decision,
    answer: response.content,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost,
    totalLatencyMs: Date.now() - startedAt,
    routeLatencyMs,
  }
}

const SAMPLES = [
  '你好，最近怎么样？',
  '用一句话解释什么是闭包？',
  '请设计一个支持跨机房容灾的分布式事务方案，对比 2PC、TCC、Saga 的 trade-off。',
  '这段 SQL 为什么慢：SELECT * FROM orders WHERE status = 1 ORDER BY created_at DESC LIMIT 10',
]

async function main(): Promise<void> {
  console.log('=== Model Router Demo ===\n')
  let totalCost = 0

  for (const sample of SAMPLES) {
    const result = await routeChat(sample)
    totalCost += result.cost

    console.log(`[input] ${sample}`)
    console.log(`  tier       : ${result.decision.tier}  (${result.decision.reason})`)
    console.log(`  matched    : ${result.decision.matched.join(', ') || '-'}`)
    console.log(`  tokens     : in=${result.inputTokens} out=${result.outputTokens}`)
    console.log(`  cost       : ${formatUSD(result.cost)}`)
    console.log(`  latency    : route=${result.routeLatencyMs}ms total=${result.totalLatencyMs}ms`)
    console.log(`  answer     : ${result.answer.replace(/\n/g, ' ').slice(0, 100)}...`)
    console.log()
  }

  console.log('--- Summary ---')
  console.log(`  samples  : ${SAMPLES.length}`)
  console.log(`  spend    : ${formatUSD(totalCost)}`)
}

// 让该文件既能被其他模块 import，也能被 tsx 直接运行
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  main().catch((err) => {
    console.error('model-router demo failed:', err)
    process.exit(1)
  })
}
