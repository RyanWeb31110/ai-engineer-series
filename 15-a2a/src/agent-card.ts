// agent-card.ts — A2A 协议核心：Agent Card 发现机制
// 演示 Agent 如何通过 Agent Card 声明自己的能力，以及 Client 如何发现和选择 Agent

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { MODELS } from '@ai-series/shared'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

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

// ─── A2A 核心类型定义 ──────────────────────────────────────────────────────────

// Agent 技能声明
interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  inputModes: string[]
  outputModes: string[]
}

// Agent 能力声明
interface AgentCapabilities {
  streaming: boolean
  pushNotifications: boolean
}

// Agent Card：Agent 的"名片"
interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

// ─── 模拟三个不同的 Agent Card ──────────────────────────────────────────────────

const AGENT_REGISTRY: AgentCard[] = [
  {
    name: 'Research Agent',
    description: 'Searches the web and summarizes information on any topic',
    url: 'http://localhost:8001',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'web-search',
        name: 'Web Search',
        description: 'Search the internet for up-to-date information',
        tags: ['search', 'research', 'information'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'summarize',
        name: 'Summarize',
        description: 'Summarize long articles or documents into key points',
        tags: ['summary', 'analysis'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  },
  {
    name: 'Code Agent',
    description: 'Writes, reviews, and debugs code in multiple programming languages',
    url: 'http://localhost:8002',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'code-gen',
        name: 'Code Generation',
        description: 'Generate code from natural language descriptions',
        tags: ['code', 'programming', 'generation'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Review code for bugs, security issues, and best practices',
        tags: ['code', 'review', 'security'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'application/json'],
      },
    ],
  },
  {
    name: 'Data Agent',
    description: 'Analyzes datasets, generates charts, and provides statistical insights',
    url: 'http://localhost:8003',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: true },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'data-analysis',
        name: 'Data Analysis',
        description: 'Analyze structured data and provide statistical insights',
        tags: ['data', 'analysis', 'statistics'],
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['text/plain', 'application/json'],
      },
    ],
  },
]

// ─── Agent 发现：根据任务需求匹配最合适的 Agent ─────────────────────────────────

const discoveryTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'discover_agents',
    description: 'Search the agent registry to find agents matching a task requirement. Returns a list of matching agents with their capabilities.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you need an agent to do',
        },
        requiredTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags that the agent skills must have',
        },
      },
      required: ['query'],
    },
  },
}

// 模拟 Agent 发现过程：按关键词分词匹配名称、描述、技能标签
function discoverAgents(query: string, requiredTags?: string[]): AgentCard[] {
  // 把 query 拆成关键词，提高匹配率
  const keywords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  return AGENT_REGISTRY.filter(agent => {
    const corpus = [
      agent.name, agent.description,
      ...agent.skills.flatMap(s => [s.name, s.description, ...s.tags]),
    ].join(' ').toLowerCase()
    // 关键词命中任意一个即算匹配
    const keywordMatch = keywords.some(kw => corpus.includes(kw))
    // requiredTags 命中任意一个即算匹配（宽松模式）
    const tagMatch = !requiredTags?.length || requiredTags.some(rt =>
      agent.skills.some(skill => skill.tags.includes(rt.toLowerCase()))
    )
    return keywordMatch && tagMatch
  })
}

// ─── 运行演示 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== A2A Agent Card Discovery Demo ===\n')

  // 展示所有注册的 Agent Card
  console.log('[Registry] Registered agents:')
  for (const agent of AGENT_REGISTRY) {
    console.log(`  - ${agent.name} (${agent.url})`)
    console.log(`    Skills: ${agent.skills.map(s => s.name).join(', ')}`)
    console.log(`    Capabilities: streaming=${agent.capabilities.streaming}, push=${agent.capabilities.pushNotifications}`)
  }
  console.log()

  // 用 LLM 来理解用户需求，调用发现工具
  const userQuery = 'I need to research the latest trends in AI agent frameworks and then write a Python script to compare them.'

  console.log(`[User] ${userQuery}\n`)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are an A2A orchestrator. When a user gives you a task, use the discover_agents tool to find suitable agents. Analyze the task and break it into sub-tasks if needed, then find the best agent for each sub-task. Explain which agents you would delegate to and why.`,
    },
    { role: 'user', content: userQuery },
  ]

  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages,
    tools: [discoveryTool],
    tool_choice: 'required',
  })

  const assistantMessage = response.choices[0].message
  messages.push(assistantMessage)

  const toolCalls = assistantMessage.tool_calls ?? []
  if (toolCalls.length === 0) {
    console.log(`[Orchestrator] ${assistantMessage.content}`)
    return
  }

  // 处理每个发现请求
  for (const toolCall of toolCalls) {
    const args = JSON.parse(toolCall.function.arguments)
    console.log(`[Discovery] Searching for: "${args.query}"${args.requiredTags ? ` (tags: ${args.requiredTags.join(', ')})` : ''}`)

    const matched = discoverAgents(args.query, args.requiredTags)
    const result = matched.map(a => ({
      name: a.name,
      url: a.url,
      description: a.description,
      skills: a.skills.map(s => ({ name: s.name, description: s.description })),
      capabilities: a.capabilities,
    }))

    console.log(`[Discovery] Found ${result.length} agent(s): ${result.map(a => a.name).join(', ')}\n`)

    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result),
    })
  }

  // LLM 根据发现结果给出编排方案
  const finalResponse = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages,
  })

  console.log(`[Orchestrator] ${finalResponse.choices[0].message.content}`)
}

main().catch(console.error)
