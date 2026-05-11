// 成本追踪与对比
// 对同一组任务分别计算"全量走 large 档"和"走 router 档位选择"两种方案的成本
// 用 route 实际调用的 usage 回算 large 档位基线成本，避免重复 API 调用

import './env.js'

import { PROFILES, calcCost, formatUSD, type ModelTier } from './pricing.js'
import { routeChat } from './model-router.js'

interface CallRecord {
  input: string
  tier: ModelTier
  inputTokens: number
  outputTokens: number
  /** 实际按路由档位结算的成本 */
  actualCost: number
  /** 基线：同样 usage 全部按 large 档位结算的成本 */
  baselineCost: number
  latencyMs: number
}

const TASKS = [
  '早上好，今天有什么推荐的学习资源吗？',
  '这句 SQL 的含义是什么：SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL 7 DAY',
  '请帮我总结 React Server Component 的核心思路，三句话以内。',
  '给我设计一个面向 50K QPS 的限流系统，要求支持多租户配额、热点 Key 隔离，并对比令牌桶、漏桶、滑动窗口的取舍。',
  '谢谢！',
]

function summarize(records: CallRecord[]): void {
  const totalActual = records.reduce((sum, r) => sum + r.actualCost, 0)
  const totalBaseline = records.reduce((sum, r) => sum + r.baselineCost, 0)
  const totalInput = records.reduce((sum, r) => sum + r.inputTokens, 0)
  const totalOutput = records.reduce((sum, r) => sum + r.outputTokens, 0)
  const savedAbs = totalBaseline - totalActual
  const savedPct = totalBaseline > 0 ? (savedAbs / totalBaseline) * 100 : 0

  console.log('--- Summary ---')
  console.log(`  tasks          : ${records.length}`)
  console.log(`  tokens         : in=${totalInput} out=${totalOutput}`)
  console.log(`  baseline spend : ${formatUSD(totalBaseline)}  (all tasks on large tier)`)
  console.log(`  routed spend   : ${formatUSD(totalActual)}  (router decision per task)`)
  console.log(`  savings        : ${formatUSD(savedAbs)}  (${savedPct.toFixed(1)}%)`)

  const byTier = new Map<ModelTier, number>()
  for (const r of records) {
    byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1)
  }
  const distribution = (['small', 'medium', 'large'] as ModelTier[])
    .map((t) => `${t}=${byTier.get(t) ?? 0}`)
    .join(' ')
  console.log(`  tier mix       : ${distribution}`)
}

async function main(): Promise<void> {
  console.log('=== Cost Tracker Demo ===\n')
  const records: CallRecord[] = []

  for (const task of TASKS) {
    const routed = await routeChat(task)
    // 基线：同样 input/output tokens 全按 large 档位结算
    const baselineCost = calcCost('large', routed.inputTokens, routed.outputTokens)

    const record: CallRecord = {
      input: task,
      tier: routed.decision.tier,
      inputTokens: routed.inputTokens,
      outputTokens: routed.outputTokens,
      actualCost: routed.cost,
      baselineCost,
      latencyMs: routed.totalLatencyMs,
    }
    records.push(record)

    console.log(`[task] ${task.slice(0, 60)}${task.length > 60 ? '...' : ''}`)
    console.log(`  tier       : ${record.tier}`)
    console.log(`  tokens     : in=${record.inputTokens} out=${record.outputTokens}`)
    console.log(`  routed     : ${formatUSD(record.actualCost)}`)
    console.log(`  baseline   : ${formatUSD(record.baselineCost)}  (${PROFILES.large.tier} tier)`)
    console.log(`  saved      : ${formatUSD(record.baselineCost - record.actualCost)}`)
    console.log(`  latency    : ${record.latencyMs}ms`)
    console.log()
  }

  summarize(records)
}

main().catch((err) => {
  console.error('cost-tracker demo failed:', err)
  process.exit(1)
})
