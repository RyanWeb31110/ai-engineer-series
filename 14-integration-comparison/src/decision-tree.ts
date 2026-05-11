// decision-tree.ts — 集成方式决策树
// 根据需求特征，自动推荐最合适的集成方式（MCP / Plugin / Skill）

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { MODELS } from '@ai-series/shared'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

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

// ─── 决策维度定义 ───────────────────────────────────────────────────────────────

interface DecisionResult {
  recommendation: 'mcp' | 'plugin' | 'skill' | 'mcp+skill' | 'plugin+skill'
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  tradeoffs: string[]
}

// 决策工具：让 LLM 分析需求并给出推荐
const decisionTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'recommend_integration',
    description: 'Analyze the requirement and recommend the best integration approach',
    parameters: {
      type: 'object',
      properties: {
        recommendation: {
          type: 'string',
          enum: ['mcp', 'plugin', 'skill', 'mcp+skill', 'plugin+skill'],
          description: 'The recommended integration approach',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence level of the recommendation',
        },
        reasoning: {
          type: 'string',
          description: 'Step-by-step reasoning for the recommendation',
        },
        tradeoffs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key tradeoffs to consider with this choice',
        },
      },
      required: ['recommendation', 'confidence', 'reasoning', 'tradeoffs'],
    },
  },
}

// 决策系统的 system prompt：包含完整的决策框架
const DECISION_SYSTEM_PROMPT = `You are an AI integration architect. Given a requirement description, analyze it and recommend the best integration approach.

## Decision Framework

### MCP (Model Context Protocol)
Best for:
- Building NEW tools specifically for AI agents
- Need stateful connections (sessions, subscriptions, streaming)
- Complex tool interactions that require context preservation
- IDE integrations, development tools, database access
- When you control both the tool and the agent

NOT suitable for:
- Already have REST APIs you just want to expose
- Simple one-shot queries
- Pure knowledge/reasoning tasks

### Plugin (OpenAPI / GPT Actions)
Best for:
- EXISTING REST APIs you want to expose to AI
- Standard CRUD operations
- Public APIs with good documentation
- Quick integration without code changes
- When the API is stateless and request/response based

NOT suitable for:
- Need real-time streaming or subscriptions
- Complex multi-step stateful workflows
- No existing API documentation

### Skill (Prompt Engineering)
Best for:
- Domain expertise and reasoning patterns
- Code review, writing, analysis tasks
- Formatting and output structure control
- Tasks that don't need external data
- Augmenting MCP/Plugin with domain knowledge

NOT suitable for:
- Need real-time external data
- Need to execute actions (write files, call APIs)
- Tasks requiring tool use

### Combinations
- MCP + Skill: Tools with domain expertise (e.g., database tool + SQL expert skill)
- Plugin + Skill: API access with specialized analysis (e.g., weather API + meteorologist skill)

## Decision Criteria (in priority order)
1. Does it need external data or actions? No → Skill. Yes → continue.
2. Do you already have a REST API? Yes → Plugin. No → continue.
3. Do you need stateful connections? Yes → MCP. No → Plugin might still work.
4. Does it also need domain expertise? Yes → add Skill as complement.`

// ─── 运行决策树 ─────────────────────────────────────────────────────────────────

async function analyzeRequirement(requirement: string): Promise<DecisionResult> {
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    messages: [
      { role: 'system', content: DECISION_SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this requirement and recommend an integration approach:\n\n${requirement}` },
    ],
    tools: [decisionTool],
    tool_choice: 'required',
  })

  const toolCalls = response.choices[0]?.message.tool_calls ?? []
  if (toolCalls.length === 0) {
    throw new Error('Decision tool was not called')
  }

  return JSON.parse(toolCalls[0].function.arguments) as DecisionResult
}

// ─── 运行示例 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Integration Decision Tree ===\n')

  const scenarios = [
    {
      label: 'Scenario 1: Code Review Assistant',
      requirement: 'I want my AI agent to review pull requests, check for bugs, suggest improvements, and enforce our team coding standards.',
    },
    {
      label: 'Scenario 2: E-commerce Product Search',
      requirement: 'We have an existing product catalog REST API with search, filtering, and recommendation endpoints. We want ChatGPT to be able to search and recommend products to users.',
    },
    {
      label: 'Scenario 3: IDE Database Explorer',
      requirement: 'I want to build a tool for VS Code that lets the AI agent connect to my PostgreSQL database, explore schemas, run queries, and maintain connection state across multiple interactions.',
    },
    {
      label: 'Scenario 4: Customer Support with Knowledge Base',
      requirement: 'We have a REST API for our ticketing system and want the AI to both access ticket data AND respond with our company tone and troubleshooting methodology.',
    },
  ]

  for (const scenario of scenarios) {
    console.log(`--- ${scenario.label} ---`)
    console.log(`Requirement: ${scenario.requirement.slice(0, 100)}...\n`)

    const result = await analyzeRequirement(scenario.requirement)

    console.log(`  Recommendation: ${result.recommendation.toUpperCase()}`)
    console.log(`  Confidence: ${result.confidence}`)
    console.log(`  Reasoning: ${result.reasoning}`)
    console.log(`  Tradeoffs:`)
    for (const t of result.tradeoffs) {
      console.log(`    - ${t}`)
    }
    console.log()
  }
}

main().catch(console.error)
