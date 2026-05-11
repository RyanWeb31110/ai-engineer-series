// multi-agent.ts — A2A 实战：多 Agent 协作完成复杂任务
// 演示 Orchestrator 如何发现、委派、汇总多个 Agent 的工作

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

// ─── A2A 类型定义 ──────────────────────────────────────────────────────────────

interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
}

interface AgentCard {
  name: string
  url: string
  description: string
  skills: AgentSkill[]
}

type TaskState = 'submitted' | 'working' | 'completed' | 'failed'

interface TaskResult {
  taskId: string
  agentName: string
  state: TaskState
  output: string
}

// ─── 模拟 Agent 注册表 ─────────────────────────────────────────────────────────

const AGENTS: AgentCard[] = [
  {
    name: 'Research Agent',
    url: 'http://localhost:8001',
    description: 'Searches and summarizes information from the web',
    skills: [
      { id: 'search', name: 'Web Search', description: 'Search for information', tags: ['search', 'research'] },
    ],
  },
  {
    name: 'Writer Agent',
    url: 'http://localhost:8002',
    description: 'Writes structured content like articles, reports, and documentation',
    skills: [
      { id: 'write', name: 'Content Writing', description: 'Write articles and reports', tags: ['writing', 'content'] },
    ],
  },
  {
    name: 'Reviewer Agent',
    url: 'http://localhost:8003',
    description: 'Reviews content for accuracy, clarity, and quality',
    skills: [
      { id: 'review', name: 'Content Review', description: 'Review and improve content', tags: ['review', 'quality'] },
    ],
  },
]

// ─── 模拟远程 Agent 执行（每个 Agent 用独立的 LLM 调用模拟） ────────────────────

async function sendMessageToAgent(agent: AgentCard, taskDescription: string, context?: string): Promise<TaskResult> {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  console.log(`[A2A] SendMessage to ${agent.name} (${agent.url})`)
  console.log(`  Task: ${taskDescription.slice(0, 80)}...`)

  const systemPrompt = `You are "${agent.name}". ${agent.description}.
Your skills: ${agent.skills.map(s => s.description).join(', ')}.
Complete the assigned task concisely. Output only the result, no meta-commentary.`

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  if (context) {
    messages.push({ role: 'user', content: `Context from previous agents:\n${context}` })
  }
  messages.push({ role: 'user', content: taskDescription })

  try {
    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      messages,
      temperature: 0.3,
    })

    const output = response.choices[0].message.content ?? ''
    console.log(`[A2A] ${agent.name} completed (${output.length} chars)\n`)

    return { taskId, agentName: agent.name, state: 'completed', output }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.log(`[A2A] ${agent.name} FAILED: ${errMsg.slice(0, 100)}\n`)
    return { taskId, agentName: agent.name, state: 'failed', output: `Error: ${errMsg}` }
  }
}

// ─── Orchestrator：拆解任务 + 委派 + 汇总 ──────────────────────────────────────

const orchestratorTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'delegate_tasks',
      description: 'Break down a complex task into sub-tasks and assign each to the most suitable agent. Tasks can be sequential (output of one feeds into the next) or parallel.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                step: { type: 'number', description: 'Step number (same number = parallel execution)' },
                agentName: { type: 'string', description: 'Name of the agent to delegate to' },
                task: { type: 'string', description: 'Specific task description for this agent' },
                dependsOn: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Step numbers this task depends on (for sequential execution)',
                },
              },
              required: ['step', 'agentName', 'task'],
            },
          },
        },
        required: ['plan'],
      },
    },
  },
]

interface SubTask {
  step: number
  agentName: string
  task: string
  dependsOn?: number[]
}

async function orchestrate(userRequest: string): Promise<void> {
  console.log('=== A2A Multi-Agent Orchestration Demo ===\n')
  console.log(`[User] ${userRequest}\n`)

  // 第一步：Orchestrator 用 LLM 拆解任务
  const agentList = AGENTS.map(a =>
    `- ${a.name}: ${a.description} (skills: ${a.skills.map(s => s.name).join(', ')})`
  ).join('\n')

  const planMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are an A2A orchestrator. You have access to these agents:\n${agentList}\n\nBreak down the user's request into sub-tasks and assign each to the best agent. Use sequential steps when one task depends on another's output. Keep it practical — 2-4 steps max.`,
    },
    { role: 'user', content: userRequest },
  ]

  console.log('[Orchestrator] Planning task delegation...\n')

  const planResponse = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages: planMessages,
    tools: orchestratorTools,
    tool_choice: 'required',
  })

  const toolCalls = planResponse.choices[0].message.tool_calls ?? []
  if (toolCalls.length === 0) {
    console.log('[Orchestrator] Failed to create execution plan')
    return
  }

  const { plan } = JSON.parse(toolCalls[0].function.arguments) as { plan: SubTask[] }

  // 打印执行计划
  console.log('[Orchestrator] Execution plan:')
  for (const step of plan) {
    const deps = step.dependsOn?.length ? ` (depends on step ${step.dependsOn.join(', ')})` : ''
    console.log(`  Step ${step.step}: ${step.agentName} — ${step.task.slice(0, 60)}...${deps}`)
  }
  console.log()

  // 第二步：按计划执行，处理依赖关系
  const results = new Map<number, TaskResult>()

  // 按 step 分组
  const stepGroups = new Map<number, SubTask[]>()
  for (const task of plan) {
    const group = stepGroups.get(task.step) ?? []
    group.push(task)
    stepGroups.set(task.step, group)
  }

  // 按 step 顺序执行
  const sortedSteps = [...stepGroups.keys()].sort((a, b) => a - b)

  for (const stepNum of sortedSteps) {
    const tasks = stepGroups.get(stepNum)!
    console.log(`--- Executing Step ${stepNum} (${tasks.length} task(s)) ---\n`)

    // 收集依赖的上下文
    const getContext = (task: SubTask): string | undefined => {
      if (!task.dependsOn?.length) return undefined
      return task.dependsOn
        .map(dep => results.get(dep))
        .filter(Boolean)
        .map(r => `[${r!.agentName}]: ${r!.output}`)
        .join('\n\n')
    }

    // 同一 step 内的任务并行执行
    const promises = tasks.map(async task => {
      const agent = AGENTS.find(a => a.name === task.agentName)
      if (!agent) {
        console.log(`[Error] Agent "${task.agentName}" not found in registry`)
        return { step: task.step, result: null }
      }
      const context = getContext(task)
      const result = await sendMessageToAgent(agent, task.task, context)
      return { step: task.step, result }
    })

    const stepResults = await Promise.all(promises)
    for (const { step, result } of stepResults) {
      if (result) results.set(step, result)
    }
  }

  // 第三步：汇总所有结果
  console.log('--- Final Summary ---\n')

  const allOutputs = [...results.entries()]
    .sort(([a], [b]) => a - b)
    .map(([step, r]) => `[Step ${step} — ${r.agentName}]:\n${r.output}`)
    .join('\n\n---\n\n')

  const summaryMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: 'You are an orchestrator summarizing the results from multiple agents. Combine their outputs into a coherent final response for the user. Be concise.',
    },
    {
      role: 'user',
      content: `Original request: ${userRequest}\n\nAgent outputs:\n\n${allOutputs}\n\nPlease synthesize these into a final response.`,
    },
  ]

  const summaryResponse = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages: summaryMessages,
    temperature: 0.3,
  })

  console.log(`[Orchestrator — Final Response]\n${summaryResponse.choices[0].message.content}`)
}

// ─── 运行 ───────────────────────────────────────────────────────────────────────

orchestrate(
  'Write a short technical comparison of A2A vs MCP protocols for AI agent communication. Research the key differences first, then write the comparison, and finally review it for accuracy.'
).catch(console.error)
