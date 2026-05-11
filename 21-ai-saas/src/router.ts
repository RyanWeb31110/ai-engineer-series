// 模型路由：基于规则的零成本分类
// 延续第 20 篇思路，在 SaaS pipeline 里只保留规则层（足够覆盖演示场景）
// 真实业务可把 20-cost-control/src/model-router.ts 的 LLM 兜底层接回来

import type { ModelTier } from './pricing.js'

export interface RouteDecision {
  tier: ModelTier
  reason: string
  matched: string[]
}

const HEAVY_KEYWORDS = [
  '设计', '架构', '推理', '证明', '对比', '权衡', '综述',
  '多步', '分布式', '一致性', '事务', '方案', 'trade-off',
  'design', 'architecture', 'reasoning', 'compare', 'trade off',
]

const LIGHT_KEYWORDS = [
  '你好', '您好', '谢谢', '多谢', 'hi', 'hello', 'thanks', 'thank you', 'ok',
]

export function routeDecide(input: string): RouteDecision {
  const matched: string[] = []
  const lower = input.toLowerCase()
  const trimmed = input.trim()

  for (const k of HEAVY_KEYWORDS) {
    if (lower.includes(k)) matched.push(`heavy:${k}`)
  }
  if (matched.length > 0) {
    return { tier: 'large', reason: 'heavy-keyword', matched }
  }

  if (trimmed.length <= 25) {
    for (const k of LIGHT_KEYWORDS) {
      if (lower.includes(k)) matched.push(`light:${k}`)
    }
    if (matched.length > 0 || trimmed.length <= 6) {
      return { tier: 'small', reason: 'short-or-greeting', matched }
    }
  }

  return { tier: 'medium', reason: 'default', matched: [] }
}
