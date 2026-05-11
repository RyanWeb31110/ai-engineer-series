# Plugin（GPT Actions）：用 OpenAPI 把服务接入 AI

> 一份 API 文档，就能让 LLM 自动调用你的服务

---

上一篇我们动手写了一个 MCP Server，体验了"注册工具 → LLM 调用"的完整流程。但你可能会想：我已经有一堆 REST API 了，难道要把它们全部用 MCP 重写一遍？

不需要。**Plugin（也叫 GPT Actions）** 提供了另一条路：只要你的 API 有一份 **OpenAPI 规范**（也就是以前的 Swagger），LLM 就能自动读懂它，然后直接发起 HTTP 调用。不用写 SDK，不用注册工具，一份 JSON 文件搞定。

这篇我们从 OpenAPI 规范讲起，搞清楚 Plugin 是怎么工作的，然后写一个完整的 Plugin Agent：让 LLM 读一份 OpenAPI spec，自动把 REST API 变成 Function Calling 工具。

---

## OpenAPI 规范：机器可读的 API 文档

你肯定见过 Swagger UI，那个可以在浏览器里测试 API 的页面。Swagger UI 背后的数据来源就是 **OpenAPI 规范**（OpenAPI Specification，简称 OAS），一份用 JSON 或 YAML 写的结构化文档，描述了一个 REST API 的所有端点、参数、请求体、响应格式。

关键点：OpenAPI 规范不只是给人看的文档，它是**机器可读的**。这意味着程序可以解析它，自动生成客户端代码、测试用例，或者在我们的场景中，自动生成 Function Calling 的工具定义。

一份最简的 OpenAPI spec 长这样：

```typescript
// openapi-spec.ts 节选

export const bookstoreSpec: OpenAPISpec = {
  openapi: '3.1.0',
  info: {
    title: 'Bookstore API',
    description:
      'A simple bookstore API for searching, browsing, and managing books.',
    version: '1.0.0',
  },
  servers: [{ url: 'http://localhost:3100', description: 'Local development server' }],
  paths: {
    // 每个路径对应一个 API 端点
    '/books': {
      get: { /* 搜索图书 */ },
      post: { /* 添加图书 */ },
    },
    '/books/{bookId}': {
      get: { /* 查看详情 */ },
    },
    '/categories': {
      get: { /* 分类列表 */ },
    },
  },
}
```

几个核心字段：

- **`info`**：API 的名称、描述、版本，LLM 用它来理解"这个 API 是做什么的"
- **`servers`**：API 的地址，运行时用来构造请求 URL
- **`paths`**：所有端点的定义，每个端点包含 HTTP 方法、参数、响应格式

每个端点的定义更有意思。拿搜索图书的 `GET /books` 来看：

```typescript
// openapi-spec.ts 节选

get: {
  operationId: 'searchBooks',
  summary: 'Search books',
  description:
    'Search for books by keyword (matches title and author) and/or category. ' +
    'Returns a list of matching books with basic information.',
  parameters: [
    {
      name: 'q',
      in: 'query',
      required: false,
      description: 'Search keyword, matches against book title and author name',
      schema: { type: 'string', example: 'JavaScript' },
    },
    {
      name: 'category',
      in: 'query',
      required: false,
      description: 'Filter by book category',
      schema: {
        type: 'string',
        enum: ['programming', 'ai', 'database', 'devops', 'design'],
      },
    },
  ],
  responses: {
    '200': {
      description: 'List of matching books',
      content: { 'application/json': { schema: { /* ... */ } } },
    },
  },
}
```

注意这几个字段：

- **`operationId`**：操作的唯一标识符，Plugin 系统用它当"函数名"
- **`summary` / `description`**：和 Function Calling 的 `description` 一样重要，LLM 靠它决定什么时候调用这个 API
- **`parameters`**：每个参数的名称、位置（query / path / header）、类型、描述，这和 Function Calling 的 `parameters` 几乎是同一套 JSON Schema
- **`responses`**：返回值的格式描述

发现规律了吗？**OpenAPI spec 里的 operation，和 Function Calling 的 tool 定义，结构几乎一一对应**。这不是巧合，这是 Plugin 系统能工作的根本原因。

---

## Plugin 的工作原理

理解了 OpenAPI 规范之后，Plugin 的工作原理就很清晰了。整个流程分三步：

**第一步：获取 spec**。Plugin 系统从一个约定的 URL（通常是 `/openapi.json` 或 `/.well-known/openapi.json`）拉取 API 的 OpenAPI 规范。

**第二步：spec → 工具定义**。把 spec 里的每个 operation 转换成一个 Function Calling 工具：`operationId` 变成函数名，`parameters` + `requestBody` 变成函数参数，`summary` + `description` 变成函数描述。

**第三步：LLM 调用**。把转换后的工具列表传给 LLM，LLM 根据用户请求决定调用哪个工具、传什么参数。Plugin 系统拿到 LLM 的工具调用结果后，构造实际的 HTTP 请求发给 API，把响应传回 LLM。

用图来表示：

```
用户请求 → LLM（带工具列表）→ 选择工具 + 参数
                                    ↓
                            Plugin 运行时
                                    ↓
                      构造 HTTP 请求 → REST API
                                    ↓
                      API 响应 → 传回 LLM → 最终回复
```

这就是 ChatGPT 的 GPT Actions、各种 AI 助手的 Plugin 系统背后的核心逻辑。区别只在于具体实现：有的在云端做 spec 转换，有的在客户端做，但原理一样。

---

## 代码实战

我们来完整实现这个流程。项目结构：

```
12-plugin-openapi/
├── package.json
├── tsconfig.json
├── .env
└── src/
    ├── openapi-spec.ts    # OpenAPI 规范定义
    ├── api-server.ts      # REST API 服务（Express）
    └── plugin-agent.ts    # Plugin Agent：读 spec → 转工具 → LLM 调用
```

### REST API 服务

先有一个真实的 API 可以调用。我们用 Express 搭一个书店 API，提供四个端点：

```typescript
// api-server.ts 节选

// OpenAPI spec 端点 — Plugin 系统通过这个端点发现 API 能力
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(bookstoreSpec)
})

// 搜索图书
app.get('/books', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').toLowerCase()
  const category = req.query.category as string || ''

  let results = Array.from(books.values())
  if (q) {
    results = results.filter(
      b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
  }
  if (category) {
    results = results.filter(b => b.category === category)
  }

  const list = results.map(({ id, title, author, category, price }) => ({
    id, title, author, category, price,
  }))
  res.json(list)
})

// 查看图书详情
app.get('/books/:bookId', (req: Request, res: Response) => {
  const bookId = Array.isArray(req.params.bookId)
    ? req.params.bookId[0] : req.params.bookId
  const book = books.get(bookId)
  if (!book) {
    res.status(404).json({ error: 'Book not found' })
    return
  }
  res.json(book)
})

// 添加新图书
app.post('/books', (req: Request, res: Response) => {
  const { title, author, category, price, description } = req.body
  // ... 创建并返回新图书
})

// 查看分类列表
app.get('/categories', (_req: Request, res: Response) => {
  // ... 统计并返回分类数据
})
```

关键是 `/openapi.json` 端点，它直接返回我们定义好的 OpenAPI spec。这就是 Plugin 系统的入口。

### 核心：OpenAPI spec → Function Calling 工具

这是整个 Plugin 的核心转换逻辑。把 spec 里的每个 operation 映射为一个 Function Calling 工具：

```typescript
// plugin-agent.ts 节选

interface ToolMapping {
  tool: ChatCompletionTool
  method: string  // HTTP 方法
  path: string    // URL 路径模板
}

function specToTools(spec: OpenAPISpec): ToolMapping[] {
  const mappings: ToolMapping[] = []

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const op = operation as { operationId: string; summary: string; /* ... */ }

      // 从 parameters 和 requestBody 构建 JSON Schema 参数
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      // 路径参数和查询参数
      if (op.parameters) {
        for (const param of op.parameters) {
          properties[param.name] = {
            ...param.schema,
            description: param.description,
          }
          if (param.required) required.push(param.name)
        }
      }

      // 请求体参数（展平到同一层级）
      if (op.requestBody) {
        const bodySchema = op.requestBody.content['application/json']?.schema
        if (bodySchema?.properties) {
          Object.assign(properties, bodySchema.properties)
          if (bodySchema.required) required.push(...bodySchema.required)
        }
      }

      const tool: ChatCompletionTool = {
        type: 'function',
        function: {
          name: op.operationId,
          description: `${op.summary}. ${op.description}`,
          parameters: {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
          },
        },
      }

      mappings.push({ tool, method, path })
    }
  }

  return mappings
}
```

转换逻辑很直接：

1. 遍历 spec 的所有 `paths`，每个 path 下的每个 HTTP 方法就是一个 operation
2. `operationId` → `function.name`
3. `summary + description` → `function.description`
4. `parameters`（路径参数、查询参数）+ `requestBody` 的 properties → `function.parameters`
5. 额外记录 `method` 和 `path`，运行时用来构造 HTTP 请求

### 执行实际的 HTTP 调用

LLM 返回工具调用后，需要把参数还原成真正的 HTTP 请求：

```typescript
// plugin-agent.ts 节选

async function executeAPICall(
  baseUrl: string,
  method: string,
  pathTemplate: string,
  args: Record<string, unknown>,
): Promise<string> {
  // 替换路径参数（如 /books/{bookId} → /books/book-1）
  let resolvedPath = pathTemplate
  const bodyArgs: Record<string, unknown> = {}
  const queryParams: string[] = []

  for (const [key, value] of Object.entries(args)) {
    if (pathTemplate.includes(`{${key}}`)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, String(value))
    } else if (method === 'get') {
      queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    } else {
      bodyArgs[key] = value
    }
  }

  const url = queryParams.length > 0
    ? `${baseUrl}${resolvedPath}?${queryParams.join('&')}`
    : `${baseUrl}${resolvedPath}`

  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
    ...(method !== 'get' && Object.keys(bodyArgs).length > 0
      ? { body: JSON.stringify(bodyArgs) }
      : {}),
  })
  return JSON.stringify(await response.json(), null, 2)
}
```

这里的关键是参数路由：

- 路径参数（`{bookId}`）：替换到 URL 路径里
- 查询参数（GET 请求的参数）：拼接到 URL 的 query string
- 请求体参数（POST/PUT 请求的参数）：放到 HTTP body

### Agent 循环

最后把所有部分串起来，跑标准的 Agent 循环：

```typescript
// plugin-agent.ts 节选

async function runPluginAgent(userQuery: string): Promise<void> {
  // 1. 从 API 服务获取 OpenAPI spec
  const spec = await fetchOpenAPISpec(API_BASE_URL)

  // 2. 把 spec 转换为 Function Calling 工具
  const toolMappings = specToTools(spec)
  const tools = toolMappings.map(m => m.tool)

  // 构建 operationId → {method, path} 的查找表
  const lookupTable = new Map(toolMappings.map(m => [m.tool.function.name, m]))

  // 3. Agent 循环
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const toolCalls = assistantMessage.tool_calls ?? []
    if (toolCalls.length === 0) {
      console.log(assistantMessage.content)
      break
    }

    for (const toolCall of toolCalls) {
      const mapping = lookupTable.get(toolCall.function.name)
      const args = JSON.parse(toolCall.function.arguments)
      const result = await executeAPICall(API_BASE_URL, mapping.method, mapping.path, args)
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
    }
  }
}
```

运行效果（先启动 API server，再运行 agent）：

```bash
pnpm server   # 终端 1：启动书店 API
pnpm agent    # 终端 2：运行 Plugin Agent
```

```
=== Plugin Agent ===

[Plugin] Fetching OpenAPI spec from http://localhost:3100/openapi.json ...
[Plugin] API: Bookstore API v1.0.0
[Plugin] Converted 4 API endpoints to tools:
  - searchBooks (GET /books)
  - addBook (POST /books)
  - getBookDetail (GET /books/{bookId})
  - listCategories (GET /categories)

[User] Help me find AI-related books, and show me details of the highest rated one

--- Turn 1 ---
[Agent] Calling searchBooks({"category":"ai"})
[Plugin] GET http://localhost:3100/books?category=ai
[Agent] Result: [{"id":"book-2","title":"Deep Learning",...},{"id":"book-5","title":"Hands-On Machine Learning",...}]

--- Turn 2 ---
[Agent] Calling getBookDetail({"bookId":"book-2"})

--- Turn 3 ---
[Agent] Calling getBookDetail({"bookId":"book-5"})

[Agent] Final response:
Here are AI-related books I found:
- Deep Learning — Ian Goodfellow — $72
- Hands-On Machine Learning — Aurelien Geron — $59.99

Highest rated: Hands-On Machine Learning (4.7)
```

LLM 先搜索 AI 分类的书，发现两本，然后分别查看详情比较评分，最后给出完整的推荐。整个过程中，LLM 完全不知道 HTTP 请求是怎么发出去的，它只看到了 OpenAPI spec 转换出来的工具描述。

---

## 踩坑与最佳实践

### 1. operationId 和 description 是灵魂

和 Function Calling 一样，LLM 选择调用哪个 API、传什么参数，完全依赖文本描述。一个好的 `operationId` 应该是动词 + 名词（`searchBooks`、`getBookDetail`），而不是含糊的 `getData`。`description` 要写清楚这个端点做什么、参数怎么用，最好给个 `example`。

### 2. 参数路由是 Plugin 实现的难点

OpenAPI spec 里的参数分散在三个位置：path 参数（`/books/{bookId}`）、query 参数（`?q=xxx`）、body 参数。Plugin 运行时需要正确地把 LLM 返回的扁平参数路由到对应位置。我们的 `executeAPICall` 函数就是在做这件事。如果路由出错，API 会收到错误的请求格式。

### 3. 认证是绕不开的问题

我们的示例没有加认证，实际场景中几乎所有 API 都需要。GPT Actions 支持两种认证：

- **API Key**：最简单，Plugin 系统在请求头里加上 `Authorization: Bearer xxx`
- **OAuth**：更安全，支持完整的 OAuth 2.0 流程，ChatGPT 会生成一个回调 URL 来处理授权码

无论哪种，认证信息都不应该暴露给 LLM，而是由 Plugin 运行时在 HTTP 层面注入。

### 4. 不是所有 API 都适合 Plugin 化

Plugin 最适合"查询型"和"简单操作型" API：搜索、获取详情、创建记录。对于需要复杂状态管理、多步事务、实时订阅的场景，Plugin 的"一次 HTTP 请求一个结果"模型会比较吃力。这时候可能 MCP 更合适，因为 MCP 支持有状态连接和自定义传输。

### 5. OpenAPI spec 的质量直接决定 Plugin 效果

spec 越详细，LLM 调用越准确。具体来说：

- 每个参数都要有 `description`
- 枚举值用 `enum` 明确列出（而不是在描述里写"可选值有..."）
- 响应 schema 要完整，LLM 能更好地理解返回数据的结构
- `example` 字段很有用，它给 LLM 提供了参数格式的具体示例

---

## 小结

- **OpenAPI 规范是 Plugin 的基础**：一份结构化的 API 文档，既是给人看的接口说明，也是给 LLM 读的工具定义源，`operationId` → 函数名，`parameters` → 参数 schema，转换几乎是零成本
- **Plugin 的核心链路只有三步**：获取 spec → 转换为 Function Calling 工具 → LLM 调用 + HTTP 执行，现有 REST API 不需要改一行代码就能接入 AI
- **Plugin 和 MCP 是互补关系**：Plugin 适合"已有 REST API，快速接入"的场景；MCP 适合"从头构建 AI 原生工具"的场景，两者各有优势，下一篇会详细对比

---

**下一篇**：Agent Skills：用自然语言给 Agent 注入专业能力

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 12 篇*

---

**说到把现有服务接入 AI，我平时也在用 Claude、GPT、Gemini 折腾各种集成玩法，Plugin、MCP、Function Calling 都有在实际项目里用。如果你也在琢磨怎么把自己的 API 和 AI 打通，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
