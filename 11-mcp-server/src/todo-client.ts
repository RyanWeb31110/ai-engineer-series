// todo-client.ts - MCP Client 演示：连接 Server，遍历三大原语
// 展示 Tools 调用、Resources 读取、Prompts 获取的完整流程

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('=== MCP Client Demo: Todo Server ===\n')

  // ─── 1. 建立连接 ─────────────────────────────────────────────────────────

  const client = new Client({
    name: 'todo-client',
    version: '1.0.0',
  })

  const serverPath = path.resolve(__dirname, 'todo-server.ts')
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverPath],
  })

  console.log('[Connect] Connecting to todo-server...')
  await client.connect(transport)
  console.log('[Connect] Connected!\n')

  // ─── 2. 发现工具 ────────────���────────────────────────────────────────────

  console.log('--- Tools ---')
  const { tools } = await client.listTools()
  console.log(`Found ${tools.length} tool(s):`)
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`)
  }
  console.log()

  // ─── 3. 发现资源 ─────────────────────────────────────────────────────────

  console.log('--- Resources ---')
  const { resources } = await client.listResources()
  console.log(`Found ${resources.length} resource(s):`)
  for (const res of resources) {
    console.log(`  - ${res.uri}: ${res.name}`)
  }

  // 同时检查资源模板
  const { resourceTemplates } = await client.listResourceTemplates()
  console.log(`Found ${resourceTemplates.length} resource template(s):`)
  for (const tmpl of resourceTemplates) {
    console.log(`  - ${tmpl.uriTemplate}: ${tmpl.name}`)
  }
  console.log()

  // ─── 4. 发现提示模板 ──────────────────────────────────────────────────────

  console.log('--- Prompts ---')
  const { prompts } = await client.listPrompts()
  console.log(`Found ${prompts.length} prompt(s):`)
  for (const p of prompts) {
    console.log(`  - ${p.name}: ${p.description}`)
  }
  console.log()

  // ─── 5. 使用工具：添加几个 Todo ────────────────────────────────────────────

  console.log('--- Using Tools ---')

  // 添加三个 Todo
  const todosToAdd = [
    { title: 'Design API schema', description: 'Define REST endpoints and data models', priority: 'high' },
    { title: 'Write unit tests', description: 'Cover all service layer methods', priority: 'medium' },
    { title: 'Update README', description: 'Add setup instructions and examples', priority: 'low' },
  ]

  for (const todo of todosToAdd) {
    const result = await client.callTool({ name: 'add_todo', arguments: todo })
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
    const parsed = JSON.parse(text)
    console.log(`[add_todo] Created: ${parsed.id} - "${parsed.title}" (${parsed.priority})`)
  }
  console.log()

  // 列出所有 Todo
  console.log('[list_todos] All todos:')
  const listResult = await client.callTool({ name: 'list_todos', arguments: { status: 'all' } })
  console.log((listResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '')
  console.log()

  // 更新第一个 Todo 的状态
  console.log('[update_todo] Marking todo-1 as in_progress...')
  const updateResult = await client.callTool({
    name: 'update_todo',
    arguments: { id: 'todo-1', status: 'in_progress' },
  })
  const updated = JSON.parse((updateResult.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}')
  console.log(`[update_todo] Result: ${updated.id} -> ${updated.status}`)
  console.log()

  // ─── 6. 读取资源：获取统计数据 ─────────────────────────────────────────────

  console.log('--- Reading Resources ---')
  const statsResult = await client.readResource({ uri: 'todo://stats' })
  const statsContent = statsResult.contents[0]
  const statsText = statsContent && 'text' in statsContent ? statsContent.text : '{}'
  console.log('[Resource: todo://stats]')
  console.log(statsText)
  console.log()

  // 读取单个 Todo 详情（通过动态 URI）
  const detailResult = await client.readResource({ uri: 'todo://items/todo-1' })
  const detailContent = detailResult.contents[0]
  const detailText = detailContent && 'text' in detailContent ? detailContent.text : '{}'
  console.log('[Resource: todo://items/todo-1]')
  console.log(detailText)
  console.log()

  // ─── 7. 获取提示模板 ──────────────────────────────────────────────────────

  console.log('--- Getting Prompts ---')

  // 获取任务分解模板
  const breakdownPrompt = await client.getPrompt({
    name: 'break-down-task',
    arguments: { task: 'Build a user authentication system', maxSubtasks: '3' },
  })
  console.log('[Prompt: break-down-task]')
  for (const msg of breakdownPrompt.messages) {
    const text = msg.content as { type: string; text: string }
    console.log(`  ${msg.role}: ${text.text.slice(0, 120)}...`)
  }
  console.log()

  // 获取每日总结模板
  const summaryPrompt = await client.getPrompt({
    name: 'daily-summary',
    arguments: {},
  })
  console.log('[Prompt: daily-summary]')
  for (const msg of summaryPrompt.messages) {
    const text = msg.content as { type: string; text: string }
    console.log(`  ${msg.role}:`)
    console.log(text.text)
  }
  console.log()

  // ─── 8. 清理：删除一个 Todo ─────────────────────────────────────────────

  console.log('--- Cleanup ---')
  const deleteResult = await client.callTool({ name: 'delete_todo', arguments: { id: 'todo-3' } })
  console.log(`[delete_todo] ${(deleteResult.content as Array<{ type: string; text: string }>)[0]?.text}`)
  console.log()

  // ─── 9. 断开连接 ─────────────────────────────────────────────────────────

  console.log('[Disconnect] Closing connection...')
  await client.close()
  console.log('[Disconnect] Done!')
}

main().catch((err) => {
  console.error('Client error:', err)
  process.exit(1)
})
