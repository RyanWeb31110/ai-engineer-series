// task-lifecycle.ts — A2A 协议核心：Task 生命周期
// 演示 Task 从创建到完成的状态流转：submitted → working → completed/failed/input-required

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

// ─── A2A Task 类型定义 ─────────────────────────────────────────────────────────

// Task 的所有合法状态
type TaskState =
  | 'submitted'      // 已提交，等待处理
  | 'working'        // 正在处理
  | 'input-required' // 需要用户补充信息
  | 'completed'      // 成功完成
  | 'failed'         // 执行失败
  | 'canceled'       // 被取消

// 消息中的内容单元
interface TextPart {
  type: 'text'
  text: string
}

interface DataPart {
  type: 'data'
  data: Record<string, unknown>
}

type Part = TextPart | DataPart

// Agent 产出的工件
interface Artifact {
  id: string
  name: string
  parts: Part[]
}

// 对话消息
interface Message {
  role: 'user' | 'agent'
  parts: Part[]
}

// Task 完整结构
interface Task {
  id: string
  contextId: string
  status: {
    state: TaskState
    message?: Message
    timestamp: string
  }
  messages: Message[]
  artifacts: Artifact[]
}

// ─── 模拟 A2A Server 端的 Task 管理 ────────────────────────────────────────────

const taskStore = new Map<string, Task>()

function createTask(userMessage: string): Task {
  const taskId = `task-${Date.now()}`
  const task: Task = {
    id: taskId,
    contextId: `ctx-${Date.now()}`,
    status: {
      state: 'submitted',
      timestamp: new Date().toISOString(),
    },
    messages: [
      { role: 'user', parts: [{ type: 'text', text: userMessage }] },
    ],
    artifacts: [],
  }
  taskStore.set(taskId, task)
  return task
}

function updateTaskState(taskId: string, state: TaskState, agentMessage?: string): Task {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  task.status = {
    state,
    timestamp: new Date().toISOString(),
    ...(agentMessage ? {
      message: { role: 'agent', parts: [{ type: 'text', text: agentMessage }] },
    } : {}),
  }

  if (agentMessage) {
    task.messages.push({ role: 'agent', parts: [{ type: 'text', text: agentMessage }] })
  }

  return task
}

function addArtifact(taskId: string, name: string, parts: Part[]): void {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  task.artifacts.push({ id: `artifact-${task.artifacts.length + 1}`, name, parts })
}

function addUserReply(taskId: string, message: string): void {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  task.messages.push({ role: 'user', parts: [{ type: 'text', text: message }] })
}

// ─── 打印 Task 状态变化 ────────────────────────────────────────────────────────

function logTransition(task: Task, label: string): void {
  console.log(`[${label}] Task ${task.id} => ${task.status.state.toUpperCase()}`)
  if (task.status.message) {
    const text = task.status.message.parts
      .filter((p): p is TextPart => p.type === 'text')
      .map(p => p.text)
      .join('')
    console.log(`  Message: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)
  }
  console.log()
}

// ─── 模拟 Agent 处理逻辑（用 LLM 驱动） ────────────────────────────────────────

const agentTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'request_more_info',
      description: 'Ask the user for additional information needed to complete the task',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'produce_result',
      description: 'Produce the final result for the task',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'A brief summary of the result' },
          content: { type: 'string', description: 'The detailed result content' },
        },
        required: ['summary', 'content'],
      },
    },
  },
]

async function agentProcess(task: Task): Promise<void> {
  // submitted → working
  updateTaskState(task.id, 'working', 'Processing your request...')
  logTransition(taskStore.get(task.id)!, 'Agent')

  // 用 LLM 决定是否需要更多信息，还是直接产出结果
  const conversationHistory = task.messages.map(m => ({
    role: m.role === 'user' ? 'user' as const : 'assistant' as const,
    content: m.parts.filter((p): p is TextPart => p.type === 'text').map(p => p.text).join('\n'),
  }))

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a helpful agent processing a task. Analyze the user's request:
- If you have enough information to produce a result, use the produce_result tool.
- If you need clarification or additional details, use the request_more_info tool.
Be concise and practical.`,
    },
    ...conversationHistory,
  ]

  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages,
    tools: agentTools,
    tool_choice: 'required',
  })

  const toolCalls = response.choices[0].message.tool_calls ?? []
  if (toolCalls.length === 0) {
    updateTaskState(task.id, 'failed', 'Agent did not produce a valid response')
    logTransition(taskStore.get(task.id)!, 'Agent')
    return
  }

  const call = toolCalls[0]
  const args = JSON.parse(call.function.arguments)

  if (call.function.name === 'request_more_info') {
    // working → input-required
    updateTaskState(task.id, 'input-required', args.question)
    logTransition(taskStore.get(task.id)!, 'Agent')
  } else if (call.function.name === 'produce_result') {
    // working → completed，同时产出 Artifact
    addArtifact(task.id, 'result', [
      { type: 'text', text: args.content },
      { type: 'data', data: { summary: args.summary } },
    ])
    updateTaskState(task.id, 'completed', args.summary)
    logTransition(taskStore.get(task.id)!, 'Agent')
  }
}

// ─── 演示完整的 Task 生命周期 ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== A2A Task Lifecycle Demo ===\n')

  // 场景 1：直接完成的任务
  console.log('--- Scenario 1: Direct Completion ---\n')
  const task1 = createTask('Explain the difference between REST and GraphQL in 3 bullet points.')
  logTransition(task1, 'Client')
  await agentProcess(task1)

  const finalTask1 = taskStore.get(task1.id)!
  if (finalTask1.artifacts.length > 0) {
    console.log('[Artifacts]')
    for (const artifact of finalTask1.artifacts) {
      const textParts = artifact.parts.filter((p): p is TextPart => p.type === 'text')
      console.log(`  ${artifact.name}: ${textParts.map(p => p.text).join('').slice(0, 200)}...`)
    }
    console.log()
  }

  // 场景 2：需要补充信息的任务（input-required 状态）
  console.log('--- Scenario 2: Input Required → Resume ---\n')
  const task2 = createTask('Help me optimize my database query.')
  logTransition(task2, 'Client')
  await agentProcess(task2)

  // 如果 Agent 要求补充信息，模拟用户回复
  const currentTask2 = taskStore.get(task2.id)!
  if (currentTask2.status.state === 'input-required') {
    console.log('[Client] User provides additional info...\n')
    addUserReply(task2.id, 'The query is: SELECT * FROM orders JOIN users ON orders.user_id = users.id WHERE orders.created_at > NOW() - INTERVAL 30 DAY. The orders table has 10 million rows.')
    // Agent 继续处理
    await agentProcess(currentTask2)
  }

  // 场景 3：取消任务
  console.log('--- Scenario 3: Task Cancellation ---\n')
  const task3 = createTask('Generate a full report on global climate data for the past decade.')
  logTransition(task3, 'Client')
  updateTaskState(task3.id, 'working', 'Starting report generation...')
  logTransition(taskStore.get(task3.id)!, 'Agent')
  // Client 决定取消
  console.log('[Client] Canceling task...\n')
  updateTaskState(task3.id, 'canceled', 'Task canceled by client')
  logTransition(taskStore.get(task3.id)!, 'System')

  // 打印状态流转总结
  console.log('=== Task State Summary ===\n')
  console.log('Valid state transitions in A2A:')
  console.log('  submitted → working')
  console.log('  working → completed | failed | input-required | canceled')
  console.log('  input-required → working (user provides info, agent resumes)')
  console.log('  input-required → canceled')
  console.log()
  console.log('Terminal states: completed, failed, canceled, rejected')
}

main().catch(console.error)
