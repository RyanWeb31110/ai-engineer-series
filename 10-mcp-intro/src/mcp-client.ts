// mcp-client.ts - MCP Client demo: connect to server, discover tools, call them
// chapter 10 - MCP protocol introduction

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('=== MCP Client Demo ===\n')

  // 1. 创建 Client 实例
  const client = new Client({
    name: 'demo-client',
    version: '1.0.0',
  })

  // 2. 通过 stdio 连接到 Server（将 Server 作为子进程启动）
  const serverPath = path.resolve(__dirname, 'mcp-server.ts')
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverPath],
  })

  console.log('[Step 1] Connecting to MCP Server...')
  await client.connect(transport)
  console.log('[Step 1] Connected!\n')

  // 3. 发现可用工具（动态发现，不需要预先知道有哪些工具）
  console.log('[Step 2] Discovering available tools...')
  const { tools } = await client.listTools()
  console.log(`[Step 2] Found ${tools.length} tool(s):`)
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`)
  }
  console.log()

  // 4. 调用天气工具
  console.log('[Step 3] Calling get_weather({ city: "Beijing" })...')
  const weatherResult = await client.callTool({
    name: 'get_weather',
    arguments: { city: 'Beijing' },
  })
  for (const item of weatherResult.content as Array<{ type: string; text: string }>) {
    if (item.type === 'text') {
      console.log(`[Step 3] Result: ${item.text}`)
    }
  }
  console.log()

  // 5. 调用天气工具（查询不存在的城市）
  console.log('[Step 4] Calling get_weather({ city: "London" })...')
  const noDataResult = await client.callTool({
    name: 'get_weather',
    arguments: { city: 'London' },
  })
  for (const item of noDataResult.content as Array<{ type: string; text: string }>) {
    if (item.type === 'text') {
      console.log(`[Step 4] Result: ${item.text}`)
    }
  }
  console.log()

  // 6. 调用计算器工具
  console.log('[Step 5] Calling calculate({ expression: "299 * 12 * 0.85" })...')
  const calcResult = await client.callTool({
    name: 'calculate',
    arguments: { expression: '299 * 12 * 0.85' },
  })
  for (const item of calcResult.content as Array<{ type: string; text: string }>) {
    if (item.type === 'text') {
      console.log(`[Step 5] Result: ${item.text}`)
    }
  }
  console.log()

  // 7. 断开连接
  console.log('[Step 6] Disconnecting...')
  await client.close()
  console.log('[Step 6] Done!')
}

main().catch((err) => {
  console.error('Client error:', err)
  process.exit(1)
})
