// basic-skill.ts — 用自然语言定义 Agent Skill 并注入到对话中
// 演示最基础的 Skill 模式：把专业能力写成结构化提示词，注入 system prompt

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { MODELS } from '@ai-series/shared'

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

/**
 * Skill 的结构化定义
 * 一个 Skill 本质上就是一段精心编写的提示词，描述 Agent 在特定领域应该具备的行为
 */
interface Skill {
  /** 技能名称 */
  name: string
  /** 技能描述，一句话说明用途 */
  description: string
  /** 注入到 system prompt 的指令文本 */
  instruction: string
  /** 输出格式约束（可选） */
  outputFormat?: string
  /** 示例对话（可选，用于 few-shot） */
  examples?: Array<{ user: string; assistant: string }>
}

// 定义一个「SQL 查询专家」技能
const sqlExpertSkill: Skill = {
  name: 'SQL Expert',
  description: 'Generates optimized SQL queries from natural language descriptions',
  instruction: `You are an expert SQL developer. When users describe data requirements in natural language, you:

1. Analyze the requirement and identify the tables, columns, and relationships involved
2. Generate a correct, optimized SQL query (PostgreSQL dialect)
3. Explain the query logic step by step
4. Point out potential performance issues and suggest indexes if needed

Rules:
- Always use explicit JOIN syntax (never implicit joins in WHERE clause)
- Use table aliases for readability (e.g., u for users, o for orders)
- Add comments in the SQL for complex logic
- Prefer CTEs over subqueries for readability
- Always consider NULL handling`,
  outputFormat: `Return the result in this format:
\`\`\`sql
-- Your SQL query here
\`\`\`

**Explanation**: Step-by-step explanation of the query logic.

**Performance Notes**: Any indexing or optimization suggestions.`,
  examples: [
    {
      user: 'Find the top 5 customers who spent the most in the last 30 days',
      assistant: `\`\`\`sql
-- Top 5 customers by total spending in last 30 days
SELECT
  u.id,
  u.name,
  u.email,
  SUM(o.total_amount) AS total_spent
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND o.status = 'completed'
GROUP BY u.id, u.name, u.email
ORDER BY total_spent DESC
LIMIT 5;
\`\`\`

**Explanation**: Join users with their orders, filter for completed orders in the last 30 days, aggregate spending per user, and return the top 5.

**Performance Notes**: Ensure composite index on \`orders(user_id, created_at, status)\` for optimal performance.`,
    },
  ],
}

// ─── 将 Skill 编译为 system prompt ──────────────────────────────────────────────

/**
 * 把 Skill 定义编译成完整的 system prompt
 * 这是 Skill 模式的核心：结构化定义 → 可注入的提示词
 */
function compileSkill(skill: Skill): string {
  const parts: string[] = []

  // 角色与指令
  parts.push(`## Skill: ${skill.name}`)
  parts.push('')
  parts.push(skill.instruction)

  // 输出格式约束
  if (skill.outputFormat) {
    parts.push('')
    parts.push('## Output Format')
    parts.push('')
    parts.push(skill.outputFormat)
  }

  // Few-shot 示例
  if (skill.examples && skill.examples.length > 0) {
    parts.push('')
    parts.push('## Examples')
    for (const ex of skill.examples) {
      parts.push('')
      parts.push(`**User**: ${ex.user}`)
      parts.push('')
      parts.push(`**Assistant**: ${ex.assistant}`)
    }
  }

  return parts.join('\n')
}

// ─── 运行示例 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Basic Skill Demo: SQL Expert ===\n')

  // 编译技能为 system prompt
  const systemPrompt = compileSkill(sqlExpertSkill)
  console.log('[Skill] Compiled system prompt:')
  console.log(`  Name: ${sqlExpertSkill.name}`)
  console.log(`  Description: ${sqlExpertSkill.description}`)
  console.log(`  Prompt length: ${systemPrompt.length} chars\n`)

  // 用户的自然语言查询
  const userQuery =
    'I have a users table and a posts table. Find all users who posted more than 10 times this month but never received any comments on their posts.'

  console.log(`[User] ${userQuery}\n`)

  // 调用 LLM，注入技能
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery },
    ],
  })

  const result = response.choices[0]?.message.content ?? ''
  console.log('[Agent Response]')
  console.log(result)
  console.log(
    `\n[Usage] ${response.usage?.prompt_tokens ?? 0} input + ${response.usage?.completion_tokens ?? 0} output tokens`,
  )

  // ─── 对比：没有技能注入时的效果 ─────────────────────────────────────────────
  console.log('\n\n=== Comparison: Without Skill ===\n')
  console.log(`[User] ${userQuery}\n`)

  const plainResponse = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0.2,
    messages: [{ role: 'user', content: userQuery }],
  })

  const plainResult = plainResponse.choices[0]?.message.content ?? ''
  console.log('[Agent Response (no skill)]')
  console.log(plainResult)
  console.log(
    `\n[Usage] ${plainResponse.usage?.prompt_tokens ?? 0} input + ${plainResponse.usage?.completion_tokens ?? 0} output tokens`,
  )
}

main().catch(console.error)
