/**
 * Mastra Agent 示例
 *
 * 用 Mastra 框架搭建一个带工具的 Agent，对比手写 ReAct 循环的差异。
 * 同样的三个工具（天气查询、知识库搜索、计算器），但代码量大幅减少。
 *
 * 运行：pnpm agent
 */

import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { readFileSync } from 'fs'

// ─── 加载 .env ──────────────────────────────────────────────────────────────────

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

// ─── 工具定义 ────────────────────────────────────────────────────────────────────

// 模拟天气数据
const WEATHER_DATA: Record<string, { temp: number; condition: string; humidity: number }> = {
  北京: { temp: 5, condition: '晴，有北风 3-4 级', humidity: 30 },
  上海: { temp: 12, condition: '阴转小雨', humidity: 78 },
  广州: { temp: 22, condition: '多云', humidity: 65 },
  成都: { temp: 10, condition: '阴，有雾', humidity: 85 },
}

// 模拟知识库
const KNOWLEDGE_BASE = [
  {
    keywords: ['退款', '申请', '退货'],
    content:
      '退款政策：购买后 7 天内可无理由退款。申请路径：账户设置 → 订单管理 → 申请退款。退款将在 3-5 个工作日内原路退回。',
  },
  {
    keywords: ['套餐', '价格', '费用', '多少钱'],
    content:
      '套餐价格：基础版 99 元/月，专业版 299 元/月，企业版 999 元/月。年付享 85 折优惠。',
  },
  {
    keywords: ['API', '限流', '额度', '调用次数'],
    content:
      'API 调用限制：基础版 1000 次/天，专业版 10000 次/天，企业版不限。超出额度后返回 429 状态码。',
  },
]

/**
 * 天气查询工具
 *
 * Mastra 用 createTool + Zod schema 定义工具，
 * 比手写 OpenAI JSON Schema 更简洁，还能自动做输入验证。
 */
const weatherTool = createTool({
  id: 'get_weather',
  description: '查询指定城市的当前天气，包括温度、天气状况和湿度',
  inputSchema: z.object({
    city: z.string().describe('城市名称，如"北京"、"上海"'),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature: z.string(),
    condition: z.string(),
    humidity: z.string(),
  }),
  execute: async ({ city }) => {
    const data = WEATHER_DATA[city] ?? { temp: 15, condition: '晴', humidity: 50 }
    return {
      city,
      temperature: `${data.temp}°C`,
      condition: data.condition,
      humidity: `${data.humidity}%`,
    }
  },
})

/**
 * 知识库搜索工具
 */
const knowledgeTool = createTool({
  id: 'search_knowledge',
  description: '从知识库中搜索相关信息，适合查询产品文档、常见问题、使用指南等',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词或问题'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    content: z.string(),
  }),
  execute: async ({ query }) => {
    const q = query.toLowerCase()
    const matched = KNOWLEDGE_BASE.find(item =>
      item.keywords.some(kw => q.includes(kw))
    )
    if (matched) {
      return { found: true, content: matched.content }
    }
    return { found: false, content: '未找到相关信息' }
  },
})

/**
 * 计算器工具
 */
const calculatorTool = createTool({
  id: 'calculate',
  description: '执行数学计算，支持基本运算（加减乘除、百分比、幂运算等）',
  inputSchema: z.object({
    expression: z.string().describe('数学表达式，如 "100 * 0.85" 或 "2 ** 10"'),
  }),
  outputSchema: z.object({
    expression: z.string(),
    result: z.number(),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s^]/g, '')
    const expr = sanitized.replace('^', '**')
    const result = new Function(`return (${expr})`)() as number
    return { expression, result }
  },
})

// ─── 创建 Agent ──────────────────────────────────────────────────────────────────

/**
 * 核心：用 Mastra 创建 Agent
 *
 * 和手写 ReAct 循环对比：
 * - 手写需要自己管理 messages 数组、while 循环、tool_calls 解析、结果回填
 * - Mastra 只需声明 instructions + tools，框架自动处理 ReAct 循环
 *
 * model 配置说明：
 * - id: "custom/gpt-5.2-codex" — custom 前缀告诉 Mastra 使用自定义 provider
 * - url: 指向中转站的 base URL
 * - apiKey: 中转站的 API Key
 */
const agent = new Agent({
  id: 'smart-assistant',
  name: 'Smart Assistant',
  instructions: `你是一个善于推理的智能助手。

你在回答问题时，遵循 ReAct 思维模式：先思考，再行动，然后根据观察结果继续推理。

规则：
1. 在每一轮回复中，先写下你的思考过程
2. 如果你需要查询外部信息，调用对应的工具
3. 拿到工具返回的结果后，继续思考，看看是否需要更多信息
4. 直到你有足够的信息来回答问题，才给出最终答案`,
  model: {
    id: 'custom/gpt-5.2-codex',
    url: process.env.OPENAI_BASE_URL ?? 'https://right.codes/codex/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: {
    get_weather: weatherTool,
    search_knowledge: knowledgeTool,
    calculate: calculatorTool,
  },
})

// ─── 运行场景 ────────────────────────────────────────────────────────────────────

async function runScenario(label: string, question: string): Promise<void> {
  console.log('\n' + '='.repeat(70))
  console.log(`[${label}]`)
  console.log(`用户: ${question}`)
  console.log('='.repeat(70))

  const response = await agent.generate(question, {
    maxSteps: 8,
  })

  console.log(`\n[Agent Response]\n${response.text}`)

  // 打印工具调用链路（如果有）
  if (response.steps && response.steps.length > 0) {
    console.log('\n--- Tool Call Trace ---')
    for (const step of response.steps) {
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          console.log(`  [Action] ${tc.payload.toolName}(${JSON.stringify(tc.payload.args)})`)
        }
      }
      if (step.toolResults && step.toolResults.length > 0) {
        for (const tr of step.toolResults) {
          console.log(`  [Result] ${JSON.stringify(tr.payload.result)}`)
        }
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('Mastra Agent Demo')
  console.log('使用 Mastra 框架构建带工具的 Agent\n')

  // 场景一：简单查询，一步搞定
  await runScenario('场景一：简单查询', '上海今天天气怎么样？')

  // 场景二：多步推理，先查后算
  await runScenario('场景二：多步推理', '专业版套餐年付的话一年多少钱？')

  // 场景三：多工具协作
  await runScenario(
    '场景三：多工具协作',
    '我要去北京出差三天，帮我看看北京天气怎么样，还有出差住酒店能不能报销退款？'
  )
}

main().catch(console.error)
