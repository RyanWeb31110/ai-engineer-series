// todo-server.ts - 完整的 MCP Server 实战：Todo 任务管理
// 包含三大原语演示：Tools（增删改查）、Resources（统计数据）、Prompts（任务分解模板）

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ─── 数据层 ──────────────────────────────────────────────────────────────────

/** Todo 状态枚举 */
type TodoStatus = 'pending' | 'in_progress' | 'done'

/** Todo 数据结构 */
interface Todo {
  id: string
  title: string
  description: string
  status: TodoStatus
  priority: 'low' | 'medium' | 'high'
  createdAt: string
}

// 内存存储（生产环境应替换为数据库）
const todos = new Map<string, Todo>()
let nextId = 1

/** 生成唯一 ID */
function generateId(): string {
  return `todo-${nextId++}`
}

// ─── Server 初始化 ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'todo-server',
  version: '1.0.0',
})

// ─── Tools：让 LLM 执行操作 ──────────────────────────────────────────────────

// 工具 1：添加 Todo
server.registerTool(
  'add_todo',
  {
    title: 'Add Todo',
    description: 'Create a new todo item with title, description, and priority',
    inputSchema: z.object({
      title: z.string().describe('Short title of the todo'),
      description: z.string().default('').describe('Detailed description (optional)'),
      priority: z.enum(['low', 'medium', 'high']).default('medium').describe('Priority level'),
    }),
  },
  async ({ title, description, priority }) => {
    const id = generateId()
    const todo: Todo = {
      id,
      title,
      description,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
    }
    todos.set(id, todo)
    console.error(`[Tool] add_todo: created ${id} - "${title}"`)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(todo, null, 2) }],
    }
  }
)

// 工具 2：列出 Todo
server.registerTool(
  'list_todos',
  {
    title: 'List Todos',
    description: 'List all todos, optionally filtered by status',
    inputSchema: z.object({
      status: z.enum(['pending', 'in_progress', 'done', 'all']).default('all')
        .describe('Filter by status, or "all" to show everything'),
    }),
  },
  async ({ status }) => {
    let items = Array.from(todos.values())
    if (status !== 'all') {
      items = items.filter(t => t.status === status)
    }
    console.error(`[Tool] list_todos: found ${items.length} item(s) (filter: ${status})`)
    if (items.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No todos found.' }],
      }
    }
    const text = items.map(t =>
      `[${t.id}] ${t.status === 'done' ? 'DONE' : t.status === 'in_progress' ? 'IN_PROGRESS' : 'PENDING'} (${t.priority}) ${t.title}`
    ).join('\n')
    return {
      content: [{ type: 'text' as const, text }],
    }
  }
)

// 工具 3：更新 Todo 状态
server.registerTool(
  'update_todo',
  {
    title: 'Update Todo',
    description: 'Update a todo\'s status or priority by its ID',
    inputSchema: z.object({
      id: z.string().describe('Todo ID (e.g. "todo-1")'),
      status: z.enum(['pending', 'in_progress', 'done']).optional()
        .describe('New status'),
      priority: z.enum(['low', 'medium', 'high']).optional()
        .describe('New priority'),
    }),
  },
  async ({ id, status, priority }) => {
    const todo = todos.get(id)
    if (!todo) {
      return {
        content: [{ type: 'text' as const, text: `Todo "${id}" not found.` }],
      }
    }
    if (status) todo.status = status
    if (priority) todo.priority = priority
    console.error(`[Tool] update_todo: ${id} -> status=${todo.status}, priority=${todo.priority}`)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(todo, null, 2) }],
    }
  }
)

// 工具 4：删除 Todo
server.registerTool(
  'delete_todo',
  {
    title: 'Delete Todo',
    description: 'Delete a todo by its ID',
    inputSchema: z.object({
      id: z.string().describe('Todo ID to delete'),
    }),
  },
  async ({ id }) => {
    const existed = todos.delete(id)
    console.error(`[Tool] delete_todo: ${id} -> ${existed ? 'deleted' : 'not found'}`)
    return {
      content: [{
        type: 'text' as const,
        text: existed ? `Todo "${id}" deleted successfully.` : `Todo "${id}" not found.`,
      }],
    }
  }
)

// ─── Resources：给 LLM 提供上下文数据 ────────────────────────────────────────

// 资源 1：Todo 统计概览（静态 URI）
server.registerResource(
  'todo-stats',
  'todo://stats',
  {
    description: 'Overview of todo counts by status and priority',
    mimeType: 'application/json',
  },
  async (uri) => {
    const items = Array.from(todos.values())
    const stats = {
      total: items.length,
      byStatus: {
        pending: items.filter(t => t.status === 'pending').length,
        in_progress: items.filter(t => t.status === 'in_progress').length,
        done: items.filter(t => t.status === 'done').length,
      },
      byPriority: {
        high: items.filter(t => t.priority === 'high').length,
        medium: items.filter(t => t.priority === 'medium').length,
        low: items.filter(t => t.priority === 'low').length,
      },
    }
    return {
      contents: [{ uri: uri.href, text: JSON.stringify(stats, null, 2) }],
    }
  }
)

// 资源 2：单个 Todo 详情（动态 URI 模板）
server.registerResource(
  'todo-detail',
  new ResourceTemplate('todo://items/{todoId}', {
    list: async () => ({
      resources: Array.from(todos.values()).map(t => ({
        uri: `todo://items/${t.id}`,
        name: t.title,
      })),
    }),
  }),
  {
    description: 'Detailed information about a specific todo item',
    mimeType: 'application/json',
  },
  async (uri, { todoId }) => {
    const id = todoId as string
    const todo = todos.get(id)
    if (!todo) {
      return {
        contents: [{ uri: uri.href, text: JSON.stringify({ error: `Todo "${id}" not found` }) }],
      }
    }
    return {
      contents: [{ uri: uri.href, text: JSON.stringify(todo, null, 2) }],
    }
  }
)

// ─── Prompts：可复用的提示模板 ────────────────────────────────────────────────

// 提示模板 1：任务分解
server.registerPrompt(
  'break-down-task',
  {
    title: 'Break Down Task',
    description: 'Break a complex task into smaller, actionable sub-tasks',
    argsSchema: {
      task: z.string().describe('The complex task to break down'),
      maxSubtasks: z.string().default('5').describe('Maximum number of sub-tasks'),
    },
  },
  ({ task, maxSubtasks }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: [
          `Please break down the following task into at most ${maxSubtasks} smaller, actionable sub-tasks.`,
          `Each sub-task should be concrete, independently completable, and have a clear definition of done.`,
          '',
          `Task: ${task}`,
          '',
          'Return each sub-task as a JSON object with fields: title, description, priority (low/medium/high).',
          'Return the result as a JSON array.',
        ].join('\n'),
      },
    }],
  })
)

// 提示模板 2：每日总结
server.registerPrompt(
  'daily-summary',
  {
    title: 'Daily Summary',
    description: 'Generate a summary of current todo status for daily standup',
  },
  () => {
    const items = Array.from(todos.values())
    const done = items.filter(t => t.status === 'done')
    const inProgress = items.filter(t => t.status === 'in_progress')
    const pending = items.filter(t => t.status === 'pending')

    const sections = [
      'Here is the current todo list status. Please generate a concise daily standup summary.',
      '',
    ]

    if (done.length > 0) {
      sections.push('Completed:')
      done.forEach(t => sections.push(`  - ${t.title}`))
      sections.push('')
    }
    if (inProgress.length > 0) {
      sections.push('In Progress:')
      inProgress.forEach(t => sections.push(`  - ${t.title} (${t.priority} priority)`))
      sections.push('')
    }
    if (pending.length > 0) {
      sections.push('Pending:')
      pending.forEach(t => sections.push(`  - ${t.title} (${t.priority} priority)`))
      sections.push('')
    }
    if (items.length === 0) {
      sections.push('No todos in the list.')
    }

    return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: sections.join('\n'),
        },
      }],
    }
  }
)

// ─── 启动 Server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 日志输出到 stderr，stdout 留给 MCP 协议消息
  console.error('[MCP Server] todo-server v1.0.0 started (stdio)')
  console.error('[MCP Server] Tools: add_todo, list_todos, update_todo, delete_todo')
  console.error('[MCP Server] Resources: todo://stats, todo://items/{todoId}')
  console.error('[MCP Server] Prompts: break-down-task, daily-summary')
}

main().catch((err) => {
  console.error('[MCP Server] Fatal error:', err)
  process.exit(1)
})
