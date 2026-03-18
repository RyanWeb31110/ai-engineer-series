# MCP 协议：工具集成的统一标准

> 一个协议统一所有工具接入，AI 领域的 USB-C 时刻

---

上一篇我们用 Mastra 框架搭建了 Agent，工具定义在代码里，Agent 调用时直接执行。这套方式能跑，但当你想接入更多外部服务时，一个尴尬的问题出现了：**每接一个新服务，就要写一套工具定义、鉴权逻辑、错误处理。接 10 个服务，写 10 遍。换个 Agent 框架，再写 10 遍。**

GitHub 要写一套，Slack 要写一套，数据库要写一套。每个 AI 应用都在重复造轮子，每个工具提供方都在为不同的 AI 平台做适配。

**MCP（Model Context Protocol）** 就是来解决这个问题的。它是 Anthropic 在 2024 年 11 月发布的开放协议标准，一句话概括：**让 AI 应用和外部工具之间有一个统一的对话方式。**

---

## 从 Function Calling 到 MCP：为什么需要一个协议

先回顾一下我们到目前为止的工具集成方式。

第 04 章的 Function Calling，工具定义是写死在代码里的：

```typescript
// 第 04 章的做法：工具定义硬编码在 API 调用中
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
      },
    },
  },
]

const response = await client.chat.completions.create({
  model: 'gpt-5.2-codex',
  tools,          // 每次调用都要传完整的工具定义
  messages,
})
```

第 09 章的 Mastra 框架改善了写法（用 Zod 替代 JSON Schema），但本质没变：**工具定义和执行逻辑紧耦合在 Agent 代码里**。

这种方式在工具少的时候没问题，但当你试图构建一个"能操作 GitHub、读 Notion 文档、查 Slack 消息、执行 SQL"的 Agent 时，问题就暴露了：

**问题一：集成成本爆炸**

每个外部服务都有自己的 API 格式、鉴权方式、错误码。你要为 GitHub 写一套 OAuth + REST 调用逻辑，为 Slack 写另一套，为数据库写又一套。如果你有 N 个 AI 应用和 M 个工具，需要 N × M 个集成适配。

**问题二：工具定义膨胀上下文**

Function Calling 要求每次 API 调用都把所有工具的 schema 传进去。10 个工具还好，50 个工具的 schema 就要占掉几千个 Token，直接挤压留给真正内容的 Context 空间。

**问题三：厂商锁定**

OpenAI 的 Function Calling 格式和 Anthropic 的 Tool Use 格式不一样。你为 OpenAI 写的工具定义，切换到 Claude 要改一遍。

MCP 的思路是：**不要让每个 AI 应用自己去对接每个工具，而是定义一个标准协议，让工具方实现一次，所有 AI 应用都能用。**

这和 **LSP（Language Server Protocol）** 的思路完全一样。在 LSP 出现之前，每个编辑器（VS Code、Vim、Emacs）要为每种编程语言单独写语法分析、自动补全、跳转定义的逻辑。LSP 定义了标准协议后，语言方实现一个 Language Server，所有编辑器都能用。MCP 就是 AI 工具领域的 LSP。

更直观的类比：**MCP 是 AI 的 USB-C 接口**。在 USB-C 之前，每个设备都有自己的充电口和数据线。USB-C 统一了接口标准，任何设备都能用同一根线。MCP 统一了 AI 工具接入的标准，任何 AI 应用都能用同一种方式连接任何工具。

---

## MCP 的架构：Host、Client、Server

MCP 采用三层架构，理解这三个角色是掌握 MCP 的关键：

```
┌──────────────────────────────────────────────┐
│               Host（宿主应用）                  │
│   例如：Claude Desktop / Cursor / 你的 Agent   │
│                                                │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │ Client A │  │ Client B │  │ Client C │   │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└────────┼─────────────┼─────────────┼──────────┘
         │             │             │
    ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
    │ Server A │  │ Server B │  │ Server C │
    │ (GitHub) │  │ (Slack)  │  │ (数据库)  │
    └──────────┘  └──────────┘  └──────────┘
```

### Host：宿主应用

Host 是用户直接交互的 AI 应用，比如 Claude Desktop、Cursor、或者你自己写的 Agent 应用。Host 负责管理多个 Client 实例、控制安全策略、聚合来自不同 Server 的信息。

用操作系统来类比：Host 就是操作系统，管理所有的 USB 端口。

### Client：协议客户端

Client 是 Host 内部的轻量级组件，每个 Client 和一个 Server 保持一对一的连接。它负责协议层面的事情：连接建立、能力协商、消息路由。

类比：Client 是 USB 控制器芯片，处理通信协议细节。

### Server：工具服务端

Server 是实际暴露工具能力的一方。一个 MCP Server 可以提供工具（Tools）、资源（Resources）、提示模板（Prompts）。Server 可以是本地进程（通过 stdio 通信），也可以是远程服务（通过 HTTP 通信）。

类比：Server 是你插上去的 USB 设备，U 盘、打印机、键盘，每个设备提供不同的能力。

### 关键设计原则

MCP 有几个设计原则值得注意：

1. **Server 必须极其容易构建**：复杂的编排逻辑交给 Host，Server 只需要关注自己提供什么能力
2. **Server 高度可组合**：每个 Server 专注一件事，多个 Server 组合使用
3. **Server 之间严格隔离**：Server A 看不到 Server B 的存在，也看不到完整的对话历史
4. **渐进式特性扩展**：通过连接时的能力协商（Capability Negotiation），按需启用功能

这些原则直接决定了 MCP 的生态爆发力：因为写一个 Server 足够简单，所以社区在一年多时间里就产出了超过 10000 个公开的 MCP Server。

---

## MCP 的三大核心原语

MCP 协议定义了三个 Server 端核心原语（Primitives），分别解决不同的问题：

### Tools：让 LLM 执行操作

**Tools** 是最核心的原语，对应 Function Calling 里的 function。区别在于：工具的定义和执行逻辑在 Server 端，LLM 通过协议远程调用。

```typescript
// MCP Server 端注册一个工具
server.registerTool(
  'get_weather',
  {
    description: '查询指定城市的当前天气',
    inputSchema: z.object({
      city: z.string().describe('城市名称'),
    }),
  },
  async ({ city }) => {
    const data = await fetchWeatherAPI(city)
    return {
      content: [{ type: 'text', text: `${city}: ${data.temp}°C, ${data.condition}` }],
    }
  }
)
```

LLM 通过 MCP Client 发现并调用这个工具，整个过程：

```
LLM 发起请求 → MCP Client 转发 → MCP Server 执行 → 结果返回 → LLM 继续推理
```

和 Function Calling 最大的区别是：**工具的定义、实现、运行都在 Server 端，LLM 只需要知道工具的名称、描述和参数格式。** Server 可以是别人写好的，你不需要关心内部实现。

控制方是 **LLM**：模型自主决定什么时候调用什么工具。

### Resources：给 LLM 提供上下文数据

**Resources** 是只读的数据源，通过 URI 标识。比如项目文件、数据库 Schema、API 文档等。

```typescript
// MCP Server 端注册一个资源
server.resource(
  'project-readme',
  'file:///project/README.md',
  { description: '项目 README 文件', mimeType: 'text/markdown' },
  async () => ({
    contents: [{
      uri: 'file:///project/README.md',
      mimeType: 'text/markdown',
      text: await readFile('/project/README.md', 'utf-8'),
    }],
  })
)
```

Resources 和 Tools 的本质区别：**Tools 是"做事"的（写文件、发消息、执行查询），Resources 是"读数据"的（提供上下文信息）**。这个区分很重要，因为 Tools 可能有副作用（修改数据库、发送消息），Resources 是安全的只读操作。

控制方是**应用程序**：由 Host 或用户决定加载哪些资源，类似于用户选择附件。

### Prompts：可复用的提示模板

**Prompts** 是 Server 预定义的提示模板，支持参数化。比如一个"代码审查"模板：

```typescript
server.prompt(
  'code-review',
  { description: '审查代码的提示模板' },
  ({ code, language }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `请审查以下 ${language} 代码，关注安全性、性能和可读性：\n\n${code}`,
      },
    }],
  })
)
```

控制方是**用户**：用户主动选择使用哪个提示模板，类似于 IDE 里的代码片段（Snippets）。

### 三大原语的控制方对比

| 原语 | 谁控制 | 类比 |
|------|--------|------|
| Tools | LLM 决定调用 | HTTP POST（执行操作） |
| Resources | 应用 / 用户选择加载 | HTTP GET（读取数据） |
| Prompts | 用户选择使用 | 快捷指令 / 代码片段 |

---

## 传输层：stdio 和 Streamable HTTP

MCP 是协议层的标准，具体的数据怎么在 Client 和 Server 之间传输，有两种方式。

### stdio：本地开发首选

Client 把 Server 作为子进程启动，通过进程的标准输入（stdin）/ 标准输出（stdout）通信：

```
Client  ─── stdin ──→  Server（子进程）
Client  ←── stdout ──  Server（子进程）
```

零网络开销，延迟极低。缺点是只能在本地用，不支持多客户端同时连接。

这是目前最常见的使用方式。在 Claude Desktop 里配置一个 MCP Server：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
    }
  }
}
```

Claude Desktop 会自动启动这个子进程，通过 stdio 和它通信。

### Streamable HTTP：生产环境首选

2025 年 3 月引入，替代了早期的 HTTP+SSE 方案。Client 和 Server 通过一个 HTTP 端点通信：

```
Client  ─── HTTP POST ──→  Server（独立服务）
Client  ←── JSON / SSE ───  Server（独立服务）
```

支持远程部署、多客户端连接、TLS 加密、OAuth 鉴权。适合云服务和企业场景。

### 怎么选

简单粗暴的判断标准：

- **开发阶段 / 本地工具**：用 stdio，配置简单，零网络开销
- **生产部署 / 远程服务 / 多用户**：用 Streamable HTTP，完整的 Web 特性支持

---

## MCP 与 Function Calling 的深度对比

这是开发者最常问的问题：**MCP 和 Function Calling 是什么关系？MCP 会取代 Function Calling 吗？**

答案是：**不会。两者解决不同层面的问题，是互补关系。**

| 维度 | Function Calling | MCP |
|------|-----------------|-----|
| 解决什么 | LLM 识别意图、结构化参数 | 工具的发现、连接、安全执行 |
| 架构 | 紧耦合，工具定义在 API 调用里 | 松耦合，Client-Server 分离 |
| 工具发现 | 静态，必须预先传入 schema | 动态，运行时自动发现 |
| 可移植性 | 厂商特定（OpenAI / Anthropic 各有格式） | 开放标准，模型无关 |
| 扩展性 | 工具多了 schema 膨胀上下文 | 按需加载，工具在独立 Server 中 |
| 最佳场景 | 少量工具（<10），快速原型 | 多工具、多模型、生产级 Agent |

用一个类比说清楚两者的关系：

**Function Calling 是"说话的能力"：** LLM 能理解"我需要查天气"并把它结构化成 `get_weather({ city: "北京" })`。这是 LLM 的推理能力，和模型强相关。

**MCP 是"电话网络"：** 定义了怎么拨号（发现工具）、怎么接通（建立连接）、怎么通话（传输数据）、怎么挂断（断开连接）。这是基础设施，和模型无关。

实际上，2026 年的主流做法是：**LLM 在内部使用 Function Calling 风格的推理来决定调用什么工具，但工具的实际执行通过 MCP 协议完成。** 框架（如 Mastra）在中间做了这层转换，开发者通常不需要手动处理。

---

## MCP 生态速览

MCP 发布一年多，生态增长惊人。截至 2026 年初，公开的 MCP Server 超过 10000 个。所有主流 AI 平台都已支持：

| 平台 | 支持时间 |
|------|----------|
| Claude Desktop | 2024.11（首发） |
| OpenAI ChatGPT | 2025.03 |
| Google Gemini | 2025.04 |
| Microsoft Copilot | 2025.03 |
| Cursor | 2025 初 |

几个最常用的 MCP Server：

- **Filesystem**：本地文件系统读写，最基础也最常用
- **GitHub**：仓库管理、PR、Issue、代码搜索
- **Brave Search**：免费 Web 搜索，开发者使用最多
- **Slack**：消息收发、频道管理
- **PostgreSQL / SQLite**：数据库查询
- **Puppeteer**：浏览器自动化

MCP Server 的生态目录可以在 [mcp.so](https://mcp.so) 浏览，按分类筛选。

2025 年 12 月，OpenAI、Google、Microsoft 等联合成立了 **AAIF（Agentic AI Foundation）**，在 Linux Foundation 下共同治理 MCP 协议。这意味着 MCP 已经从 Anthropic 的单方面项目，变成了行业共治的开放标准。

---

## 代码实战

`10-mcp-intro/src/` 目录下有两个文件，演示 MCP 的核心流程：Server 提供工具，Client 动态发现并调用。

**`mcp-server.ts`：MCP Server 端**

注册两个工具（天气查询 + 计算器），通过 stdio 提供服务：

```typescript
// mcp-server.ts 节选

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'demo-server',
  version: '1.0.0',
})

// 注册天气查询工具
server.registerTool(
  'get_weather',
  {
    title: 'Get Weather',
    description: 'Query current weather for a given city',
    inputSchema: z.object({
      city: z.string().describe('City name in English'),
    }),
  },
  async ({ city }) => {
    const data = WEATHER_DATA[city]
    if (!data) {
      return {
        content: [{ type: 'text' as const, text: `No weather data available for "${city}"` }],
      }
    }
    return {
      content: [{ type: 'text' as const, text: `${city}: ${data.temp}C, ${data.condition}` }],
    }
  }
)

// 启动 stdio 传输
const transport = new StdioServerTransport()
await server.connect(transport)
```

注意几个关键点：

- `McpServer` 是高层封装，帮你处理了 JSON-RPC 协议细节
- `registerTool` 用 Zod 定义输入参数，运行时自动验证
- `StdioServerTransport` 通过 stdin/stdout 通信，日志必须输出到 stderr

**`mcp-client.ts`：MCP Client 端**

连接 Server，动态发现工具，然后调用：

```typescript
// mcp-client.ts 节选

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'demo-client', version: '1.0.0' })

// 通过 stdio 连接到 Server（将 Server 作为子进程启动）
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', serverPath],
})
await client.connect(transport)

// 动态发现可用工具（不需要预先知道有哪些工具）
const { tools } = await client.listTools()
console.log(`Found ${tools.length} tool(s):`)
for (const tool of tools) {
  console.log(`  - ${tool.name}: ${tool.description}`)
}

// 调用工具
const result = await client.callTool({
  name: 'get_weather',
  arguments: { city: 'Beijing' },
})
```

运行配套代码：

```bash
cd 10-mcp-intro && pnpm client
```

输出：

```
=== MCP Client Demo ===

[Step 1] Connecting to MCP Server...
[Step 1] Connected!

[Step 2] Discovering available tools...
[Step 2] Found 2 tool(s):
  - get_weather: Query current weather for a given city
  - calculate: Evaluate a mathematical expression and return the result

[Step 3] Calling get_weather({ city: "Beijing" })...
[Step 3] Result: Beijing: 22C, Sunny, humidity 35%

[Step 5] Calling calculate({ expression: "299 * 12 * 0.85" })...
[Step 5] Result: 299 * 12 * 0.85 = 3049.8
```

整个过程：Client 启动 Server 子进程 → 通过 stdio 协商能力 → `listTools()` 动态发现工具 → `callTool()` 调用 → Server 执行并返回结果。

和 Function Calling 对比一下关键差异：**你不需要预先把工具的 JSON Schema 传给 LLM，Client 通过 `listTools()` 在运行时自动发现 Server 提供了什么工具。** 这就是"动态发现"的含义，也是 MCP 能支撑大规模工具生态的基础。

下一篇会在这个基础上构建更完整的 MCP Server，加入 Resource 注册、与 LLM 集成的完整 Agent 等工程实践。

---

## 踩坑与最佳实践

### 1. MCP 不是万能的，小项目别过度设计

如果你的 Agent 只需要 3~5 个简单工具，直接用 Function Calling 或框架内置的工具定义就够了。引入 MCP 意味着多一层进程间通信和协议处理，对简单场景是不必要的复杂度。

判断标准：当你发现自己在多个项目里复制粘贴同样的工具代码，或者需要接入超过 10 个外部服务，MCP 的价值就体现出来了。

### 2. Server 的 stdout 只能用于协议消息

这是新手最常踩的坑。stdio 传输模式下，Server 的 stdout 是 MCP 协议的通信通道。如果你在代码里用了 `console.log()`，输出会混入协议消息流，导致解析失败。

正确做法：**所有日志输出到 stderr**（用 `console.error()`），或者写入日志文件。

### 3. 安全边界要明确

MCP Server 运行在你的机器上，有执行代码和访问文件系统的能力。使用第三方 MCP Server 时，要注意：

- 审查 Server 的源码，确认它只做它声称要做的事
- 利用 Roots 机制限制 Server 的文件访问范围
- 生产环境优先使用 Streamable HTTP + OAuth，而不是 stdio

### 4. Function Calling 和 MCP 不是二选一

很多人纠结"该用 Function Calling 还是 MCP"。正确的理解是：Function Calling 是 LLM 的能力，MCP 是工具集成的协议，两者在不同层面工作。

当你用 Mastra 的 `createTool` 定义一个工具时，框架在底层用 Function Calling 让 LLM 识别意图和参数；当你配置一个 MCP Server 时，框架通过 MCP 协议发现和调用工具。上层的开发者体验可能差不多，但底层架构不同。

### 5. 关注协议版本兼容

MCP 协议还在快速演进中。2025 年 3 月引入了 Streamable HTTP，2025 年 6 月加了结构化输出和 Elicitation，2025 年 11 月又加了实验性的 Tasks 原语。使用 SDK 时注意版本匹配，Client 和 Server 的协议版本需要通过初始化阶段的能力协商来对齐。

---

## 小结

- **MCP 是 AI 工具集成的统一标准**，解决了 N 个 AI 应用 × M 个工具 = N×M 个适配的碎片化问题，工具方实现一次 MCP Server，所有 AI 应用都能用
- **三层架构 Host / Client / Server**，三大原语 Tools / Resources / Prompts，分别解决"执行操作""提供数据""模板化指令"三类需求
- **MCP 和 Function Calling 是互补关系**：Function Calling 负责 LLM 的意图识别和参数结构化，MCP 负责工具的标准化发现、连接和执行

理解了 MCP 的架构和设计理念之后，下一步就是动手写一个完整的 MCP Server，在实践中体会协议的每一层是怎么工作的。

---

**下一篇**：动手写一个 MCP Server

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 10 篇*
