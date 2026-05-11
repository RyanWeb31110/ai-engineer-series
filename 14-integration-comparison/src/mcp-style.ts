// mcp-style.ts — MCP 风格：注册工具 + 有状态连接
// 演示 MCP 方式的核心特征：工具注册、JSON-RPC 通信、有状态会话

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

// ─── 模拟 MCP Server 的工具注册 ─────────────────────────────────────────────────

/**
 * MCP 风格的工具定义
 * 特征：工具在 Server 端注册，Client 通过 JSON-RPC 发现和调用
 */
interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// MCP Server 注册的工具列表（模拟 tools/list 响应）
const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather information for a specified city',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Beijing", "Tokyo"' },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit, defaults to celsius',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'get_forecast',
    description: 'Get weather forecast for the next N days',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
        days: { type: 'number', description: 'Number of forecast days (1-7)' },
      },
      required: ['city', 'days'],
    },
  },
]

// 模拟 MCP Server 的工具执行（tools/call 处理）
function executeMCPTool(name: string, args: Record<string, unknown>): string {
  // 模拟天气数据
  const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
    beijing: { temp: 22, condition: 'Sunny', humidity: 45 },
    tokyo: { temp: 18, condition: 'Cloudy', humidity: 65 },
    london: { temp: 12, condition: 'Rainy', humidity: 80 },
  }

  if (name === 'get_weather') {
    const city = String(args.city).toLowerCase()
    const data = weatherData[city]
    if (!data) return JSON.stringify({ error: `Weather data not available for ${args.city}` })
    const unit = args.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'
    const temp = unit === 'fahrenheit' ? Math.round(data.temp * 9 / 5 + 32) : data.temp
    return JSON.stringify({ city: args.city, temperature: temp, unit, condition: data.condition, humidity: data.humidity })
  }

  if (name === 'get_forecast') {
    const city = String(args.city).toLowerCase()
    const days = Number(args.days) || 3
    const base = weatherData[city]
    if (!base) return JSON.stringify({ error: `Forecast not available for ${args.city}` })
    const forecast = Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      temp: base.temp + Math.round((Math.random() - 0.5) * 6),
      condition: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
    }))
    return JSON.stringify({ city: args.city, forecast })
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` })
}

// ─── MCP 工具 → OpenAI Function Calling 格式转换 ────────────────────────────────

function mcpToolsToOpenAI(mcpTools: MCPToolDefinition[]): ChatCompletionTool[] {
  return mcpTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

// ─── Agent 循环 ─────────────────────────────────────────────────────────────────

async function runMCPStyleAgent(userQuery: string): Promise<void> {
  console.log('=== MCP Style: Tool Registration + Stateful Connection ===\n')

  // 第一步：Client 从 Server 获取工具列表（模拟 tools/list）
  console.log('[MCP] Discovering tools from server...')
  console.log(`[MCP] Found ${MCP_TOOLS.length} tools: ${MCP_TOOLS.map(t => t.name).join(', ')}\n`)

  // 第二步：转换为 LLM 可用的工具格式
  const tools = mcpToolsToOpenAI(MCP_TOOLS)

  // 第三步：Agent 循环
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a helpful weather assistant. Use the available tools to answer weather questions.' },
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

    const assistantMessage = response.choices?.[0]?.message
    if (!assistantMessage) {
      console.log('[Agent] Empty response from LLM')
      break
    }
    messages.push(assistantMessage)

    console.log(`[Debug] finish_reason: ${response.choices[0].finish_reason}, tool_calls: ${assistantMessage.tool_calls?.length ?? 0}, content: ${assistantMessage.content?.slice(0, 50) ?? '(null)'}`)

    const toolCalls = assistantMessage.tool_calls ?? []
    if (toolCalls.length === 0) {
      console.log(`[Agent] ${assistantMessage.content ?? '(no response)'}`)
      break
    }

    // 调用 MCP Server 执行工具（模拟 tools/call）
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments)
      console.log(`[MCP] Calling ${toolCall.function.name}(${JSON.stringify(args)})`)
      const result = executeMCPTool(toolCall.function.name, args)
      console.log(`[MCP] Result: ${result}`)
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
    }
    console.log()
  }
}

// ─── 运行 ───────────────────────────────────────────────────────────────────────

runMCPStyleAgent('What is the weather in Beijing and Tokyo? Also give me a 3-day forecast for Beijing.').catch(console.error)
