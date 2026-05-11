// skill-compose.ts — 技能组合：让多个技能协作完成复杂任务
// 演示技能编排模式：先用一个技能生成初始结果，再用另一个技能做后续处理（Pipeline 模式）

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

interface Skill {
  name: string
  description: string
  instruction: string
  outputFormat?: string
}

/**
 * 技能管道的一个步骤
 * input 可以引用前序步骤的输出（通过模板变量 {{prevOutput}}）
 */
interface PipelineStep {
  skill: Skill
  /** 传给该技能的用户消息模板，{{prevOutput}} 会被替换为上一步输出 */
  promptTemplate: string
}

// ─── 定义三个技能 ────────────────────────────────────────────────────────────────

// 技能 1：需求分析师
const requirementAnalyst: Skill = {
  name: 'Requirement Analyst',
  description: 'Analyzes vague product requirements into structured specifications',
  instruction: `You are a product analyst. When given a vague feature request, you:

1. Extract the core user need
2. List concrete functional requirements (numbered)
3. Identify edge cases and constraints
4. Define acceptance criteria

Be specific and actionable. Turn ambiguous language into testable requirements.`,
  outputFormat: `**Core Need**: one sentence summary

**Functional Requirements**:
1. ...
2. ...

**Edge Cases**:
- ...

**Acceptance Criteria**:
- [ ] ...`,
}

// 技能 2：API 设计师
const apiDesigner: Skill = {
  name: 'API Designer',
  description: 'Designs RESTful API based on structured requirements',
  instruction: `You are a REST API architect. Given a structured requirements document, you:

1. Identify the resources and their relationships
2. Design CRUD endpoints for each resource
3. Define request/response schemas
4. Include proper error handling and status codes

Follow REST best practices: plural nouns, proper HTTP methods, consistent naming.`,
  outputFormat: `For each endpoint:
\`\`\`
METHOD /api/v1/resource
\`\`\`
Request: { ... }
Response 200: { ... }
Response 4xx: { error: "..." }`,
}

// 技能 3：测试用例生成器
const testGenerator: Skill = {
  name: 'Test Generator',
  description: 'Generates integration test cases from API design',
  instruction: `You are a QA engineer. Given an API design document, you generate integration test cases:

1. Test each endpoint's happy path
2. Test validation errors (missing required fields, invalid types)
3. Test not-found scenarios
4. Test edge cases (empty lists, maximum values)

Write tests in a framework-agnostic describe/it format with clear assertions.`,
  outputFormat: `\`\`\`
describe("Resource API", () => {
  it("should ...", () => {
    // setup
    // action
    // assertion
  })
})
\`\`\``,
}

// ─── Pipeline 执行器 ────────────────────────────────────────────────────────────

/**
 * 编译技能为 system prompt
 */
function compileSkill(skill: Skill): string {
  const parts = [`## Skill: ${skill.name}`, '', skill.instruction]
  if (skill.outputFormat) {
    parts.push('', '## Output Format', '', skill.outputFormat)
  }
  return parts.join('\n')
}

/**
 * 执行技能管道：按顺序执行每个步骤，将上一步输出传给下一步
 */
async function runPipeline(
  steps: PipelineStep[],
  initialInput: string,
): Promise<string[]> {
  const outputs: string[] = []
  let prevOutput = ''

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const systemPrompt = compileSkill(step.skill)

    // 把模板中的变量替换为实际值
    const userMessage = step.promptTemplate
      .replace('{{input}}', initialInput)
      .replace('{{prevOutput}}', prevOutput)

    console.log(`\n--- Pipeline Step ${i + 1}: ${step.skill.name} ---`)
    console.log(`[Input] ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`)

    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const output = response.choices[0]?.message.content ?? ''
    outputs.push(output)
    prevOutput = output

    console.log(`[Output] ${output.slice(0, 200)}${output.length > 200 ? '...' : ''}`)
    console.log(
      `[Usage] ${response.usage?.prompt_tokens ?? 0} input + ${response.usage?.completion_tokens ?? 0} output tokens`,
    )
  }

  return outputs
}

// ─── 运行示例 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Skill Composition Demo: Requirement → API → Tests ===')

  // 一个模糊的产品需求
  const featureRequest =
    'We need a bookmark feature. Users should be able to save articles they like and organize them into collections.'

  console.log(`\n[Feature Request] ${featureRequest}`)

  // 定义技能管道：需求分析 → API 设计 → 测试生成
  const pipeline: PipelineStep[] = [
    {
      skill: requirementAnalyst,
      promptTemplate: '{{input}}',
    },
    {
      skill: apiDesigner,
      promptTemplate:
        'Based on the following requirements, design the REST API:\n\n{{prevOutput}}',
    },
    {
      skill: testGenerator,
      promptTemplate:
        'Generate integration test cases for the following API design:\n\n{{prevOutput}}',
    },
  ]

  const outputs = await runPipeline(pipeline, featureRequest)

  // 汇总输出
  console.log('\n' + '='.repeat(60))
  console.log('=== Pipeline Complete ===')
  console.log('='.repeat(60))

  const labels = ['Requirements Analysis', 'API Design', 'Test Cases']
  for (let i = 0; i < outputs.length; i++) {
    console.log(`\n--- ${labels[i]} ---\n`)
    console.log(outputs[i])
  }
}

main().catch(console.error)
