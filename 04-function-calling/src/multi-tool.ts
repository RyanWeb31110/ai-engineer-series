/**
 * 多工具编排示例：并行工具调用 + 错误处理
 *
 * 场景：模拟一个「出行助手」，用户询问多个城市信息，
 * 模型一次性发起多个工具调用（并行），展示批量处理的能力。
 * 同时演示工具执行失败时如何优雅处理。
 *
 * 运行：pnpm multi
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'

// 加载 .env
const dotenvPath = new URL('../.env', import.meta.url).pathname
try {
  const envContent = readFileSync(dotenvPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && !key.startsWith('#') && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim()
    }
  }
} catch {
  // .env 不存在时跳过
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

const MODEL = 'gpt-5.2-codex'

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

const FLIGHT_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_flights',
    description: '查询两个城市之间的航班信息，返回最近的可用航班',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '出发城市，如"北京"、"上海"',
        },
        to: {
          type: 'string',
          description: '目的地城市',
        },
        date: {
          type: 'string',
          description: '出发日期，格式 YYYY-MM-DD',
        },
      },
      required: ['from', 'to', 'date'],
    },
  },
}

const HOTEL_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_hotels',
    description: '查询指定城市的酒店，返回价格和评分',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称',
        },
        check_in: {
          type: 'string',
          description: '入住日期，格式 YYYY-MM-DD',
        },
        check_out: {
          type: 'string',
          description: '退房日期，格式 YYYY-MM-DD',
        },
        budget: {
          type: 'number',
          description: '每晚预算上限（人民币）',
        },
      },
      required: ['city', 'check_in', 'check_out'],
    },
  },
}

const WEATHER_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather_forecast',
    description: '查询城市未来几天的天气预报',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称',
        },
        days: {
          type: 'number',
          description: '预报天数，1-7 天',
        },
      },
      required: ['city'],
    },
  },
}

// ─── 模拟工具执行 ─────────────────────────────────────────────────────────────

interface FlightInput {
  from: string
  to: string
  date: string
}

interface HotelInput {
  city: string
  check_in: string
  check_out: string
  budget?: number
}

interface WeatherForecastInput {
  city: string
  days?: number
}

function executeSearchFlights(input: FlightInput): string {
  // 模拟偶发性工具失败（演示错误处理）
  if (input.from === '火星') {
    throw new Error('不支持的出发城市')
  }

  return JSON.stringify({
    flights: [
      {
        flight_no: 'CA1234',
        departure: `${input.date} 08:00`,
        arrival: `${input.date} 10:30`,
        price: 980,
        seats_left: 12,
      },
      {
        flight_no: 'MU5678',
        departure: `${input.date} 14:00`,
        arrival: `${input.date} 16:20`,
        price: 760,
        seats_left: 3,
      },
    ],
    route: `${input.from} → ${input.to}`,
  })
}

function executeSearchHotels(input: HotelInput): string {
  const nights =
    Math.round(
      (new Date(input.check_out).getTime() - new Date(input.check_in).getTime()) /
        (1000 * 60 * 60 * 24),
    ) || 1

  return JSON.stringify({
    city: input.city,
    hotels: [
      {
        name: `${input.city}希尔顿酒店`,
        rating: 4.8,
        price_per_night: 688,
        total: 688 * nights,
        breakfast: true,
      },
      {
        name: `${input.city}如家精选`,
        rating: 4.2,
        price_per_night: 298,
        total: 298 * nights,
        breakfast: false,
      },
    ],
    check_in: input.check_in,
    check_out: input.check_out,
    nights,
  })
}

function executeGetWeatherForecast(input: WeatherForecastInput): string {
  const days = input.days ?? 3
  const conditions = ['晴', '多云', '小雨', '阴', '晴转多云']
  const forecast = Array.from({ length: days }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() + i + 1)
    return {
      date: date.toISOString().split('T')[0],
      high: Math.round(15 + Math.random() * 15),
      low: Math.round(5 + Math.random() * 10),
      condition: conditions[Math.floor(Math.random() * conditions.length)],
    }
  })

  return JSON.stringify({ city: input.city, forecast })
}

// ─── 工具调度器（带错误处理） ──────────────────────────────────────────────────

/**
 * 执行工具并捕获异常，将错误信息作为结果返回给模型。
 * 这样模型能感知工具失败，并在最终回答中体现。
 */
function dispatchToolSafe(name: string, args: string): string {
  try {
    const input = JSON.parse(args) as Record<string, unknown>
    switch (name) {
      case 'search_flights':
        return executeSearchFlights(input as FlightInput)
      case 'search_hotels':
        return executeSearchHotels(input as HotelInput)
      case 'get_weather_forecast':
        return executeGetWeatherForecast(input as WeatherForecastInput)
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err) {
    // 工具执行失败时，返回结构化错误信息而不是抛出异常
    const message = err instanceof Error ? err.message : String(err)
    console.log(`  [工具执行失败] ${name}: ${message}`)
    return JSON.stringify({ error: message, tool: name })
  }
}

// ─── Agentic Loop ─────────────────────────────────────────────────────────────

async function runTravelAssistant(userMessage: string): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log(`用户: ${userMessage}`)
  console.log('='.repeat(60))

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        '你是一个专业的出行助手。当用户询问出行相关问题时，主动使用工具查询信息，一次性把需要的数据都查完再回答。回答要简洁实用，重点突出价格、时间等关键信息。',
    },
    { role: 'user', content: userMessage },
  ]

  let round = 0
  const MAX_ROUNDS = 10

  while (round < MAX_ROUNDS) {
    round++
    console.log(`\n[第 ${round} 轮 LLM 调用]`)

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [FLIGHT_TOOL, HOTEL_TOOL, WEATHER_TOOL],
      messages,
    })

    const choice = response.choices[0]
    const toolCalls = choice.message.tool_calls ?? []
    console.log(`finish_reason: ${choice.finish_reason}`)

    // 有工具调用请求（兼容 finish_reason 为 'stop' 的中转站）
    if (toolCalls.length > 0) {
      console.log(`  本轮并行工具调用数: ${toolCalls.length}`)

      // 把模型的回复（含 tool_calls）追加进历史
      messages.push(choice.message)

      // 遍历所有工具调用并执行
      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function
        console.log(`  -> 调用: ${name}(${args})`)

        const result = dispatchToolSafe(name, args)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
      continue
    }

    // 无工具调用，模型给出最终答案
    console.log(`\n助手:\n${choice.message.content}`)
    break
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]

  // 场景：一次性查多个信息（触发并行工具调用）
  await runTravelAssistant(
    `我明天（${tomorrow}）从北京去上海出差，后天（${dayAfter}）回来。` +
      `帮我查一下机票、酒店（预算 500 元/晚以内）和上海明后天的天气，给我一个出行建议。`,
  )
}

main().catch(console.error)
