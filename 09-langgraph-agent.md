# Agent 框架实战：从手写循环到 Mastra

> 手写 ReAct 循环让你理解原理，用框架让你交付产品

---

上一篇我们手写了一个完整的 ReAct 循环：管理 messages 数组、解析 tool_calls、回填结果、控制循环终止。跑起来效果不错，但你可能已经意识到一个问题：**真正的 Agent 远不止一个 while 循环。**

当你开始处理真实业务时，问题接踵而来：工具执行失败了怎么重试？多个步骤需要并行跑怎么办？某些步骤需要人工审批才能继续怎么处理？Agent 跑了一半服务器重启了，状态怎么恢复？

这些问题都不是改几行代码能解决的，它们需要**状态管理**、**流程编排**、**错误恢复**这些工程化能力。这就是 Agent 框架存在的意义。

---

## 为什么需要框架

先看一张表，对比手写 ReAct 循环和用框架的区别：

| 能力 | 手写 ReAct | 框架 |
|------|-----------|------|
| 基本 ReAct 循环 | 自己写 while + tool_calls 解析 | 内置，声明式配置 |
| 工具定义 | 手写 JSON Schema | Zod Schema，自动验证 |
| 条件分支 | if/else 硬编码在循环里 | 图/流程编排，声明式定义 |
| 并行执行 | 手动 Promise.all | 内置 parallel 原语 |
| 错误重试 | 自己 try/catch + 重试逻辑 | 内置重试策略 |
| 状态持久化 | 无 | 检查点机制，可恢复 |
| 人工审批 | 无 | Human-in-the-loop 支持 |
| 可观测性 | console.log | 内置追踪 + 可视化 |

手写循环适合学习和理解原理，但一旦进入生产环境，框架能帮你省掉大量的重复工作。

---

## 两大主流框架

2026 年的 TypeScript Agent 框架赛道，有两个最值得关注的选择：

**LangGraph.js** 来自 LangChain 团队，把一切建模为"图"：节点是计算单元，边是控制流，条件边实现分支路由。它的核心优势是**精细控制**，你可以精确定义 Agent 每一步的行为，适合构建复杂的多步推理系统。但代价是学习曲线较陡，你需要理解 StateGraph、Annotation、Reducer 等图计算概念。

**Mastra** 来自 Gatsby 团队（Y Combinator 支持），定位是 TypeScript 原生的 AI Agent 框架。它的设计哲学更接近 **Next.js**：约定优于配置，开箱即用。Agent 和 Workflow 是两个独立的一等公民，Agent 负责开放式推理（LLM 自主决策），Workflow 负责确定性编排（开发者完全控制流程）。

本篇选择 Mastra 作为实战框架，原因有三：

1. **TypeScript 原生**：不是从 Python 移植的，API 设计贴合 TypeScript 开发者的习惯
2. **上手快**：声明式的 Agent 和 Workflow API，不需要先理解图论概念
3. **内置能力齐全**：工具、记忆、RAG、评估、可视化 Playground 全都内置，不需要拼凑

下面用代码说话。

---

## 用 Mastra 创建 Agent

还记得第 08 章手写 ReAct 循环的代码吗？一个完整的 `reactLoop` 函数大约 60 行：管理 messages 数组、创建 API 调用、解析 tool_calls、分发工具执行、回填结果、控制循环。

用 Mastra，同样的效果只需要声明三样东西：instructions、model、tools。

### 工具定义：从 JSON Schema 到 Zod

先看工具定义的变化。第 08 章手写的天气查询工具：

```typescript
// 手写方式：OpenAI JSON Schema 格式
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
```

Mastra 用 `createTool` + Zod Schema：

```typescript
// Mastra 方式：Zod Schema，自动验证输入输出
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
```

几个明显的改进：

- **输入验证自动化**：Zod 在运行时会校验 LLM 传入的参数类型，不用手动检查
- **输出类型安全**：`outputSchema` 让框架知道工具返回什么，方便后续流程处理
- **工具逻辑内聚**：定义和执行写在一起，不像手写方式需要一个 `dispatchTool` 函数做路由

### 创建 Agent：声明式配置

工具定义好了，创建 Agent 只需要几行：

```typescript
const agent = new Agent({
  id: 'smart-assistant',
  name: 'Smart Assistant',
  instructions: `你是一个善于推理的智能助手。
你在回答问题时，遵循 ReAct 思维模式：先思考，再行动，然后根据观察结果继续推理。`,
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
```

`model` 配置里的 `custom/` 前缀告诉 Mastra 使用自定义 provider，`url` 指向你的 API 端点。Mastra 内置了模型路由器，支持 OpenAI、Anthropic、Google 等主流 provider，也支持任何 OpenAI 兼容的中转站。

### 运行 Agent

```typescript
const response = await agent.generate('专业版套餐年付的话一年多少钱？', {
  maxSteps: 8,
})
console.log(response.text)
```

一行 `generate()` 搞定。框架内部自动处理了整个 ReAct 循环：发送请求 → 检查 tool_calls → 执行工具 → 回填结果 → 继续推理 → 直到得出最终答案。

`maxSteps` 相当于手写循环里的 `MAX_STEPS`，控制最大循环次数，防止 Agent 陷入死循环。

运行配套代码：

```bash
cd 09-langgraph-agent && pnpm agent
```

你会看到和第 08 章一模一样的三个场景（简单查询、多步推理、多工具协作），但背后的代码量减少了一半以上。

---

## Agent vs Workflow：两种编排模式

到这里你可能会问：框架不就是帮我省了写循环的代码吗？仅此而已？

不止。框架真正的价值在于提供了**两种不同的编排模式**，让你根据场景选择最合适的方式。

### Agent 模式：LLM 自主决策

Agent 模式就是我们上面看到的：你给 Agent 一组工具和一个问题，LLM 自己决定调哪个工具、调几次、什么顺序。这适合**开放式问题**，比如"帮我规划一下明天的行程"，你没法预知 LLM 需要查多少信息、做多少次计算。

### Workflow 模式：开发者控制流程

但很多业务场景是**确定性的**：步骤固定、顺序明确、分支条件可预知。比如"先查天气，如果温度低于 15 度就推荐带厚外套，否则推荐带薄外套，最后生成报告"。这种场景用 Agent 模式会有问题：LLM 可能跳过某个步骤，或者按错误的顺序执行。

Mastra 的 Workflow 就是为这种场景设计的。看一个"出差规划"的例子：

```typescript
const fetchWeatherStep = createStep({
  id: 'fetch-weather',
  inputSchema: z.object({
    city: z.string(),
    days: z.number(),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
  }),
  execute: async ({ inputData }) => {
    const data = WEATHER_DATA[inputData.city] ?? { temp: 15, condition: '晴', humidity: 50 }
    return {
      city: inputData.city,
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
    }
  },
})
```

每个 Step 用 Zod 定义输入和输出的数据结构，`execute` 是具体的执行逻辑。Step 之间通过数据流自动串联：上一个 Step 的 `outputSchema` 就是下一个 Step 的 `inputSchema`。

然后用 `.then()` 和 `.branch()` 把 Step 组装成 Workflow：

```typescript
const tripPlanningWorkflow = createWorkflow({
  id: 'trip-planning',
  inputSchema: z.object({ city: z.string(), days: z.number() }),
  outputSchema: z.object({ report: z.string() }),
})
  .then(fetchWeatherStep)
  .branch([
    [async ({ inputData }) => inputData.temperature >= 15, goodWeatherStep],
    [async ({ inputData }) => inputData.temperature < 15, badWeatherStep],
  ])
  .then(generateReportStep)
  .commit()
```

这段代码定义了一个清晰的执行路径：

```
fetchWeather → branch → goodWeatherStep (temp >= 15)
                      → badWeatherStep  (temp < 15)
             → generateReport
```

运行时，输入 `{ city: '广州', days: 3 }` 走好天气分支，输入 `{ city: '北京', days: 3 }` 走坏天气分支。结果完全可预测，不依赖 LLM 的判断。

运行配套代码：

```bash
pnpm workflow
```

### 怎么选？

一句话总结：**结果不确定用 Agent，流程确定用 Workflow。**

| 场景 | 选择 | 原因 |
|------|------|------|
| 客服问答 | Agent | 用户问什么不可预知 |
| 数据处理流水线 | Workflow | 步骤固定，顺序明确 |
| 代码审查 | Agent | 审查什么、怎么审不确定 |
| 用户注册流程 | Workflow | 验证 → 创建账号 → 发邮件，步骤固定 |
| 研究助手 | Agent | 搜索什么、搜几次不确定 |
| 内容发布流水线 | Workflow | 审核 → 排版 → 发布，顺序确定 |

实际项目中，两种模式经常混合使用：Workflow 的某个 Step 内部调用 Agent 做开放式推理，Agent 的某个工具内部跑一个 Workflow 做确定性流程。

---

## LangGraph 长什么样

虽然本篇选了 Mastra 实战，但 LangGraph 作为另一个主流选择，值得了解它的思路。

LangGraph 把一切建模为**图（Graph）**：

```typescript
// LangGraph 风格（伪代码，展示思路）
const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)        // 节点：调用 LLM
  .addNode("tools", new ToolNode(tools))  // 节点：执行工具
  .addEdge(START, "agent")             // 入口 → agent
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",                    // 有 tool_calls → 去 tools 节点
    [END]: END,                        // 没有 → 结束
  })
  .addEdge("tools", "agent")          // tools → agent（形成循环）

const app = workflow.compile()
```

你会发现，这段代码其实就是第 08 章 ReAct 循环的"图表示"：agent 节点调 LLM，如果有 tool_calls 就转到 tools 节点执行，执行完回到 agent 节点继续推理，直到没有 tool_calls 才结束。

LangGraph 的核心概念是 **Annotation + Reducer**：定义状态的数据结构和合并策略。当多个并行节点同时更新状态时，Reducer 决定怎么合并。这在构建复杂的多 Agent 系统时非常有用，但对简单场景来说，心智负担偏重。

两个框架的选型建议：

- **选 LangGraph**：需要精细控制 Agent 每一步行为、构建复杂的多步推理循环、已经在用 LangChain 技术栈
- **选 Mastra**：TypeScript 全栈团队、重视开发速度、需要内置的 RAG/记忆/评估/Playground

---

## 踩坑与最佳实践

### 1. 框架不是银弹，先理解原理再用框架

如果你直接跳过第 04 章的 Function Calling 和第 08 章的 ReAct，直接用框架搭 Agent，你会发现出了问题不知道怎么调试。框架封装了 ReAct 循环的细节，但你需要知道 `agent.generate()` 背后发生了什么：构造 messages、发起 API 调用、解析 tool_calls、回填结果、循环直到终止。

建议：至少手写一次完整的 ReAct 循环（第 08 章已经做了），再切换到框架。

### 2. maxSteps 不要设太大

`maxSteps`（或 LangGraph 里的 `recursion_limit`）控制 Agent 的最大循环次数。设太大的风险是：如果 LLM 陷入"工具调用死循环"（反复调同一个工具但拿不到想要的结果），会白白消耗大量 Token。

实践：简单任务 3~5 步，复杂任务 8~10 步，极少需要超过 15 步。如果你的 Agent 经常跑满 maxSteps 还没给出答案，说明 Prompt 或工具设计有问题，而不是步数不够。

### 3. Workflow 的 Step 要保持单一职责

每个 Step 做且只做一件事。不要在一个 Step 里又查天气又算价格又生成报告。原因很简单：Step 粒度越细，错误定位越容易，重试也可以只重试失败的那一步。

### 4. 自定义 provider 的注意事项

Mastra 的 `model.id` 格式是 `provider/model-name`。用 `custom/` 前缀表示自定义 provider，框架会用你提供的 `url` 和 `apiKey` 发起请求。如果你的中转站有特殊的 header 要求，可以通过 `headers` 字段传入。

---

## 小结

- **框架解决的是工程化问题**：状态管理、流程编排、错误恢复、可观测性，这些手写 ReAct 循环做不了的事，是你从原型走向产品的关键
- **Agent 和 Workflow 是两种互补的编排模式**：Agent 让 LLM 自主决策适合开放式问题，Workflow 让开发者控制流程适合确定性任务，实际项目中经常混合使用
- **选框架看团队和场景**：Mastra 适合 TypeScript 全栈团队快速交付，LangGraph 适合需要精细控制的复杂 Agent 系统

理解了 Agent 框架的两种编排模式之后，下一步我们来看一个正在改变 AI 工具生态的协议：MCP。它让 Agent 能接入任何外部服务，而不需要为每个服务单独写工具定义。

---

**下一篇**：MCP 协议：工具集成的统一标准

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 09 篇*
