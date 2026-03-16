/**
 * ReAct 循环示例
 *
 * 核心思路：在 System Prompt 中要求模型每一步都先输出 Thought（思考），
 * 再决定是否调用工具（Action）。工具返回的结果就是 Observation。
 * 这样我们能清楚看到模型的推理链路，而不是只看到最终答案。
 *
 * 运行：pnpm react
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

// ─── ReAct System Prompt ─────────────────────────────────────────────────────

const REACT_SYSTEM_PROMPT = `你是一个善于推理的智能助手。

你在回答问题时，遵循 ReAct 思维模式：先思考，再行动，然后根据观察结果继续推理。

规则：
1. 在每一轮回复中，先在开头写下你的思考过程（以"Thought:"开头）
2. 如果你需要查询外部信息，调用对应的工具
3. 拿到工具返回的结果后，在下一轮继续思考，看看是否需要更多信息
4. 直到你有足够的信息来回答问题，才给出最终答案（以"Answer:"开头）

思考过程中要：
- 分析用户问题的关键要素
- 判断当前已有的信息是否足够
- 如果不够，决定需要调用哪个工具来获取缺失的信息
- 拿到信息后，判断是否可以组合出完整答案`

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

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
          description: '城市名称，如"北京"、"上海"',
        },
      },
      required: ['city'],
    },
  },
}

const KNOWLEDGE_SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_knowledge',
    description: '从知识库中搜索相关信息，适合查询产品文档、常见问题、使用指南等',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或问题',
        },
      },
      required: ['query'],
    },
  },
}

const CALCULATOR_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'calculate',
    description: '执行数学计算，支持基本运算（加减乘除、百分比、幂运算等）',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，如 "100 * 0.85" 或 "2 ** 10"',
        },
      },
      required: ['expression'],
    },
  },
}

// ─── 模拟工具执行 ─────────────────────────────────────────────────────────────

/** 模拟天气 API */
function executeGetWeather(input: { city: string }): string {
  const mockData: Record<string, { temp: number; condition: string; humidity: number }> = {
    北京: { temp: 5, condition: '晴，有北风 3-4 级', humidity: 30 },
    上海: { temp: 12, condition: '阴转小雨', humidity: 78 },
    广州: { temp: 22, condition: '多云', humidity: 65 },
    成都: { temp: 10, condition: '阴，有雾', humidity: 85 },
  }
  const data = mockData[input.city] ?? { temp: 15, condition: '晴', humidity: 50 }
  return JSON.stringify({
    city: input.city,
    temperature: `${data.temp}°C`,
    condition: data.condition,
    humidity: `${data.humidity}%`,
  })
}

/** 模拟知识库检索 */
function executeSearchKnowledge(input: { query: string }): string {
  // 模拟一个产品知识库
  const knowledgeBase: Array<{ keywords: string[]; content: string }> = [
    {
      keywords: ['退款', '申请', '退货'],
      content: '退款政策：购买后 7 天内可无理由退款。申请路径：账户设置 → 订单管理 → 申请退款。退款将在 3-5 个工作日内原路退回。',
    },
    {
      keywords: ['套餐', '价格', '费用', '多少钱'],
      content: '套餐价格：基础版 99 元/月，专业版 299 元/月，企业版 999 元/月。年付享 85 折优惠。',
    },
    {
      keywords: ['API', '限流', '额度', '调用次数'],
      content: 'API 调用限制：基础版 1000 次/天，专业版 10000 次/天，企业版不限。超出额度后返回 429 状态码。',
    },
  ]

  const query = input.query.toLowerCase()
  const matched = knowledgeBase.find(item =>
    item.keywords.some(kw => query.includes(kw))
  )

  if (matched) {
    return JSON.stringify({ found: true, content: matched.content })
  }
  return JSON.stringify({ found: false, content: '未找到相关信息' })
}

/** 模拟计算器 */
function executeCalculate(input: { expression: string }): string {
  try {
    // 仅支持安全的数学表达式
    const sanitized = input.expression.replace(/[^0-9+\-*/().%\s^]/g, '')
    const expr = sanitized.replace('^', '**')
    // 使用 Function 构造器计算简单表达式
    const result = new Function(`return (${expr})`)() as number
    return JSON.stringify({ expression: input.expression, result })
  } catch {
    return JSON.stringify({ expression: input.expression, error: '计算失败' })
  }
}

// ─── 工具调度器 ───────────────────────────────────────────────────────────────

function dispatchTool(name: string, args: string): string {
  const input = JSON.parse(args) as Record<string, unknown>
  switch (name) {
    case 'get_weather':
      return executeGetWeather(input as { city: string })
    case 'search_knowledge':
      return executeSearchKnowledge(input as { query: string })
    case 'calculate':
      return executeCalculate(input as { expression: string })
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── ReAct 主循环 ─────────────────────────────────────────────────────────────

/**
 * 核心 ReAct 循环：
 * 1. 发送用户消息 + System Prompt（要求 Thought/Action/Observation 格式）
 * 2. 模型先输出 Thought，再决定是否调工具
 * 3. 工具返回 Observation，模型继续 Thought
 * 4. 直到模型不再调用工具，给出最终 Answer
 */
async function reactLoop(userMessage: string): Promise<void> {
  console.log('\n' + '='.repeat(70))
  console.log(`用户: ${userMessage}`)
  console.log('='.repeat(70))

  const tools = [WEATHER_TOOL, KNOWLEDGE_SEARCH_TOOL, CALCULATOR_TOOL]
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: REACT_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]

  let step = 0
  const MAX_STEPS = 8

  while (step < MAX_STEPS) {
    step++
    console.log(`\n--- Step ${step} ---`)

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    })

    const choice = response.choices[0]
    const toolCalls = choice.message.tool_calls ?? []

    // 打印模型的文本输出（包含 Thought）
    if (choice.message.content) {
      console.log(`\n[Model]\n${choice.message.content}`)
    }

    // 有工具调用 → 这是 Action 阶段
    if (toolCalls.length > 0) {
      messages.push(choice.message)

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function
        console.log(`\n[Action] ${name}(${args})`)

        const result = dispatchTool(name, args)
        console.log(`[Observation] ${result}`)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
      continue
    }

    // 无工具调用 → 模型给出最终答案
    console.log('\n[Final Answer]')
    console.log(choice.message.content)
    break
  }

  if (step >= MAX_STEPS) {
    console.log(`\n[Warning] 达到最大步数限制 (${MAX_STEPS})，任务可能未完成`)
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 场景一：简单问题，一步就能解决
  await reactLoop('上海今天天气怎么样？')

  // 场景二：需要多步推理的复杂问题
  // 模型需要先查套餐价格，再做折扣计算
  await reactLoop('专业版套餐年付的话一年多少钱？')

  // 场景三：需要组合多个工具结果的问题
  await reactLoop(
    '我要去北京出差三天，帮我看看北京天气怎么样，还有出差住酒店能不能报销退款？'
  )
}

main().catch(console.error)
