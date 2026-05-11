// 公共类型定义 — AI 工程师实战系列

/**
 * 统一消息格式（兼容 OpenAI / Anthropic）
 */
export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

/**
 * LLM 调用配置
 */
export interface LLMConfig {
  /** 模型名称，如 claude-sonnet-4-6 / gpt-4o */
  model: string
  /** 最高生成 Token 数 */
  maxTokens?: number
  /** 采���温度 0~1，默认 0.7 */
  temperature?: number
  /** Top-p 核采样，默认 1 */
  topP?: number
  /** System prompt */
  systemPrompt?: string
}

/**
 * LLM 响应结果
 */
export interface LLMResponse {
  content: string
  /** 实际使用的模型 */
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

/**
 * 支持的 LLM 提供商
 */
export type Provider = 'anthropic' | 'openai'

/**
 * 常用模型 ID 常量
 */
export const MODELS = {
  // Anthropic
  CLAUDE_OPUS: 'claude-opus-4-6',
  CLAUDE_SONNET: 'claude-sonnet-4-6',
  CLAUDE_HAIKU: 'claude-haiku-4-5-20251001',
  // OpenAI
  GPT5: 'gpt-5',
  GPT5_MINI: 'gpt-5-mini',
  GPT4O: 'gpt-4o',
  GPT5_CODEX: 'gpt-5.4',
} as const
