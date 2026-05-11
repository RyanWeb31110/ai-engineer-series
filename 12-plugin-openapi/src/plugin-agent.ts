// Plugin Agent — 读取 OpenAPI spec，自动把 API 转为 Function Calling 工具
// 这是 Plugin/GPT Actions 的核心思路：LLM 通过 OpenAPI 规范自动发现并调用 REST API

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { MODELS } from '@ai-series/shared'
import type { OpenAPISpec } from './openapi-spec.js'

// ─── 加载环境变量 ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
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

// ─── 第一步：获取 OpenAPI spec ───────────────────────────────────────────────

/**
 * 从远端获取 OpenAPI 规范
 * 实际场景中，Plugin 系统通过约定的 URL（如 /openapi.json）拉取 spec
 */
async function fetchOpenAPISpec(baseUrl: string): Promise<OpenAPISpec> {
  const response = await fetch(`${baseUrl}/openapi.json`)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`)
  }
  return response.json() as Promise<OpenAPISpec>
}

// ─── 第二步：OpenAPI spec → Function Calling 工具定义 ─────────────────────────

/**
 * 把 OpenAPI spec 中的每个 operation 转换为一个 Function Calling 工具
 *
 * 转换逻辑：
 * - operationId → function name
 * - summary + description → function description
 * - parameters + requestBody → function parameters (JSON Schema)
 * - 额外注入 _method 和 _path 参数，运行时用于构造 HTTP 请求
 */
interface ToolMapping {
  tool: ChatCompletionTool
  method: string
  path: string
}

function specToTools(spec: OpenAPISpec): ToolMapping[] {
  const mappings: ToolMapping[] = []

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const op = operation as {
        operationId: string
        summary: string
        description: string
        parameters?: Array<{
          name: string
          in: string
          required: boolean
          description: string
          schema: Record<string, unknown>
        }>
        requestBody?: {
          required: boolean
          content: Record<string, { schema: Record<string, unknown> }>
        }
      }

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
          if (param.required) {
            required.push(param.name)
          }
        }
      }

      // 请求体参数（展平到同一层级）
      if (op.requestBody) {
        const bodySchema = op.requestBody.content['application/json']?.schema as {
          properties?: Record<string, unknown>
          required?: string[]
        }
        if (bodySchema?.properties) {
          Object.assign(properties, bodySchema.properties)
          if (bodySchema.required) {
            required.push(...bodySchema.required)
          }
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

// ─── 第三步：执行 API 调用 ───────────────────────────────────────────────────

/**
 * 根据 LLM 返回的 function call 参数，构造并发送实际的 HTTP 请求
 */
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
      // 路径参数
      resolvedPath = resolvedPath.replace(`{${key}}`, String(value))
    } else if (method === 'get') {
      // GET 请求的参数放到 query string
      queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    } else {
      // POST/PUT 请求的参数放到 body
      bodyArgs[key] = value
    }
  }

  const url = queryParams.length > 0
    ? `${baseUrl}${resolvedPath}?${queryParams.join('&')}`
    : `${baseUrl}${resolvedPath}`

  console.log(`[Plugin] ${method.toUpperCase()} ${url}`)

  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
  }
  if (method !== 'get' && Object.keys(bodyArgs).length > 0) {
    fetchOptions.body = JSON.stringify(bodyArgs)
  }

  const response = await fetch(url, fetchOptions)
  const data = await response.json()
  return JSON.stringify(data, null, 2)
}

// ─── 第四步：Agent 循环 ─────────────────────────────────────────────────────

const MAX_TURNS = 10
const API_BASE_URL = 'http://localhost:3100'

async function runPluginAgent(userQuery: string): Promise<void> {
  console.log(`\n=== Plugin Agent ===\n`)

  // 1. 从 API 服务获取 OpenAPI spec
  console.log(`[Plugin] Fetching OpenAPI spec from ${API_BASE_URL}/openapi.json ...`)
  const spec = await fetchOpenAPISpec(API_BASE_URL)
  console.log(`[Plugin] API: ${spec.info.title} v${spec.info.version}`)

  // 2. 把 spec 转换为 Function Calling 工具
  const toolMappings = specToTools(spec)
  const tools = toolMappings.map(m => m.tool)
  console.log(`[Plugin] Converted ${tools.length} API endpoints to tools:`)
  for (const m of toolMappings) {
    console.log(`  - ${m.tool.function.name} (${m.method.toUpperCase()} ${m.path})`)
  }

  // 构建 operationId → {method, path} 的查找表
  const lookupTable = new Map(toolMappings.map(m => [m.tool.function.name, m]))

  // 3. 构造初始消息
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        `You are a helpful assistant with access to a bookstore API. ` +
        `Use the available tools to help the user find, browse, and manage books. ` +
        `Always respond in the same language as the user's query.`,
    },
    { role: 'user', content: userQuery },
  ]

  console.log(`\n[User] ${userQuery}\n`)

  // 4. Agent 循环
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    const assistantMessage = choice.message
    messages.push(assistantMessage)

    const toolCalls = assistantMessage.tool_calls ?? []

    // 中转站的 finish_reason 在有工具调用时返回 'stop' 而非 'tool_calls'
    // 所以必须检查 tool_calls 数组长度
    if (toolCalls.length === 0) {
      console.log(`[Agent] Final response:`)
      console.log(assistantMessage.content)
      break
    }

    console.log(`--- Turn ${turn + 1} ---`)

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
      const mapping = lookupTable.get(fnName)

      if (!mapping) {
        console.log(`[Agent] Unknown tool: ${fnName}`)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Unknown operation: ${fnName}` }),
        })
        continue
      }

      console.log(`[Agent] Calling ${fnName}(${JSON.stringify(args)})`)
      const result = await executeAPICall(API_BASE_URL, mapping.method, mapping.path, args)
      console.log(`[Agent] Result: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }
  }
}

// ─── 入口 ───────────────────────────────────────────────────────────────────

const query = process.argv[2] || 'I want to find some AI-related books. Also, can you tell me the details of the most popular one?'
runPluginAgent(query).catch(console.error)
