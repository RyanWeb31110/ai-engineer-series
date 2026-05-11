# MCP、Plugin、Skills：三种集成方式怎么选

> 同一个需求，三种实现路径，选错了不是不能用，而是多走弯路

---

过去三篇我们分别学了 MCP（注册工具 + 有状态连接）、Plugin（OpenAPI spec 自动转换）、Skills（自然语言注入专业能力）。三种方式都能让 Agent 变得更强，但它们解决的问题不同、适用的场景不同、付出的成本也不同。

这篇我们把三者放在一起，用同一个需求做横向对比，然后给出一套清晰的决策框架：什么时候该用哪个，什么时候该组合使用。

---

## 同一个需求，三种实现

为了让对比直观，我们用同一个需求来演示："查询北京和东京的天气，并给出北京未来 3 天的预报"。

### MCP 风格：注册工具 + JSON-RPC 调用

MCP 的核心是**工具注册**。你在 Server 端定义工具，Client 通过 JSON-RPC 协议发现和调用：

```typescript
// mcp-style.ts 节选

// MCP Server 注册的工具列表（模拟 tools/list 响应）
const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather information for a specified city',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Beijing", "Tokyo"' },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit, defaults to celsius',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'get_forecast',
    description: 'Get weather forecast for the next N days',
    inputSchema: { /* ... */ },
  },
]
```

运行时流程：Client 发现工具 → 转换为 LLM 工具格式 → LLM 选择调用 → Client 通过 JSON-RPC 发给 Server 执行 → 结果返回 LLM。

关键特征：**你从零构建工具**，完全控制工具的定义、执行逻辑和状态管理。

### Plugin 风格：OpenAPI spec 自动转换

Plugin 的核心是**已有 API 的零改造接入**。你不需要写新代码，只需要一份 OpenAPI spec：

```typescript
// plugin-style.ts 节选

// 模拟从 /openapi.json 获取的 spec
const API_OPERATIONS: OpenAPIOperation[] = [
  {
    operationId: 'getCurrentWeather',
    summary: 'Get current weather',
    description: 'Returns current weather data for a city.',
    method: 'GET',
    path: '/api/weather/current',
    parameters: [
      { name: 'city', in: 'query', required: true, description: 'City name', schema: { type: 'string' } },
      { name: 'unit', in: 'query', required: false, description: 'Temperature unit', schema: { type: 'string', enum: ['celsius', 'fahrenheit'] } },
    ],
  },
  // ...
]

// 自动转换为 Function Calling 工具
function specToTools(operations: OpenAPIOperation[]): ChatCompletionTool[] {
  return operations.map(op => ({
    type: 'function' as const,
    function: {
      name: op.operationId,
      description: `${op.summary}. ${op.description}`,
      parameters: { /* 从 spec 的 parameters 自动映射 */ },
    },
  }))
}
```

运行时流程：获取 spec → 自动转换为工具 → LLM 选择调用 → Plugin 运行时构造 HTTP 请求 → API 响应返回 LLM。

关键特征：**你已经有 REST API**，Plugin 只是在 LLM 和 API 之间加了一层自动转换。

### Skill 风格：纯提示词注入

Skill 的核心是**改变 Agent 的思维方式**，不调用任何外部服务：

```typescript
// skill-style.ts 节选

const weatherAnalystSkill: Skill = {
  name: 'Weather Analyst',
  description: 'Analyzes weather conditions and provides professional meteorological advice',
  instruction: `You are a professional meteorologist and weather analyst. When users ask about weather-related topics, you:

1. Provide detailed analysis of weather patterns and conditions
2. Explain the meteorological factors behind weather phenomena
3. Give practical advice based on weather conditions
4. Assess weather risks and provide safety recommendations

When you don't have real-time data, clearly state that your analysis is based on typical seasonal patterns and historical averages.`,
  outputFormat: `Structure your response as:
**Current Assessment**: Brief overview of typical conditions
**Analysis**: Meteorological explanation
**Practical Advice**: What to wear, what to avoid
**Risk Level**: Low / Medium / High with explanation`,
}
```

运行时流程：编译 Skill 为 system prompt → 单次 LLM 调用 → 直接输出结果。

关键特征：**没有外部数据源**，Agent 基于训练知识和注入的专业框架来回答。

---

## 核心差异对比

| 维度 | MCP | Plugin | Skill |
|------|-----|--------|-------|
| 本质 | 工具协议 | API 适配层 | 提示词模块 |
| 数据来源 | 实时（工具执行） | 实时（HTTP 调用） | 模型知识（非实时） |
| 改造成本 | 从零构建 Server | 零改造（需有 spec） | 零改造（写提示词） |
| 连接模式 | 有状态（会话保持） | 无状态（请求/响应） | 无连接 |
| 适合谁写 | 工具开发者 | API 提供方 | 领域专家 / PM |
| 运行时开销 | Server 进程 + 通信 | HTTP 请求 | 无额外开销 |
| 能力边界 | 能执行任何操作 | 能调用 REST API | 只能"想"，不能"做" |

一句话总结：

- **MCP**：给 Agent 装"手脚"，让它能操作外部系统
- **Plugin**：给 Agent 开"窗户"，让它能看到已有 API 的数据
- **Skill**：给 Agent 换"大脑"，让它用专家的方式思考

---

## 决策框架

选型不需要纠结，按这个决策树走：

```
需求是否需要外部数据或执行操作？
├── 否 → Skill（纯知识/推理/格式化任务）
└── 是 → 你已经有 REST API 吗？
    ├── 是 → Plugin（零改造接入）
    │   └── 还需要领域专业知识？→ Plugin + Skill
    └── 否 → 需要有状态连接吗？
        ├── 是 → MCP（会话、流式、订阅）
        │   └── 还需要领域专业知识？→ MCP + Skill
        └── 否 → MCP（新建工具最灵活）
```

我们用代码实现了这个决策树，让 LLM 自动分析需求并给出推荐：

```typescript
// decision-tree.ts 节选

const DECISION_SYSTEM_PROMPT = `You are an AI integration architect...

## Decision Criteria (in priority order)
1. Does it need external data or actions? No → Skill. Yes → continue.
2. Do you already have a REST API? Yes → Plugin. No → continue.
3. Do you need stateful connections? Yes → MCP. No → Plugin might still work.
4. Does it also need domain expertise? Yes → add Skill as complement.`

async function analyzeRequirement(requirement: string): Promise<DecisionResult> {
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    messages: [
      { role: 'system', content: DECISION_SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this requirement:\n\n${requirement}` },
    ],
    tools: [decisionTool],
    tool_choice: 'required',
  })
  // ...
}
```

运行 `pnpm decision-tree`，四个典型场景的推荐结果：

| 场景 | 推荐 | 原因 |
|------|------|------|
| Code Review 助手 | **Skill** | 不需要外部数据，纯推理任务 |
| 电商产品搜索 | **Plugin** | 已有 REST API，标准 CRUD |
| IDE 数据库探索器 | **MCP** | 需要有状态连接、Schema 探索 |
| 客服 + 知识库 | **Plugin + Skill** | 需要 API 数据 + 专业话术 |

---

## 组合使用：1 + 1 > 2

实际项目中，三种方式经常组合使用。最常见的两种组合：

### MCP + Skill

场景：数据库查询助手。MCP 提供数据库连接和查询执行能力，Skill 注入 SQL 优化专家的知识。

```
Agent = MCP（连接数据库、执行 SQL）+ Skill（SQL 优化专家）
```

Agent 不仅能查数据库，还知道怎么写出高性能的 SQL。没有 Skill，Agent 可能写出能跑但很慢的查询；没有 MCP，Agent 只能纸上谈兵。

### Plugin + Skill

场景：智能客服。Plugin 接入工单系统的 REST API，Skill 注入公司的服务话术和排障流程。

```
Agent = Plugin（查工单、更新状态）+ Skill（客服专家 + 排障流程）
```

Agent 既能操作工单系统，又能用专业的方式和客户沟通。单用 Plugin，Agent 能查数据但回复生硬；单用 Skill，Agent 说话好听但拿不到数据。

---

## 踩坑与最佳实践

### 1. 不要用 MCP 做 Plugin 能做的事

如果你已经有一套 REST API，不要为了"用 MCP"而把它重写成 MCP Server。Plugin 的零改造接入就是为这个场景设计的。MCP 的价值在于有状态连接和从零构建，不在于替代 HTTP。

### 2. Skill 不是万能的

Skill 的局限很明确：它不能获取实时数据，不能执行操作。如果用户问"今天北京天气怎么样"，Skill 只能给出基于历史数据的分析，不能给出今天的实际温度。需要实时数据就必须上 MCP 或 Plugin。

### 3. 组合时注意 Token 预算

MCP + Skill 或 Plugin + Skill 的组合意味着 system prompt 会更长（Skill 的指令 + 工具定义都占 Token）。如果工具很多（比如 20+ 个 API 端点），再加上一个详细的 Skill 指令，可能会挤占用户消息和上下文的空间。解决办法：精简 Skill 指令，或者动态加载（只在需要时注入）。

### 4. Plugin 的 spec 质量决定效果

Plugin 效果好不好，90% 取决于 OpenAPI spec 写得好不好。`operationId` 要语义清晰，`description` 要详细，参数要有 `example`。一份烂 spec 接入 AI 的效果，不如一个好 Skill 直接回答。

### 5. MCP 的运维成本不能忽视

MCP Server 是一个独立进程，需要部署、监控、维护。对于简单场景（比如只是查个天气），这个运维成本不值得。MCP 的价值在复杂场景才能体现：数据库连接池管理、文件系统监听、IDE 集成等。

---

## 小结

- **选型第一问：需不需要外部数据？** 不需要就用 Skill，需要就在 Plugin（已有 API）和 MCP（新建工具 / 有状态）之间选
- **三者是互补关系，不是替代关系**：MCP 给 Agent 执行能力，Plugin 给 Agent 数据访问，Skill 给 Agent 专业知识，组合使用效果最好
- **选型的核心原则是"最小成本"**：能用 Skill 解决的不上 Plugin，能用 Plugin 解决的不上 MCP，避免过度工程化

理清了这三种方式的边界，你在设计 AI 应用架构时就不会纠结"该用哪个"了。下一篇我们进入多 Agent 协作的世界。

---

**下一篇**：A2A：让多个 Agent 组成团队

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 14 篇*

---

**这篇讲的是"怎么选"，但选完之后还得落地。我平时在实际项目里 MCP、Plugin、Skill 三种都在用，也踩了不少坑。如果你也在做 AI 集成相关的事情，欢迎加我交流，不管你主力用 Claude、GPT 还是 Gemini，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
