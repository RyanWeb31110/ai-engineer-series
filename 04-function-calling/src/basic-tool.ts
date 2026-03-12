/**
 * 基础 Function Calling 示例
 *
 * 场景：用���询问天气 + 汇率，模型识别意图并依次调用对应工具，
 * 我们把「工具执行结果」返回给模型，最终得到一段自然语言回答。
 *
 * 运行：pnpm basic
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'

// 加载 .env（与系列其他章节保持一致）
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

/**
 * 模拟天气查询工具。
 * 实际项目中这里会调用真实的天气 API（如 OpenWeatherMap）。
 */
const WEATHER_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市的当前天气，包括温度、天气状况和体感温度',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称，如"北京"、"Shanghai"',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度单位，默认 celsius（摄氏度）',
        },
      },
      required: ['city'],
    },
  },
}

/**
 * 模拟汇率查询工具。
 * 实际项目中会调用汇率 API（如 ExchangeRate-API）。
 */
const EXCHANGE_RATE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_exchange_rate',
    description: '查询两种货币之间的实时汇率',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '源货币代码，如 USD、CNY、EUR',
        },
        to: {
          type: 'string',
          description: '目标货币代码，如 USD、CNY、EUR',
        },
      },
      required: ['from', 'to'],
    },
  },
}

// ─── 模拟工具执行 ─────────────────────────────────────────────────────────────

interface WeatherInput {
  city: string
  unit?: 'celsius' | 'fahrenheit'
}

interface ExchangeRateInput {
  from: string
  to: string
}

/** 模拟天气 API 响应（实际项目替换为真实 API 调用） */
function executeGetWeather(input: WeatherInput): string {
  const mockData: Record<string, { temp: number; condition: string; feels_like: number }> = {
    北京: { temp: 12, condition: '晴', feels_like: 9 },
    上海: { temp: 18, condition: '多云', feels_like: 16 },
    Shanghai: { temp: 18, condition: 'Cloudy', feels_like: 16 },
    Beijing: { temp: 12, condition: 'Sunny', feels_like: 9 },
    深圳: { temp: 25, condition: '小雨', feels_like: 23 },
  }

  const data = mockData[input.city] ?? { temp: 20, condition: '未知', feels_like: 18 }
  const unit = input.unit ?? 'celsius'
  const tempStr = unit === 'celsius' ? `${data.temp}°C` : `${(data.temp * 9) / 5 + 32}°F`
  const feelsStr = unit === 'celsius' ? `${data.feels_like}°C` : `${(data.feels_like * 9) / 5 + 32}°F`

  return JSON.stringify({
    city: input.city,
    temperature: tempStr,
    condition: data.condition,
    feels_like: feelsStr,
    humidity: '65%',
    timestamp: new Date().toISOString(),
  })
}

/** 模拟汇率 API 响应 */
function executeGetExchangeRate(input: ExchangeRateInput): string {
  const rates: Record<string, number> = {
    'USD-CNY': 7.25,
    'CNY-USD': 0.138,
    'EUR-CNY': 7.85,
    'CNY-EUR': 0.127,
    'USD-EUR': 0.923,
    'EUR-USD': 1.083,
    'USD-JPY': 149.5,
    'JPY-USD': 0.0067,
  }

  const key = `${input.from}-${input.to}`
  const rate = rates[key] ?? 1.0

  return JSON.stringify({
    from: input.from,
    to: input.to,
    rate,
    updated_at: new Date().toISOString(),
  })
}

// ─── 工具调度器 ───────────────────────────────────────────────────────────────

/**
 * 根据工具名称和输入执行对应函数。
 * 实际项目中这里可以做权限检查、限流、错误处理等。
 */
function dispatchTool(name: string, args: string): string {
  const input = JSON.parse(args) as Record<string, unknown>
  switch (name) {
    case 'get_weather':
      return executeGetWeather(input as WeatherInput)
    case 'get_exchange_rate':
      return executeGetExchangeRate(input as ExchangeRateInput)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── 主流程：Agentic Loop ─────────────────────────────────────────────────────

/**
 * 运行一个完整的 Function Calling 对话循环。
 *
 * 核心逻辑：
 * 1. 发送用户消息 + 工具定义
 * 2. 如果模型返回 tool_calls，执行工具并把结果追加进 messages
 * 3. 重复，直到模型返回纯文本（finish_reason === 'stop'）
 */
async function runWithTools(userMessage: string): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log(`用户: ${userMessage}`)
  console.log('='.repeat(60))

  // 对话历史，每轮追加
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: userMessage },
  ]

  let round = 0
  const MAX_ROUNDS = 10

  // Agentic Loop：持续循环直到模型不再调用工具
  while (round < MAX_ROUNDS) {
    round++
    console.log(`\n[第 ${round} 轮 LLM 调用]`)

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [WEATHER_TOOL, EXCHANGE_RATE_TOOL],
      messages,
    })

    const choice = response.choices[0]
    const toolCalls = choice.message.tool_calls ?? []
    console.log(`finish_reason: ${choice.finish_reason}`)

    // 有工具调用请求（部分中转站 finish_reason 返回 'stop' 而非 'tool_calls'，
    // 需同时检查 tool_calls 数组是否有内容）
    if (toolCalls.length > 0) {
      // 把模型的回复（含 tool_calls）追加到历史
      messages.push(choice.message)

      // 遍历所有工具调用并执行
      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function

        console.log(`  -> 调用工具: ${name}`)
        console.log(`     输入: ${args}`)

        const result = dispatchTool(name, args)
        console.log(`     结果: ${result}`)

        // 把工具执行结果追加到对话历史
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
      continue
    }

    // 无工具调用，模型给出最终答案
    console.log(`\n助手: ${choice.message.content}`)
    break
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 场景一：单工具调用
  await runWithTools('北京今天天气怎么样？')

  // 场景二：多工具连续调用
  await runWithTools('我要去上海出差，帮我查一下上海的天气，以及现在美元换人民币是多少？')
}

main().catch(console.error)
