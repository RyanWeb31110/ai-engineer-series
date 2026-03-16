/**
 * ReAct vs 基础 Agentic Loop 对比
 *
 * 用同一个问题分别跑两种模式，对比输出差异：
 * - 基础模式：模型直接调用工具，不输出推理过程
 * - ReAct 模式：模型先输出 Thought，再调用工具
 *
 * 运行：pnpm compare
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

// ─── 工具定义（两种模式共用） ─────────────────────────────────────────────────

const WEATHER_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
      },
      required: ['city'],
    },
  },
}

const KNOWLEDGE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_knowledge',
    description: '搜索产品知识库获取相关信息',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  },
}

// ─── 模拟工具执行 ─────────────────────────────────────────────────────────────

function dispatchTool(name: string, args: string): string {
  const input = JSON.parse(args) as Record<string, unknown>
  switch (name) {
    case 'get_weather':
      return JSON.stringify({
        city: input.city,
        temperature: '5°C',
        condition: '晴，北风 3-4 级',
        humidity: '30%',
      })
    case 'search_knowledge':
      return JSON.stringify({
        found: true,
        content: '冬季出行建议：北京冬季干燥寒冷，建议携带保暖衣物、润肤霜。室外活动注意防风。',
      })
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── 模式一：基础 Agentic Loop（无显式推理） ─────────────────────────────────

async function basicLoop(userMessage: string): Promise<string[]> {
  const tools = [WEATHER_TOOL, KNOWLEDGE_TOOL]
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: '你是一个有用的助手。' },
    { role: 'user', content: userMessage },
  ]
  // 记录每一步的输出
  const trace: string[] = []
  let step = 0

  while (step < 8) {
    step++
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    })

    const choice = response.choices[0]
    const toolCalls = choice.message.tool_calls ?? []

    if (choice.message.content) {
      trace.push(`[Text] ${choice.message.content}`)
    }

    if (toolCalls.length > 0) {
      messages.push(choice.message)
      for (const tc of toolCalls) {
        trace.push(`[Action] ${tc.function.name}(${tc.function.arguments})`)
        const result = dispatchTool(tc.function.name, tc.function.arguments)
        trace.push(`[Result] ${result}`)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      continue
    }

    // 最终回答
    trace.push(`[Answer] ${choice.message.content}`)
    break
  }
  return trace
}

// ─── 模式二：ReAct Loop（显式推理） ──────────────────────────────────────────

const REACT_PROMPT = `你是一个善于推理的助手，遵循 ReAct 思维模式。

每一步：
1. 先写出 "Thought:" 说明你在想什么、为什么要执行下一步操作
2. 如果需要外部信息，调用工具
3. 拿到结果后继续思考
4. 最终用 "Answer:" 给出完整回答`

async function reactLoop(userMessage: string): Promise<string[]> {
  const tools = [WEATHER_TOOL, KNOWLEDGE_TOOL]
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: REACT_PROMPT },
    { role: 'user', content: userMessage },
  ]
  const trace: string[] = []
  let step = 0

  while (step < 8) {
    step++
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    })

    const choice = response.choices[0]
    const toolCalls = choice.message.tool_calls ?? []

    if (choice.message.content) {
      trace.push(`[Thought] ${choice.message.content}`)
    }

    if (toolCalls.length > 0) {
      messages.push(choice.message)
      for (const tc of toolCalls) {
        trace.push(`[Action] ${tc.function.name}(${tc.function.arguments})`)
        const result = dispatchTool(tc.function.name, tc.function.arguments)
        trace.push(`[Observation] ${result}`)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      continue
    }

    trace.push(`[Answer] ${choice.message.content}`)
    break
  }
  return trace
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const question = '我下周要去北京出差，帮我看看天气情况，给一些出行建议。'

  console.log('='.repeat(70))
  console.log('对比：基础 Agentic Loop vs ReAct Loop')
  console.log(`问题: ${question}`)
  console.log('='.repeat(70))

  // 跑基础模式
  console.log('\n── 模式一：基础 Agentic Loop ──\n')
  const basicTrace = await basicLoop(question)
  for (const line of basicTrace) {
    console.log(`  ${line}`)
  }

  // 跑 ReAct 模式
  console.log('\n── 模式二：ReAct Loop ──\n')
  const reactTrace = await reactLoop(question)
  for (const line of reactTrace) {
    console.log(`  ${line}`)
  }

  // 总结对比
  console.log('\n── 对比总结 ──\n')
  console.log(`  基础模式步数: ${basicTrace.filter(l => l.startsWith('[Action]')).length} 次工具调用`)
  console.log(`  ReAct 模式步数: ${reactTrace.filter(l => l.startsWith('[Action]')).length} 次工具调用`)
  console.log(`  ReAct 模式思考次数: ${reactTrace.filter(l => l.startsWith('[Thought]')).length} 次`)
  console.log('\n  关键差异: ReAct 模式每一步都有显式的推理痕迹，')
  console.log('  你可以看到模型"为什么"调用某个工具，而不是只看到调用动作。')
}

main().catch(console.error)
