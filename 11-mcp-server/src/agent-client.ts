// agent-client.ts - LLM + MCP 集成：让 AI 通过 MCP 工具自主管理 Todo
// 展示如何把 MCP 工具转换为 Function Calling 格式，驱动 LLM Agent 循环

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import OpenAI from 'openai'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODELS } from '@ai-series/shared'
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 环境变量加载 ─────────────────────────────────────────────────────────────

const envPath = path.resolve(__dirname, '..', '.env')
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

// ─── MCP 工具 → Function Calling 格式转换 ──────────────────────────────────

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

// ─── Agent 主循环 ──────────────────────────────────────────────────────────

async function runAgent(client: Client, userRequest: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[User] ${userRequest}`)
  console.log('='.repeat(60))

  // 1. 从 MCP Server 动态发现工具
  const { tools: mcpTools } = await client.listTools()
  const openaiTools = mcpToolsToOpenAI(mcpTools)
  console.log(`\n[Agent] Discovered ${mcpTools.length} tools from MCP Server`)

  // 2. 构建消息历史
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: [
        'You are a todo management assistant. Use the provided tools to help users manage their tasks.',
        'Always confirm what you did after each operation.',
        'When adding todos, infer reasonable priority if not specified.',
        'Respond in Chinese.',
      ].join('\n'),
    },
    { role: 'user', content: userRequest },
  ]

  // 3. Agent 循环：LLM 推理 → 工具调用 → 结果反馈 → 继续推理
  const MAX_TURNS = 10
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n--- Turn ${turn + 1} ---`)

    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      messages,
      tools: openaiTools,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    if (!choice) {
      console.log('[Agent] No response from LLM')
      break
    }

    const assistantMsg = choice.message

    // 检查是否有工具调用（中转站在有工具调用时 finish_reason 返回 'stop'）
    const toolCalls = assistantMsg.tool_calls ?? []
    if (toolCalls.length === 0) {
      // LLM 直接回复，没有工具调用，Agent 循环结束
      console.log(`[Agent] Final response:`)
      console.log(assistantMsg.content ?? '(empty)')
      break
    }

    // 有工具调用，把 assistant 消息（含 tool_calls）加入历史
    messages.push(assistantMsg as ChatCompletionMessageParam)

    // 逐个执行 MCP 工具调用
    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function
      const args = JSON.parse(argsStr)
      console.log(`[Agent] Calling tool: ${name}(${JSON.stringify(args)})`)

      // 通过 MCP Client 调用 Server 端工具
      const mcpResult = await client.callTool({ name, arguments: args })
      const resultText = (mcpResult.content as Array<{ type: string; text: string }>)
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')

      console.log(`[Agent] Tool result: ${resultText.slice(0, 200)}`)

      // 把工具结果反馈给 LLM
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultText,
      })
    }
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== MCP Agent Demo: LLM + Todo Server ===\n')

  // 1. 启动 MCP 连接
  const client = new Client({ name: 'agent-client', version: '1.0.0' })
  const serverPath = path.resolve(__dirname, 'todo-server.ts')
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverPath],
  })

  console.log('[Setup] Connecting to MCP Server...')
  await client.connect(transport)
  console.log('[Setup] Connected!\n')

  // 2. 运行 Agent，执行多轮用户请求
  await runAgent(client, '帮我创建三个任务：1) 设计数据库表结构（高优先级）2) 编写 API 接口（中优先级）3) 撰写技术文档（低优先级）')

  await runAgent(client, '把"设计数据库表结构"标记为进行中，然后给我看看当前所有任务的状态')

  // 3. 断开连接
  console.log('\n[Teardown] Closing MCP connection...')
  await client.close()
  console.log('[Teardown] Done!')
}

main().catch((err) => {
  console.error('Agent error:', err)
  process.exit(1)
})
