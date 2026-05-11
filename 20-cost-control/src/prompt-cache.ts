// Prompt Caching 演示
// 中转站的 OpenAI 兼容接口没有透出原生 Prompt Caching 控制字段，
// 本文件用应用层响应缓存演示"重复请求不必重复消耗 Token"的思路，
// 原理章节会对照讲清楚 Anthropic cache_control 和 OpenAI 自动前缀缓存的官方机制

import './env.js'

import { createHash } from 'node:crypto'
import type { LLMResponse, Message } from '@ai-series/shared'
import { chat } from '@ai-series/shared'

import { PROFILES, calcCost, formatUSD, type ModelTier } from './pricing.js'

// 客服助手的长 system prompt：不变的知识库，放在请求最前面以贴合"前缀复用"特性
const SUPPORT_SYSTEM_PROMPT = `You are a customer support assistant for ACME Online Store.
Always answer in Simplified Chinese, concise and actionable.

# Return Policy
1. Unopened items can be returned within 30 days for a full refund.
2. Opened electronics must be returned within 14 days with original packaging.
3. Customized items are non-refundable unless defective.
4. Refunds are issued to the original payment method within 5 business days.

# Shipping Policy
1. Standard shipping: 3-5 business days, free for orders over 99 CNY.
2. Express shipping: 1-2 business days, 25 CNY flat rate.
3. International shipping: 7-14 business days, rate calculated at checkout.
4. Orders placed after 3 PM are processed the next business day.

# Warranty
1. Electronics carry a 12-month manufacturer warranty.
2. Clothing has a 30-day defect warranty.
3. Contact support with the order ID to file a warranty claim.

# Style
- Always cite which policy section supports your answer.
- If a question is outside these policies, say so and suggest contacting a human agent.`

interface CacheEntry {
  response: LLMResponse
  cachedAt: number
}

// 应用层缓存：完全相同的 messages + model 组合返回历史结果
// 生产环境建议换成 Redis 等共享缓存，并加 TTL 与容量上限
const responseCache = new Map<string, CacheEntry>()

function computeCacheKey(messages: Message[], model: string): string {
  const payload = JSON.stringify({ messages, model })
  return createHash('sha256').update(payload).digest('hex')
}

interface CachedChatResult {
  response: LLMResponse
  hit: boolean
  latencyMs: number
}

async function cachedChat(
  messages: Message[],
  tier: ModelTier,
): Promise<CachedChatResult> {
  const profile = PROFILES[tier]
  const key = computeCacheKey(messages, profile.model)
  const startedAt = Date.now()

  const cached = responseCache.get(key)
  if (cached) {
    return { response: cached.response, hit: true, latencyMs: Date.now() - startedAt }
  }

  const response = await chat(messages, {
    model: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  })
  responseCache.set(key, { response, cachedAt: Date.now() })

  return { response, hit: false, latencyMs: Date.now() - startedAt }
}

// 四组请求演示缓存命中模式：同一问题多次提问时节省的 Token 与金额
const QUESTIONS: { label: string, question: string }[] = [
  { label: 'Q1 first time', question: '请问 15 天前买的耳机能退吗？' },
  { label: 'Q1 repeated', question: '请问 15 天前买的耳机能退吗？' },
  { label: 'Q2 different', question: '急需的订单怎么能最快送到？' },
  { label: 'Q1 repeated again', question: '请问 15 天前买的耳机能退吗？' },
]

async function main(): Promise<void> {
  console.log('=== Prompt Cache Demo ===\n')

  const tier: ModelTier = 'medium'
  let totalCost = 0
  let totalCostSaved = 0
  let totalTokensSaved = 0
  let hits = 0

  for (const { label, question } of QUESTIONS) {
    const messages: Message[] = [
      { role: 'system', content: SUPPORT_SYSTEM_PROMPT },
      { role: 'user', content: question },
    ]
    const { response, hit, latencyMs } = await cachedChat(messages, tier)
    const cost = hit
      ? 0
      : calcCost(tier, response.usage.inputTokens, response.usage.outputTokens)

    if (hit) {
      // 缓存命中：节省 = 这个 prompt 第一次调用时的真实成本
      const savedCost = calcCost(
        tier,
        response.usage.inputTokens,
        response.usage.outputTokens,
      )
      totalCostSaved += savedCost
      totalTokensSaved += response.usage.totalTokens
      hits++
    } else {
      totalCost += cost
    }

    const status = hit ? 'HIT ' : 'MISS'
    console.log(`[${label}]`)
    console.log(`  status   : ${status}`)
    console.log(`  latency  : ${latencyMs}ms`)
    console.log(`  tokens   : in=${response.usage.inputTokens} out=${response.usage.outputTokens}`)
    console.log(`  cost     : ${formatUSD(cost)}`)
    console.log(`  answer   : ${response.content.replace(/\n/g, ' ').slice(0, 90)}...`)
    console.log()
  }

  console.log('--- Summary ---')
  console.log(`  total requests : ${QUESTIONS.length}`)
  console.log(`  cache hits     : ${hits} / ${QUESTIONS.length}`)
  console.log(`  tokens saved   : ${totalTokensSaved}`)
  console.log(`  actual spend   : ${formatUSD(totalCost)}`)
  console.log(`  cost saved     : ${formatUSD(totalCostSaved)}`)
}

main().catch((err) => {
  console.error('prompt-cache demo failed:', err)
  process.exit(1)
})
