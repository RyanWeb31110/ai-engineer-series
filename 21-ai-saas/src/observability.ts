// 观测：Trace + 指标
// 每次 pipeline 调用产生一条 TraceRecord，收尾时汇总成系统级指标
// 对应生产环境的 OpenTelemetry / LangFuse（第 18 篇）在 SaaS 里的落地入口

import type { ModelTier } from './pricing.js'

export interface TraceStage {
  name: string
  ms: number
}

export interface TraceRecord {
  traceId: string
  tenantId: string
  input: string
  tier: ModelTier | null
  cacheHit: boolean
  /** 被护栏阻断时为 true，阻断原因写到 reason 字段 */
  blocked: boolean
  reason?: string
  inputTokens: number
  outputTokens: number
  costUSD: number
  /** 基线成本：同样 usage 按 large 档结算，便于计算省下的金额 */
  baselineCostUSD: number
  stages: TraceStage[]
  totalMs: number
  answerPreview: string
}

const traces: TraceRecord[] = []

export function newTraceId(): string {
  return 'trace-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

export function record(trace: TraceRecord): void {
  traces.push(trace)
}

export function allTraces(): readonly TraceRecord[] {
  return traces
}

export interface Metrics {
  total: number
  blocked: number
  cacheHits: number
  totalTokens: number
  totalCostUSD: number
  baselineCostUSD: number
  savedUSD: number
  savedPct: number
  p50Ms: number
  p95Ms: number
  tierMix: Record<string, number>
}

export function computeMetrics(): Metrics {
  const total = traces.length
  const blocked = traces.filter((t) => t.blocked).length
  const cacheHits = traces.filter((t) => t.cacheHit).length
  const totalTokens = traces.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0)
  const totalCostUSD = traces.reduce((s, t) => s + t.costUSD, 0)
  const baselineCostUSD = traces.reduce((s, t) => s + t.baselineCostUSD, 0)
  const savedUSD = baselineCostUSD - totalCostUSD
  const savedPct = baselineCostUSD > 0 ? (savedUSD / baselineCostUSD) * 100 : 0

  const latencies = traces.map((t) => t.totalMs).sort((a, b) => a - b)
  const pick = (p: number): number => {
    if (latencies.length === 0) return 0
    const idx = Math.min(latencies.length - 1, Math.floor(latencies.length * p))
    return latencies[idx]
  }

  const tierMix: Record<string, number> = {}
  for (const t of traces) {
    const key = t.blocked ? 'blocked' : t.tier ?? 'unknown'
    tierMix[key] = (tierMix[key] ?? 0) + 1
  }

  return {
    total,
    blocked,
    cacheHits,
    totalTokens,
    totalCostUSD,
    baselineCostUSD,
    savedUSD,
    savedPct,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    tierMix,
  }
}
