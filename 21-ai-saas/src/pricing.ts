// 模型档位与定价表
// 生产环境请把每档的 model 换成真实的小/中/大模型 ID
// 中转站当前只暴露 gpt-5.4，用同一模型 + 不同 profile 演示分级调度

import { MODELS } from '@ai-series/shared'

export type ModelTier = 'small' | 'medium' | 'large'

export interface ModelProfile {
  tier: ModelTier
  model: string
  inputPricePerMillion: number
  outputPricePerMillion: number
  temperature: number
  maxTokens: number
}

export const PROFILES: Record<ModelTier, ModelProfile> = {
  small: {
    tier: 'small',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.4,
    temperature: 0.2,
    maxTokens: 200,
  },
  medium: {
    tier: 'medium',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 2.0,
    temperature: 0.3,
    maxTokens: 400,
  },
  large: {
    tier: 'large',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    temperature: 0.5,
    maxTokens: 800,
  },
}

export function calcCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const p = PROFILES[tier]
  const inputCost = (inputTokens * p.inputPricePerMillion) / 1_000_000
  const outputCost = (outputTokens * p.outputPricePerMillion) / 1_000_000
  return inputCost + outputCost
}

export function formatUSD(amount: number): string {
  return '$' + amount.toFixed(6)
}
