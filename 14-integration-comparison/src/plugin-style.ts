// plugin-style.ts — Plugin 风格：OpenAPI spec 自动转换
// 演示 Plugin 方式的核心特征：从 API 文档自动生成工具，HTTP 调用

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { MODELS } from '@ai-series/shared'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

// ─── 加载环境变量 ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
}

const openai = new OpenAI()

// ─── 模拟 OpenAPI Spec ──────────────────────────────────────────────────────────

/**
 * Plugin 风格的核心：一份 OpenAPI spec 描述所有 API 端点
 * 特征：已有 REST API，通过 spec 自动转换为工具，零代码改造
 */
interface OpenAPIOperation {
  operationId: string
  summary: string
  description: string
  method: string
  path: string
  parameters?: Array<{
    name: string
    in: 'query' | 'path'
    required: boolean
    description: string
    schema: Record<string, unknown>
  }>
}

// 模拟从 /openapi.json 获取的 spec（已解析为 operation 列表）
const API_OPERATIONS: OpenAPIOperation[] = [
  {
    operationId: 'getCurrentWeather',
    summary: 'Get current weather',
    description: 'Returns current weather data for a city. Supports temperature unit selection.',
    method: 'GET',
    path: '/api/weather/current',
    parameters: [
      { name: 'city', in: 'query', required: true, description: 'City name', schema: { type: 'string' } },
      { name: 'unit', in: 'query', required: false, description: 'Temperature unit', schema: { type: 'string', enum: ['celsius', 'fahrenheit'] } },
    ],
  },
  {
    operationId: 'getWeatherForecast',
    summary: 'Get weather forecast',
    description: 'Returns weather forecast for the next N days for a specified city.',
    method: 'GET',
    path: '/api/weather/forecast',
    parameters: [
      { name: 'city', in: 'query', required: true, description: 'City name', schema: { type: 'string' } },
      { name: 'days', in: 'query', required: true, description: 'Number of forecast days (1-7)', schema: { type: 'integer', minimum: 1, maximum: 7 } },
    ],
  },
]

// ─── OpenAPI spec → Function Calling 工具（自动转换）────────────────────────────

function specToTools(operations: OpenAPIOperation[]): ChatCompletionTool[] {
  return operations.map(op => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const param of op.parameters ?? []) {
      properties[param.name] = { ...param.schema, description: param.description }
      if (param.required) required.push(param.name)
    }

    return {
      type: 'function' as const,
      function: {
        name: op.operationId,
        description: `${op.summary}. ${op.description}`,
        parameters: {
          type: 'object' as const,
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    }
  })
}

// ─── 模拟 HTTP 调用（Plugin 运行时负责构造请求）────────────────────────────────

function executeHTTPCall(operationId: string, args: Record<string, unknown>): string {
  // 模拟天气 API 响应
  const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
    beijing: { temp: 22, condition: 'Sunny', humidity: 45 },
    tokyo: { temp: 18, condition: 'Cloudy', humidity: 65 },
    london: { temp: 12, condition: 'Rainy', humidity: 80 },
  }

  if (operationId === 'getCurrentWeather') {
    const city = String(args.city).toLowerCase()
    const data = weatherData[city]
    if (!data) return JSON.stringify({ error: `City not found: ${args.city}` })
    const unit = args.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'
    const temp = unit === 'fahrenheit' ? Math.round(data.temp * 9 / 5 + 32) : data.temp
    return JSON.stringify({ city: args.city, temperature: temp, unit, condition: data.condition, humidity: data.humidity })
  }

  if (operationId === 'getWeatherForecast') {
    const city = String(args.city).toLowerCase()
    const days = Number(args.days) || 3
    const base = weatherData[city]
    if (!base) return JSON.stringify({ error: `City not found: ${args.city}` })
    const forecast = Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      temp: base.temp + Math.round((Math.random() - 0.5) * 6),
      condition: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
    }))
    return JSON.stringify({ city: args.city, forecast })
  }

  return JSON.stringify({ error: `Unknown operation: ${operationId}` })
}

// ─── Agent 循环 ─────────────────────────────────────────────────────────────────

async function runPluginStyleAgent(userQuery: string): Promise<void> {
  console.log('=== Plugin Style: OpenAPI Spec Auto-Conversion ===\n')

  // 第一步：获取 OpenAPI spec（模拟 fetch /openapi.json）
  console.log('[Plugin] Fetching OpenAPI spec...')
  console.log(`[Plugin] Found ${API_OPERATIONS.length} operations: ${API_OPERATIONS.map(o => o.operationId).join(', ')}`)

  // 第二步：自动转换为 Function Calling 工具
  const tools = specToTools(API_OPERATIONS)
  console.log(`[Plugin] Converted to ${tools.length} tools\n`)

  // 第三步：Agent 循环
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful weather assistant. Use the available API endpoints to answer weather questions.' },
    { role: 'user', content: userQuery },
  ]

  console.log(`[User] ${userQuery}\n`)

  const MAX_TURNS = 5
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    const toolCalls = assistantMessage.tool_calls ?? []
    if (toolCalls.length === 0) {
      console.log(`[Agent] ${assistantMessage.content}`)
      break
    }

    // Plugin 运行时：构造 HTTP 请求并执行
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments)
      const op = API_OPERATIONS.find(o => o.operationId === toolCall.function.name)
      const queryString = Object.entries(args).map(([k, v]) => `${k}=${v}`).join('&')
      console.log(`[Plugin] ${op?.method} ${op?.path}?${queryString}`)
      const result = executeHTTPCall(toolCall.function.name, args)
      console.log(`[Plugin] Response: ${result}`)
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
    }
    console.log()
  }
}

// ─── 运行 ───────────────────────────────────────────────────────────────────────

runPluginStyleAgent('What is the weather in Beijing and Tokyo? Also give me a 3-day forecast for Beijing.').catch(console.error)
