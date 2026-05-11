// skill-router.ts — 技能路由：根据用户意图动态选择并加载技能
// 演示如何让 Agent 拥有多个技能，并根据用户输入自动匹配最合适的技能

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { MODELS } from '@ai-series/shared'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

// ─── 加载环境变量 ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
}

const openai = new OpenAI()

// ─── Skill 定义 ─────────────────────────────────────────────────────────────────

interface Skill {
  name: string
  description: string
  instruction: string
  outputFormat?: string
}

// 技能注册表：Agent 可用的全部技能
const SKILL_REGISTRY: Record<string, Skill> = {
  code_reviewer: {
    name: 'Code Reviewer',
    description: 'Reviews code for bugs, security issues, and best practices',
    instruction: `You are a senior code reviewer. When given code to review, you:

1. Check for bugs and logical errors
2. Identify security vulnerabilities (injection, XSS, etc.)
3. Evaluate code style and readability
4. Suggest concrete improvements with code examples

Severity levels: CRITICAL (must fix), WARNING (should fix), INFO (nice to have).
Be specific — cite line numbers and explain WHY something is a problem, not just WHAT.`,
    outputFormat: `Use this format for each finding:

**[SEVERITY] Issue Title**
- Line: <number or range>
- Problem: <what is wrong>
- Fix: <concrete suggestion with code>`,
  },

  api_designer: {
    name: 'API Designer',
    description: 'Designs RESTful API endpoints following best practices',
    instruction: `You are a REST API architect. When users describe a feature or resource, you:

1. Design the RESTful endpoints (method, path, request/response)
2. Follow REST naming conventions (plural nouns, proper HTTP methods)
3. Include error responses and status codes
4. Consider pagination, filtering, and versioning

Rules:
- Use plural nouns for resources (/users, not /user)
- Use HTTP methods correctly (GET=read, POST=create, PUT=full update, PATCH=partial, DELETE=remove)
- Nest sub-resources logically (/users/{id}/posts)
- Always include error response schemas`,
    outputFormat: `For each endpoint:

\`\`\`
METHOD /path
\`\`\`
- Description: what this endpoint does
- Request: body/query parameters
- Response 200: success response shape
- Response 4xx: error cases`,
  },

  test_writer: {
    name: 'Test Writer',
    description: 'Writes comprehensive test cases for given code or requirements',
    instruction: `You are a QA engineer specialized in writing test cases. When given code or requirements, you:

1. Identify all testable behaviors (happy path + edge cases)
2. Write clear test descriptions using the "should..." pattern
3. Cover boundary conditions, error cases, and null/undefined handling
4. Group related tests logically

Rules:
- Each test verifies exactly ONE behavior
- Test names describe the expected behavior, not the implementation
- Include setup, action, and assertion for each test
- Cover: valid input, invalid input, boundary values, empty/null, concurrent access`,
  },
}

// ─── 技能路由器 ──────────────────────────────────────────────────────────────────

/**
 * 技能路由的两种策略：
 * 1. 基于关键词匹配（简单、快速、不花 token）
 * 2. 让 LLM 用 Function Calling 做意图分类（更准确、花 token）
 *
 * 这里演示第二种，因为它更通用
 */

// 把技能注册表转换成一个路由工具，让 LLM 选择
function buildRouterTool(): ChatCompletionTool {
  const skillNames = Object.keys(SKILL_REGISTRY)
  return {
    type: 'function',
    function: {
      name: 'select_skill',
      description:
        'Analyze the user request and select the most appropriate skill to handle it. ' +
        'Choose based on the nature of the task, not keywords.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            enum: skillNames,
            description: `Available skills: ${skillNames.map(k => `${k} (${SKILL_REGISTRY[k].description})`).join('; ')}`,
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why this skill is the best match',
          },
        },
        required: ['skill_name', 'reason'],
      },
    },
  }
}

/**
 * 路由步骤：让 LLM 分析用户请求，选出最合适的技能
 */
async function routeToSkill(userMessage: string): Promise<{ skill: Skill; reason: string }> {
  const routerTool = buildRouterTool()

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'You are a task router. Analyze the user request and select the most appropriate skill. ' +
        'Consider the nature of the task, not surface-level keywords.',
    },
    { role: 'user', content: userMessage },
  ]

  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    messages,
    tools: [routerTool],
    tool_choice: 'required',
  })

  const toolCalls = response.choices[0]?.message.tool_calls ?? []
  if (toolCalls.length === 0) {
    throw new Error('Router did not select a skill')
  }

  const args = JSON.parse(toolCalls[0].function.arguments)
  const skill = SKILL_REGISTRY[args.skill_name]
  if (!skill) {
    throw new Error(`Unknown skill: ${args.skill_name}`)
  }

  return { skill, reason: args.reason }
}

/**
 * 执行步骤：用选中的技能处理用户请求
 */
async function executeWithSkill(skill: Skill, userMessage: string): Promise<string> {
  // 编译技能为 system prompt
  const parts = [
    `## Skill: ${skill.name}`,
    '',
    skill.instruction,
  ]
  if (skill.outputFormat) {
    parts.push('', '## Output Format', '', skill.outputFormat)
  }

  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0.3,
    messages: [
      { role: 'system', content: parts.join('\n') },
      { role: 'user', content: userMessage },
    ],
  })

  return response.choices[0]?.message.content ?? ''
}

// ─── 运行示例 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Skill Router Demo ===\n')

  // 注册的技能列表
  console.log('[Registry] Available skills:')
  for (const [key, skill] of Object.entries(SKILL_REGISTRY)) {
    console.log(`  - ${key}: ${skill.description}`)
  }
  console.log()

  // 测试用例：3 个不同意图的请求
  const testQueries = [
    'Please check this Python function for bugs:\n```python\ndef get_user(user_id):\n    query = f"SELECT * FROM users WHERE id = {user_id}"\n    return db.execute(query)\n```',
    'I need to build a blog platform. Design the API endpoints for managing posts and comments.',
    'Write test cases for a function called calculateDiscount(price, memberLevel) that applies different discount rates based on membership level.',
  ]

  for (const query of testQueries) {
    console.log('─'.repeat(60))
    console.log(`\n[User] ${query.slice(0, 80)}${query.length > 80 ? '...' : ''}\n`)

    // 第一步：路由
    const { skill, reason } = await routeToSkill(query)
    console.log(`[Router] Selected skill: ${skill.name}`)
    console.log(`[Router] Reason: ${reason}\n`)

    // 第二步：执行
    const result = await executeWithSkill(skill, query)
    console.log(`[Agent] Response:\n${result}\n`)
  }
}

main().catch(console.error)
