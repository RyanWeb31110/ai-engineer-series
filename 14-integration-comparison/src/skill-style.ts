// skill-style.ts — Skill 风格：用自然语言注入专业能力
// 演示 Skill 方式的核心特征：无外部工具，纯提示词注入领域知识

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
 * Skill 风格的核心：用结构化提示词注入专业能力
 * 特征：不调用任何外部 API，纯粹改变 Agent 的"思维方式"
 */
interface Skill {
  name: string
  description: string
  instruction: string
  outputFormat?: string
}

// 定义一个「气象分析师」技能
const weatherAnalystSkill: Skill = {
  name: 'Weather Analyst',
  description: 'Analyzes weather conditions and provides professional meteorological advice',
  instruction: `You are a professional meteorologist and weather analyst. When users ask about weather-related topics, you:

1. Provide detailed analysis of weather patterns and conditions
2. Explain the meteorological factors behind weather phenomena
3. Give practical advice based on weather conditions (clothing, travel, activities)
4. Assess weather risks and provide safety recommendations

Your knowledge includes:
- Seasonal weather patterns for major cities worldwide
- Climate zones and their characteristics
- Weather impact on daily activities and health
- Historical weather trends and climate data

When you don't have real-time data, clearly state that your analysis is based on typical seasonal patterns and historical averages. Always recommend checking a live weather service for current conditions.`,
  outputFormat: `Structure your response as:

**Current Assessment**: Brief overview of typical conditions
**Analysis**: Meteorological explanation
**Practical Advice**: What to wear, what to avoid, activities to consider
**Risk Level**: Low / Medium / High with explanation`,
}

// ─── 编译 Skill 为 system prompt ────────────────────────────────────────────────

function compileSkill(skill: Skill): string {
  const parts = [`## Skill: ${skill.name}`, '', skill.instruction]
  if (skill.outputFormat) {
    parts.push('', '## Output Format', '', skill.outputFormat)
  }
  return parts.join('\n')
}

// ─── 运行 Skill 风格的 Agent ────────────────────────────────────────────────────

async function runSkillStyleAgent(userQuery: string): Promise<void> {
  console.log('=== Skill Style: Natural Language Expertise Injection ===\n')

  // Skill 方式：没有工具发现、没有 HTTP 调用
  // 只有一段精心编写的 system prompt
  console.log(`[Skill] Loading skill: ${weatherAnalystSkill.name}`)
  console.log(`[Skill] Description: ${weatherAnalystSkill.description}`)

  const systemPrompt = compileSkill(weatherAnalystSkill)
  console.log(`[Skill] Compiled prompt: ${systemPrompt.length} chars\n`)

  console.log(`[User] ${userQuery}\n`)

  // 单次调用，无循环，无工具
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0.4,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery },
    ],
  })

  const result = response.choices[0]?.message.content ?? ''
  console.log(`[Agent]\n${result}`)
  console.log(`\n[Usage] ${response.usage?.prompt_tokens ?? 0} input + ${response.usage?.completion_tokens ?? 0} output tokens`)

  // 关键区别：Skill 不能获取实时数据，只能基于知识给出分析
  console.log('\n[Note] Skill-based approach: No real-time data, analysis based on domain knowledge')
}

// ─── 运行 ───────────────────────────────────────────────────────────────────────

runSkillStyleAgent('What is the weather in Beijing and Tokyo? Also give me a 3-day forecast for Beijing.').catch(console.error)
