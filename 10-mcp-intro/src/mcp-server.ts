// mcp-server.ts - MCP Server demo: weather + calculator
// chapter 10 - MCP protocol introduction

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 创建 MCP Server 实例
const server = new McpServer({
  name: 'demo-server',
  version: '1.0.0',
})

// 模拟天气数据
const WEATHER_DATA: Record<string, { temp: number; condition: string; humidity: number }> = {
  'Beijing': { temp: 22, condition: 'Sunny', humidity: 35 },
  'Shanghai': { temp: 25, condition: 'Cloudy', humidity: 60 },
  'Guangzhou': { temp: 30, condition: 'Thunderstorm', humidity: 80 },
  'Tokyo': { temp: 18, condition: 'Rainy', humidity: 70 },
}

// 注册天气查询工具
server.registerTool(
  'get_weather',
  {
    title: 'Get Weather',
    description: 'Query current weather for a given city (e.g. Beijing, Shanghai, Guangzhou, Tokyo)',
    inputSchema: z.object({
      city: z.string().describe('City name in English'),
    }),
  },
  async ({ city }) => {
    const data = WEATHER_DATA[city]
    if (!data) {
      return {
        content: [{ type: 'text' as const, text: `No weather data available for "${city}". Available cities: ${Object.keys(WEATHER_DATA).join(', ')}` }],
      }
    }
    const text = `${city}: ${data.temp}C, ${data.condition}, humidity ${data.humidity}%`
    return {
      content: [{ type: 'text' as const, text }],
    }
  }
)

// 注册计算器工具
server.registerTool(
  'calculate',
  {
    title: 'Calculator',
    description: 'Evaluate a mathematical expression and return the result',
    inputSchema: z.object({
      expression: z.string().describe('Math expression to evaluate, e.g. "299 * 12 * 0.85"'),
    }),
  },
  async ({ expression }) => {
    try {
      // 安全检查：只允许数字和基本运算符
      if (!/^[\d\s+\-*/().]+$/.test(expression)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid expression: "${expression}". Only numbers and basic operators (+, -, *, /) are allowed.` }],
        }
      }
      const result = new Function(`return (${expression})`)() as number
      return {
        content: [{ type: 'text' as const, text: `${expression} = ${result}` }],
      }
    } catch {
      return {
        content: [{ type: 'text' as const, text: `Failed to evaluate expression: "${expression}"` }],
      }
    }
  }
)

// 启动 stdio 传输
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 日志输出到 stderr，stdout 留给 MCP 协议消息
  console.error('[MCP Server] demo-server v1.0.0 started (stdio)')
}

main().catch((err) => {
  console.error('[MCP Server] Fatal error:', err)
  process.exit(1)
})
