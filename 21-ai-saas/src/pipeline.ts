// 端到端 SaaS Pipeline：一次用户请求从进入到返回的完整链路
// 顺序：Guardrails(输入) → Quota → Route → Retrieve → Cache → LLM → Guardrails(输出) → Record
// 任何一步失败都会产出一条 Trace，便于事后排查和统计

import './env.js'

import type { Message } from '@ai-series/shared'
import { chat } from '@ai-series/shared'

import { cacheGet, cacheKey, cacheSet } from './cache.js'
import { guardInput, redactPII } from './guardrails.js'
import { buildContextBlock, retrieve } from './kb.js'
import { PROFILES, calcCost } from './pricing.js'
import { routeDecide } from './router.js'
import {
  type TraceRecord,
  type TraceStage,
  newTraceId,
  record as recordTrace,
} from './observability.js'
import {
  type TenantRecord,
  capTier,
  checkQuota,
  getTenant,
  recordUsage,
} from './tenant.js'

export interface PipelineRequest {
  tenantId: string
  input: string
}

export interface PipelineResponse {
  answer: string
  trace: TraceRecord
}

const SYSTEM_PROMPT = `You are a customer support assistant for ACME Online Store.
Always answer in Simplified Chinese, concise and actionable.
Cite the knowledge base section (e.g., [policy/return.md]) when relevant.
If the question is outside the provided context, say so and suggest contacting a human agent.`

export async function runPipeline(req: PipelineRequest): Promise<PipelineResponse> {
  const traceId = newTraceId()
  const stages: TraceStage[] = []
  const startedAt = Date.now()

  const tenant = getTenant(req.tenantId)

  const stage = <T>(name: string, fn: () => T): T => {
    const t0 = Date.now()
    const result = fn()
    stages.push({ name, ms: Date.now() - t0 })
    return result
  }

  const stageAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    const result = await fn()
    stages.push({ name, ms: Date.now() - t0 })
    return result
  }

  // 1) 输入护栏
  const guard = stage('guard-input', () => guardInput(req.input))
  if (!guard.allowed) {
    const answer = '抱歉，这个问题我无法回答。如需帮助请联系人工客服。'
    const trace: TraceRecord = {
      traceId,
      tenantId: tenant.id,
      input: req.input,
      tier: null,
      cacheHit: false,
      blocked: true,
      reason: guard.reason,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      baselineCostUSD: 0,
      stages,
      totalMs: Date.now() - startedAt,
      answerPreview: answer,
    }
    recordTrace(trace)
    return { answer, trace }
  }

  // 2) 配额预检查
  const quota = stage('quota-check', () => checkQuota(tenant))
  if (!quota.allowed) {
    const answer = '您当前的用量已达套餐上限，请升级套餐或联系客服。'
    const trace: TraceRecord = {
      traceId,
      tenantId: tenant.id,
      input: req.input,
      tier: null,
      cacheHit: false,
      blocked: true,
      reason: quota.reason,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      baselineCostUSD: 0,
      stages,
      totalMs: Date.now() - startedAt,
      answerPreview: answer,
    }
    recordTrace(trace)
    return { answer, trace }
  }

  // 3) 路由决策：先得到期望档位，再用租户套餐封顶
  const decision = stage('route', () => routeDecide(req.input))
  const finalTier = capTier(decision.tier, tenant.quota.maxTier)
  const profile = PROFILES[finalTier]

  // 4) 检索：拉两段最相关的知识库片段
  const hits = stage('retrieve', () => retrieve(req.input, 2))
  const context = buildContextBlock(hits)

  // 5) 组装 messages。稳定前缀放最前面，动态的用户输入放最后，便于前缀缓存命中
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `# Knowledge Base\n${context}` },
    { role: 'user', content: req.input },
  ]

  // 6) 缓存查找：以 tenantId 为 key 隔离，避免跨租户泄漏
  const key = cacheKey(tenant.id, messages, profile.model)
  const cached = stage('cache-lookup', () => cacheGet(key))

  let response = cached
  let cacheHit = false
  let upstreamError: string | undefined
  if (response) {
    cacheHit = true
  } else {
    // 7) LLM 调用：带一次重试，异常时不阻塞用户、只记录 trace 并回友好提示
    response = await stageAsync('llm-call', async () => {
      const callOnce = () =>
        chat(messages, {
          model: profile.model,
          temperature: profile.temperature,
          maxTokens: profile.maxTokens,
        })
      try {
        return await callOnce()
      } catch (err) {
        try {
          return await callOnce()
        } catch (err2) {
          upstreamError = err2 instanceof Error ? err2.message : String(err2)
          // 构造降级响应，usage 置 0，让上层照常完成 trace 和结算
          return {
            content: '当前服务繁忙，请稍后再试或联系人工客服。',
            model: profile.model,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          }
        }
      }
    })
    // 降级响应不入缓存，避免把失败结果喂给下一个用户
    if (!upstreamError) cacheSet(key, response)
  }

  // 8) 输出护栏：脱敏 PII
  const { redacted, hits: piiHits } = stage('guard-output', () => redactPII(response.content))

  // 9) 用量结算：命中缓存或降级响应不计费
  const costUSD = cacheHit || upstreamError
    ? 0
    : calcCost(finalTier, response.usage.inputTokens, response.usage.outputTokens)
  const baselineCostUSD = calcCost('large', response.usage.inputTokens, response.usage.outputTokens)
  recordUsage(tenant, costUSD)

  const reasonParts: string[] = []
  if (upstreamError) reasonParts.push(`upstream-error:${upstreamError.slice(0, 40)}`)
  if (piiHits > 0) reasonParts.push(`pii-redacted:${piiHits}`)

  const trace: TraceRecord = {
    traceId,
    tenantId: tenant.id,
    input: req.input,
    tier: finalTier,
    cacheHit,
    blocked: false,
    reason: reasonParts.length > 0 ? reasonParts.join(';') : undefined,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    costUSD,
    baselineCostUSD,
    stages,
    totalMs: Date.now() - startedAt,
    answerPreview: redacted.replace(/\n/g, ' ').slice(0, 120),
  }
  recordTrace(trace)

  return { answer: redacted, trace }
}

export type { TenantRecord }

// 直接运行本文件时的最小演示：一次正常请求走完完整链路
async function demo(): Promise<void> {
  const { seedTenants } = await import('./tenant.js')
  const { formatUSD } = await import('./pricing.js')
  seedTenants()

  const { answer, trace } = await runPipeline({
    tenantId: 'tenant-pro',
    input: '请问 15 天前买的耳机能退吗？',
  })

  console.log('=== Pipeline Single-Shot Demo ===\n')
  console.log(`trace   : ${trace.traceId}`)
  console.log(`tier    : ${trace.tier}`)
  console.log(`tokens  : in=${trace.inputTokens} out=${trace.outputTokens}`)
  console.log(`cost    : ${formatUSD(trace.costUSD)}  (baseline ${formatUSD(trace.baselineCostUSD)})`)
  console.log(`stages  : ${trace.stages.map((s) => `${s.name}=${s.ms}ms`).join(' ')}`)
  console.log(`latency : ${trace.totalMs}ms`)
  console.log(`answer  :\n${answer}`)
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  demo().catch((err) => {
    console.error('pipeline demo failed:', err)
    process.exit(1)
  })
}
