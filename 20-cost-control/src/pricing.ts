// 模型档位与定价表
// 项目用中转站只有 gpt-5.4 一个模型，这里的价格档位用来演示"路由到不同成本档位"的思路
// 真实价格参考 GPT-5 系列 2026 年 5 月公开价格，按千分之位抹平，仅用于演示成本计算

import { MODELS } from '@ai-series/shared'

export type ModelTier = 'small' | 'medium' | 'large'

export interface ModelProfile {
  /** 档位名，用于路由决策和日志 */
  tier: ModelTier
  /** 实际调用的模型 ID */
  model: string
  /** 输入 Token 单价（USD / 百万 Token） */
  inputPricePerMillion: number
  /** 输出 Token 单价（USD / 百万 Token） */
  outputPricePerMillion: number
  /** 档位对应的采样温度 */
  temperature: number
  /** 档位对应的最大输出 Token */
  maxTokens: number
  /** 档位用途描述，仅用于日志输出 */
  description: string
}

// 中转站下层模型统一为 gpt-5.4，这里用不同 profile 演示分级调度
// 生产环境请把 model 字段替换为真实的小/中/大模型 ID
export const PROFILES: Record<ModelTier, ModelProfile> = {
  small: {
    tier: 'small',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.4,
    temperature: 0.2,
    maxTokens: 200,
    description: 'cheap model for greetings, classification, short replies',
  },
  medium: {
    tier: 'medium',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 2.0,
    temperature: 0.3,
    maxTokens: 400,
    description: 'balanced model for typical Q&A and summaries',
  },
  large: {
    tier: 'large',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    temperature: 0.5,
    maxTokens: 800,
    description: 'flagship model for multi-step reasoning and design',
  },
}

/**
 * 根据档位和 usage 计算这一次调用的成本（USD）
 */
export function calcCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const p = PROFILES[tier]
  const inputCost = (inputTokens * p.inputPricePerMillion) / 1_000_000
  const outputCost = (outputTokens * p.outputPricePerMillion) / 1_000_000
  return inputCost + outputCost
}

/**
 * 统一格式化为 6 位小数的美元金额，日志里对齐显示
 */
export function formatUSD(amount: number): string {
  return '$' + amount.toFixed(6)
}
