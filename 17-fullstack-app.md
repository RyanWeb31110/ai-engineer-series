# 用 Next.js + Vercel AI SDK 搭一个 AI 应用

> 从零到一，把 LLM 能力接进真实的 Web 应用

---

前面十几篇，我们一直在用 TypeScript 脚本跑示例：调 API、测工具、验证流程。但真实的 AI 应用不是脚本，它需要一个 Web 界面、流式输出、状态管理，还要处理工具调用的 UI 展示。

这篇我们换个姿势，用 **Next.js 15** + **Vercel AI SDK** 搭一个完整的 AI 聊天应用，带流式输出和工具调用。代码可以直接跑，也可以作为你自己项目的起点。

---

## 为什么用 Vercel AI SDK

直接用 OpenAI SDK 当然可以，但你会遇到几个麻烦：

**流式输出要自己处理**。OpenAI SDK 返回的是 `AsyncIterable`，你需要自己写 SSE（Server-Sent Events）逻辑，把数据推给前端，前端再解析、更新状态。

**工具调用的 UI 状态要自己管**。工具调用有"调用中"和"已完成"两个状态，如果要在 UI 里展示进度，需要自己维护这套状态机。

**多轮对话的消息格式要自己转换**。前端的消息格式和 OpenAI API 要求的格式不一样，每次请求都要手动转换。

**Vercel AI SDK** 把这些都封装好了：
- `streamText` 处理流式输出，`toUIMessageStreamResponse()` 直接返回前端能消费的响应
- `useChat` hook 管理消息状态、流式更新、工具调用状态
- `convertToModelMessages` 自动转换消息格式

一句话：**Vercel AI SDK 是专门为 AI 应用 UI 层设计的工具层，不是 OpenAI SDK 的替代品，而是它的上层封装**。

---

## 项目结构

```
17-fullstack-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/
│   │       └── chat/
│   │           └── route.ts    ← 后端：处理 AI 请求
│   └── components/
│       └── chat.tsx            ← 前端：聊天 UI
├── package.json
├── next.config.ts
└── postcss.config.mjs
```

技术栈：
- **Next.js 15** App Router
- **React 19**
- **Vercel AI SDK v6**（`ai` + `@ai-sdk/openai` + `@ai-sdk/react`）
- **Tailwind CSS v4**

---

## 后端：Route Handler

Next.js App Router 里，API 路由放在 `app/api/xxx/route.ts`。我们的聊天接口在 `app/api/chat/route.ts`：

```typescript
// route.ts 节选

import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText, tool, UIMessage } from 'ai'
import { z } from 'zod'

// 使用自定义 baseURL 的 OpenAI 提供商（中转站）
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.OPENAI_BASE_URL,
})

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: openai('gpt-5.4'),
    system: 'You are a helpful assistant. When asked to calculate something, use the calculate tool.',
    messages: await convertToModelMessages(messages),
    tools: {
      calculate: tool({
        description: 'Evaluate a mathematical expression and return the result',
        inputSchema: z.object({
          expression: z.string().describe('The math expression to evaluate'),
        }),
        execute: async ({ expression }) => {
          try {
            const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '')
            const result = Function(`'use strict'; return (${sanitized})`)()
            return { result: String(result), expression }
          } catch {
            return { error: 'Invalid expression', expression }
          }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
```

几个关键点：

**`createOpenAI` 配置自定义 baseURL**。这是接入中转站的方式，和之前章节用 `openai` 包直接配置的思路一样，只是换成了 Vercel AI SDK 的 provider 写法。

**`convertToModelMessages`**。前端发来的是 `UIMessage[]`（包含 `parts` 数组的格式），模型需要的是 `ModelMessage[]`（OpenAI 的 messages 格式）。这个函数负责转换，包括把工具调用结果正确地插入消息序列。

**`tool` 函数的 `inputSchema`**。注意这里用的是 `inputSchema`，不是旧版的 `parameters`。Vercel AI SDK v5+ 统一用 `inputSchema`。

**`toUIMessageStreamResponse()`**。这个方法把流式结果转成前端 `useChat` hook 能直接消费的 SSE 响应格式。不要用旧版的 `toDataStreamResponse()`，那个已经废弃了。

---

## 前端：useChat Hook

前端的核心是 `useChat` hook，它管理整个聊天状态：

```typescript
// chat.tsx 节选

import { useChat } from '@ai-sdk/react'
import { isTextUIPart, isToolUIPart } from 'ai'
import { useState } from 'react'

export function Chat() {
  const { messages, sendMessage, status } = useChat()
  const [input, setInput] = useState('')

  const isStreaming = status === 'streaming'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    await sendMessage({ text })
  }

  // ...
}
```

注意 v6 的 `useChat` API 和旧版有明显变化：
- 旧版有 `input`、`handleInputChange`、`handleSubmit`，现在都没了
- 新版只有 `sendMessage`，input 状态需要自己用 `useState` 管理
- 发消息用 `sendMessage({ text: '...' })`，不再是表单提交

**消息渲染**。v6 的消息用 `parts` 数组表示内容，每个 part 有不同的类型：

```typescript
// chat.tsx 节选

{message.parts.map((part, i) => {
  // 文本内容
  if (isTextUIPart(part)) {
    return <p key={i}>{part.text}</p>
  }

  // 工具调用结果
  if (isToolUIPart(part) && part.type === 'tool-calculate') {
    const input = part.state !== 'input-streaming'
      ? (part.input as CalculateInput)
      : null
    const output = part.state === 'output-available'
      ? (part.output as CalculateOutput)
      : null

    return (
      <div key={i} className="font-mono text-xs">
        {output ? (
          <span>{input?.expression} = <strong>{output.result}</strong></span>
        ) : (
          <span>Calculating {input?.expression}...</span>
        )}
      </div>
    )
  }

  return null
})}
```

工具调用的 part 类型是 `tool-{toolName}`，这里是 `tool-calculate`。它有 `state` 字段：
- `input-streaming`：工具参数还在流式传输中
- `input-available`：参数已完整，工具开始执行
- `output-available`：工具执行完成，有结果了

这套状态机让你可以在 UI 里展示"计算中..."的过渡状态，而不是等工具执行完才显示。

---

## 运行起来

安装依赖：

```bash
pnpm install
```

配置 `.env`：

```
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://your-proxy.com/v1
```

启动开发服务器：

```bash
pnpm dev
```

打开 `http://localhost:3000`，试着问"what is 123 * 456?"，你会看到 AI 调用 `calculate` 工具，实时展示计算过程，最后给出答案。

---

## 踩坑与最佳实践

### 1. Vercel AI SDK 版本要对齐

`ai`、`@ai-sdk/openai`、`@ai-sdk/react` 这三个包的版本必须对应同一个大版本。`ai@6.x` 对应 `@ai-sdk/openai@3.x` 和 `@ai-sdk/react@3.x`。版本不对齐会出现类型错误或运行时报错。

### 2. `toUIMessageStreamResponse` 不是 `toDataStreamResponse`

旧版文档和教程里大量使用 `toDataStreamResponse()`，但 v5+ 已经废弃了这个方法。如果你在用 `useChat`，必须用 `toUIMessageStreamResponse()`，否则前端无法正确解析流式数据。

### 3. 消息格式转换不能省

前端发来的 `UIMessage[]` 不能直接传给 `streamText`，必须先用 `convertToModelMessages` 转换。这个函数会把工具调用结果正确地插入消息序列，让模型能看到完整的对话历史。

### 4. 工具执行要做输入校验

`execute` 函数接收的是用户通过 LLM 传来的参数，不能完全信任。示例里的 `calculate` 工具用正则过滤了非法字符，避免代码注入。生产环境里，工具执行前要做严格的参数校验。

### 5. 环境变量只在服务端可用

`OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 只在 Route Handler（服务端）里使用，不要加 `NEXT_PUBLIC_` 前缀，否则会暴露给客户端。

---

## 小结

- **Vercel AI SDK 解决了 AI 应用 UI 层的三大痛点**：流式输出、工具调用状态管理、消息格式转换，让你专注业务逻辑而不是底层管道
- **Route Handler + useChat 是标准的 Next.js AI 应用架构**：后端用 `streamText` + `toUIMessageStreamResponse`，前端用 `useChat` + `message.parts` 渲染
- **版本对齐很重要**：`ai`、`@ai-sdk/openai`、`@ai-sdk/react` 必须用同一大版本，v6 对应 v3

有了这个基础，下一步可以加上持久化（把对话存到数据库）、认证（限制谁能用）、监控（记录每次调用的延迟和费用）。下一篇我们就来看 AI 应用的监控与评估。

---

**下一篇**：AI 应用的监控与评估：LangFuse + RAGAS

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 17 篇*

---

**搭这个 demo 的过程里，我用 Claude Code 帮我查 Vercel AI SDK v6 的 API 变化，省了不少翻文档的时间。AI 工具用来辅助开发，效率提升是真实的。如果你也在折腾 AI 编码助手，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
