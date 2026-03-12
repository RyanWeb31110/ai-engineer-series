import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Message, LLMConfig, LLMResponse, Provider } from '../types/index.js'

// 延迟初始化，避免在 import 时就要求环境变量存在
let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY environment variable')
    const baseURL = process.env.ANTHROPIC_BASE_URL

    // 中转站通常由 Cloudflare 代理，需过滤 SDK 的指纹 header，只保留必要的鉴权和内容 header
    const customFetch = baseURL
      ? (url: RequestInfo | URL, init?: RequestInit) => {
          const allowed = new Set(['authorization', 'x-api-key', 'anthropic-version', 'content-type', 'content-length'])
          const src = new Headers(init?.headers ?? {})
          const clean = new Headers()
          for (const [k, v] of src.entries()) {
            if (allowed.has(k)) clean.set(k, v)
          }
          return fetch(url, { ...init, headers: clean })
        }
      : undefined

    _anthropic = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    })
  }
  return _anthropic
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY environment variable')
    const baseURL = process.env.OPENAI_BASE_URL
    _openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }
  return _openai
}

/**
 * 通过模型名前缀自动识别提供商。
 * claude-* → anthropic，其余 → openai
 */
function detectProvider(model: string): Provider {
  return model.startsWith('claude') ? 'anthropic' : 'openai'
}

/**
 * 统一 LLM 调用入口
 *
 * @example
 * const res = await chat([{ role: 'user', content: 'Hello' }], { model: 'claude-sonnet-4-6' })
 */
export async function chat(
  messages: Message[],
  config: LLMConfig,
): Promise<LLMResponse> {
  const provider = detectProvider(config.model)

  if (provider === 'anthropic') {
    return callAnthropic(messages, config)
  }
  return callOpenAI(messages, config)
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(messages: Message[], config: LLMConfig): Promise<LLMResponse> {
  const client = getAnthropic()

  // Anthropic 把 system 单独传，不放在 messages 数组里
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const systemPrompt =
    config.systemPrompt ?? messages.find((m) => m.role === 'system')?.content

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 1024,
    temperature: config.temperature ?? 0.7,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages,
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Anthropic')

  return {
    content: content.text,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(messages: Message[], config: LLMConfig): Promise<LLMResponse> {
  const client = getOpenAI()

  const openAIMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

  // 合并 systemPrompt
  const systemPrompt = config.systemPrompt ?? messages.find((m) => m.role === 'system')?.content
  if (systemPrompt) {
    openAIMessages.push({ role: 'system', content: systemPrompt })
  }

  for (const m of messages) {
    if (m.role === 'system') continue
    openAIMessages.push({ role: m.role, content: m.content })
  }

  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 1024,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1,
    messages: openAIMessages,
  })

  const choice = response.choices[0]
  if (!choice?.message.content) throw new Error('Empty response from OpenAI')

  return {
    content: choice.message.content,
    model: response.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  }
}
