# 动手写一个 MCP Server

> 从零构建一个完整的 MCP Server，覆盖三大原语和 LLM 集成

---

上一篇我们搞清楚了 MCP 是什么、为什么需要它。但只看架构图和概念不够，MCP 最好的学习方式是动手写一个。

这篇我们从零开始构建一个 **Todo 任务管理 MCP Server**，覆盖三大核心原语（Tools、Resources、Prompts），然后写一个 Agent Client 让 LLM 通过 MCP 自主管理任务。你会在过程中理解 MCP Server 的每一层是怎么工作的。

---

## 确定要做什么

我们要构建的 Server 功能很明确：一个 Todo 管理服务，提供以下能力：

- **Tools**：增删改查 Todo（`add_todo`、`list_todos`、`update_todo`、`delete_todo`）
- **Resources**：只读数据查询（统计概览、单个 Todo 详情）
- **Prompts**：可复用的提示模板（任务分解、每日总结）

三大原语全覆盖，刚好够用来理解每个原语的使用场景和实现方式。

项目结构：

```
11-mcp-server/
├── package.json
├── tsconfig.json
├── .env
└── src/
    ├── todo-server.ts    # MCP Server：完整实现
    ├── todo-client.ts    # MCP Client：遍历三大原语
    └── agent-client.ts   # LLM Agent：通过 MCP 自主管理 Todo
```

---

## 搭建 MCP Server 骨架

先把最基础的 Server 跑起来。MCP TypeScript SDK 提供了 `McpServer` 高层封装，处理 JSON-RPC 协议细节，你只需要关注业务逻辑：

```typescript
// todo-server.ts 节选

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'todo-server',
  version: '1.0.0',
})

// ... 注册 Tools、Resources、Prompts ...

// 启动 stdio 传输
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[MCP Server] todo-server v1.0.0 started (stdio)')
```

三步：创建实例、注册能力、连接传输。注意 `console.error` 而不是 `console.log`，上一篇提过这个坑：stdio 模式下 stdout 是协议通道，日志必须走 stderr。

数据层用一个简单的 `Map` 做内存存储：

```typescript
// todo-server.ts 节选

interface Todo {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
}

const todos = new Map<string, Todo>()
```

生产环境换成数据库，Server 的协议层代码不用改。

---

## 注册 Tools：让 LLM 执行操作

**Tools** 是 MCP 最核心的原语，对应"LLM 能做什么"。我们注册四个工具：

```typescript
// todo-server.ts 节选

// 添加 Todo
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
      id, title, description, status: 'pending', priority,
      createdAt: new Date().toISOString(),
    }
    todos.set(id, todo)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(todo, null, 2) }],
    }
  }
)
```

`registerTool` 接收三个参数：工具名、配置（描述 + 输入 schema）、处理函数。几个关键点：

- **`inputSchema` 用 Zod** 定义参数，SDK 会自动转成 JSON Schema 暴露给 Client，运行时自动验证输入
- **`description`** 和每个参数的 `.describe()` 非常重要，这些文本会被 LLM 读到，直接影响工具调用的准确率
- **返回格式固定**：`content` 数组里放 `{ type: 'text', text: '...' }`，这是 MCP 协议规定的内容格式

类似地，`list_todos`、`update_todo`、`delete_todo` 的注册方式完全一样，只是业务逻辑不同。这就是 MCP Server 开发最核心的模式：**定义 schema，写处理函数，注册到 Server**。

---

## 注册 Resources：给 LLM 提供上下文

上一篇提到，**Resources 是只读的数据源**，和 Tools 的区别在于：Tools 可以有副作用（创建、修改、删除），Resources 是安全的查询操作。

我们注册两种 Resource：

**静态 URI 资源**：固定地址，返回 Todo 统计：

```typescript
// todo-server.ts 节选

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
    }
    return {
      contents: [{ uri: uri.href, text: JSON.stringify(stats, null, 2) }],
    }
  }
)
```

**动态 URI 模板资源**：地址包含变量，按 ID 返回单个 Todo 详情：

```typescript
// todo-server.ts 节选

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

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
    const todo = todos.get(todoId as string)
    if (!todo) {
      return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'Not found' }) }] }
    }
    return { contents: [{ uri: uri.href, text: JSON.stringify(todo, null, 2) }] }
  }
)
```

`ResourceTemplate` 的 `{todoId}` 是 URI 模板变量，Client 访问 `todo://items/todo-1` 时，SDK 自动解析出 `todoId = 'todo-1'` 传给回调。`list` 回调告诉 Client 当前有哪些可用的资源实例。

**什么时候用 Tool，什么时候用 Resource？** 判断标准很简单：

- 操作会修改数据 → Tool
- 只是查询/读取数据 → Resource

这个区分让 Host 应用可以实施不同的安全策略：Resource 可以自动加载（无副作用），Tool 需要用户确认（可能有副作用）。

---

## 注册 Prompts：可复用的提示模板

**Prompts** 是 Server 预定义的提示模板，Host 应用的用户可以主动选择使用。比如在 Claude Desktop 里，你可以从 Server 提供的模板列表里选一个来快速构建提问。

```typescript
// todo-server.ts 节选

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
        text: `Please break down the following task into at most ${maxSubtasks} sub-tasks.\n\nTask: ${task}`,
      },
    }],
  })
)
```

注意 `argsSchema` 和 Tools 的 `inputSchema` 写法不同：Prompts 用 raw shape（直接写 `{ key: z.string() }`），Tools 用 `z.object()` 包裹。这是 SDK 的 API 设计差异。

我们还注册了一个 `daily-summary` 模板，它不接受参数，而是动态读取当前 Todo 列表状态来生成每日站会汇报的提示词。这展示了 Prompts 的一个强大能力：**模板内容可以是动态的**，不只是静态字符串替换。

---

## Client 端：发现和调用

Server 写完了，怎么用？写一个 Client 来连接它：

```typescript
// todo-client.ts 节选

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'todo-client', version: '1.0.0' })

// 通过 stdio 连接（Client 自动启动 Server 子进程）
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/todo-server.ts'],
})
await client.connect(transport)
```

连接建立后，Client 可以：

**发现能力**：不需要预先知道 Server 有什么，运行时动态查询。

```typescript
// todo-client.ts 节选

const { tools } = await client.listTools()          // 发现工具
const { resources } = await client.listResources()  // 发现资源
const { prompts } = await client.listPrompts()      // 发现模板
```

**调用工具**：

```typescript
// todo-client.ts 节选

const result = await client.callTool({
  name: 'add_todo',
  arguments: { title: 'Design API schema', priority: 'high' },
})
```

**读取资源**：

```typescript
// todo-client.ts 节选

const stats = await client.readResource({ uri: 'todo://stats' })
const detail = await client.readResource({ uri: 'todo://items/todo-1' })
```

**获取提示模板**：

```typescript
// todo-client.ts 节选

const prompt = await client.getPrompt({
  name: 'break-down-task',
  arguments: { task: 'Build a user authentication system', maxSubtasks: '3' },
})
// prompt.messages 可以直接传给 LLM
```

运行 `pnpm client` 看完整流程：

```
=== MCP Client Demo: Todo Server ===

[Connect] Connected!

--- Tools ---
Found 4 tool(s):
  - add_todo: Create a new todo item with title, description, and priority
  - list_todos: List all todos, optionally filtered by status
  - update_todo: Update a todo's status or priority by its ID
  - delete_todo: Delete a todo by its ID

--- Resources ---
Found 1 resource(s):
  - todo://stats: todo-stats
Found 1 resource template(s):
  - todo://items/{todoId}: todo-detail

--- Prompts ---
Found 2 prompt(s):
  - break-down-task: Break a complex task into smaller, actionable sub-tasks
  - daily-summary: Generate a summary of current todo status for daily standup
```

所有能力都是 Client 在运行时自动发现的，Server 添加新工具后 Client 无需改代码。

---

## 关键一步：MCP + LLM 集成

前面的 Client 是手动调用工具，实际场景中应该是 **LLM 来决定调用什么工具**。这需要把 MCP 工具列表转换为 Function Calling 格式，然后跑 Agent 循环。

核心桥接代码很短：

```typescript
// agent-client.ts 节选

/** 把 MCP Server 的工具列表转换为 OpenAI Function Calling 格式 */
function mcpToolsToOpenAI(
  mcpTools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>
): ChatCompletionTool[] {
  return mcpTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }))
}
```

MCP 的 `listTools()` 返回的 `inputSchema` 已经是 JSON Schema 格式，刚好就是 Function Calling 需要的 `parameters`，转换几乎是零成本。

Agent 循环的逻辑和第 08 章的 ReAct 模式一样：

```typescript
// agent-client.ts 节选

// 1. 从 MCP Server 动态发现工具
const { tools: mcpTools } = await client.listTools()
const openaiTools = mcpToolsToOpenAI(mcpTools)

// 2. Agent 循环
for (let turn = 0; turn < MAX_TURNS; turn++) {
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    messages,
    tools: openaiTools,
    tool_choice: 'auto',
  })

  const toolCalls = response.choices[0].message.tool_calls ?? []
  if (toolCalls.length === 0) {
    // LLM 不再调用工具，输出最终回复
    console.log(response.choices[0].message.content)
    break
  }

  // 通过 MCP Client 执行工具调用
  for (const toolCall of toolCalls) {
    const args = JSON.parse(toolCall.function.arguments)
    const mcpResult = await client.callTool({
      name: toolCall.function.name,
      arguments: args,
    })
    // 把结果反馈给 LLM，继续下一轮推理
    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: resultText })
  }
}
```

运行 `pnpm agent` 看效果：

```
[User] 帮我创建三个任务：1) 设计数据库表结构（高优先级）2) 编写 API 接口（中优先级）3) 撰写技术文档（低优先级）

[Agent] Discovered 4 tools from MCP Server

--- Turn 1 ---
[Agent] Calling tool: add_todo({"title":"设计数据库表结构","priority":"high"})
[Agent] Tool result: { "id": "todo-1", "title": "设计数据库表结构", "status": "pending" ... }

--- Turn 2 ---
[Agent] Calling tool: add_todo({"title":"编写 API 接口","priority":"medium"})

--- Turn 3 ---
[Agent] Calling tool: add_todo({"title":"撰写技术文档","priority":"low"})

--- Turn 4 ---
[Agent] Final response:
已创建 3 个任务并设置优先级：
1) 设计数据库表结构（高）
2) 编写 API 接口（中）
3) 撰写技术文档（低）
```

LLM 自主解析了用户的自然语言请求，拆成三次 `add_todo` 调用，每次推断出正确的优先级，最后用中文给出确认。整个过程中，LLM 不知道也不关心工具是怎么实现的，它只看到 MCP 暴露出来的工具描述。

---

## 踩坑与最佳实践

### 1. 工具描述是第一优先级

LLM 选择调用哪个工具、传什么参数，完全依赖 `description` 和参数的 `.describe()` 文本。描述写得模糊，工具调用就不准确。

好的描述：`'Create a new todo item with title, description, and priority'`
差的描述：`'Add todo'`

参数描述也一样，`z.string().describe('Todo ID (e.g. "todo-1")')` 比 `z.string()` 好很多，因为给了 LLM 一个格式示例。

### 2. 工具粒度要小，每个工具做一件事

不要写一个大而全的 `manage_todo` 工具包含所有操作。拆成 `add_todo`、`list_todos`、`update_todo`、`delete_todo` 四个独立工具，LLM 更容易理解和正确调用。

这也和 MCP 的设计哲学一致：**Server 高度可组合，每个能力专注一件事。**

### 3. Resource 和 Tool 的边界要清晰

一个常见的设计错误是把查询操作也写成 Tool。比如"获取 Todo 统计"这种只读操作，应该用 Resource 而不是 Tool。原因：

- Host 可以对 Resource 实施宽松的安全策略（因为没有副作用）
- LLM 可以随时读取 Resource 来获取上下文，不需要消耗工具调用的"决策预算"
- Resource 支持 URI 寻址，可以被缓存和索引

### 4. 生产环境别用 console.error 做日志

我们的示例用 `console.error` 输出日志是因为简单。生产环境应该用正式的日志库（如 winston、pino），输出到日志文件，带时间戳和日志级别。MCP SDK 也支持通过协议发送日志消息给 Client，在 Server 初始化时启用 `capabilities: { logging: {} }` 即可。

### 5. MCP 工具到 Function Calling 的转换几乎是零成本

`listTools()` 返回的 `inputSchema` 就是 JSON Schema，直接就是 Function Calling 的 `parameters` 格式。这不是巧合，MCP 就是按照和 Function Calling 兼容的方式设计的。这意味着如果你已经有 Function Calling 的工具实现，迁移到 MCP 非常容易。

---

## 小结

- **MCP Server 开发模式很简单**：创建实例、用 `registerTool` / `registerResource` / `registerPrompt` 注册能力、连接传输层，三步搞定
- **三大原语各司其职**：Tools 做操作（增删改），Resources 提供只读数据，Prompts 是可复用的提示模板；区分它们的关键是"有没有副作用"
- **MCP 和 Function Calling 是天然互补的**：MCP 的 `listTools()` 返回的 schema 可以直接转为 Function Calling 格式，Agent 循环里只需要几行桥接代码

现在你已经能写一个完整的 MCP Server 了。下一篇我们换个角度，看看另一种工具集成方式：Plugin（GPT Actions），它用 OpenAPI 规范把任何 REST API 接入 AI。

---

**下一篇**：Plugin（GPT Actions）：用 OpenAPI 把服务接入 AI

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 11 篇*
