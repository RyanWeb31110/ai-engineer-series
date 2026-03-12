/**
 * 02-prompt-engineering / chain-of-thought.ts
 *
 * 演示 Chain of Thought（思维链）对推理质量的提升
 * 对比：直接回答 vs 引导逐步推理
 *
 * 运行：pnpm cot
 * 前置：复制 .env.example 为 .env 并填入 API Key
 */

import { chat, MODELS } from '@ai-series/shared'
import type { Message } from '@ai-series/shared'

// 加载 .env
const dotenvPath = new URL('../.env', import.meta.url).pathname
try {
  const { readFileSync } = await import('fs')
  const envContent = readFileSync(dotenvPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && !key.startsWith('#') && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim()
    }
  }
} catch {
  // .env 不存在时跳过
}

// ─── 测试题目 ────────────────────────────────────────────────────────────────

/**
 * 这是一道经典的逻辑推理题，直接回答容易出错
 * 正确答案：5 天（每天翻倍：1→2→4→8→16→32）
 */
const REASONING_PROBLEM = `
一张纸对折一次变成 2 层，对折两次变成 4 层。
如果一张纸厚度是 0.1mm，对折多少次之后厚度会超过 3mm？
直接给出次数。
`

/**
 * 数学文字题，没有推理链容易漏掉条件
 * 正确答案：15 只（鸡 5 只，兔 10 只）
 */
const MATH_WORD_PROBLEM = `
鸡兔同笼，共有头 15 个，腿 40 条。
问：鸡和兔各有几只？
直接给出答案。
`

// ─── 实验：直接回答 vs CoT ──────────────────────────────────────────────────

async function compare(label: string, problem: string): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`题目：${label}`)
  console.log('─'.repeat(50))

  // 直接回答（无推理）
  {
    const messages: Message[] = [{ role: 'user', content: problem }]
    const res = await chat(messages, {
      model: MODELS.GPT5_CODEX,
      maxTokens: 100,
      temperature: 0,
    })
    console.log('\n【直接回答（无 CoT）】')
    console.log(res.content.trim())
  }

  // Zero-shot CoT：只加一句"Let's think step by step"
  {
    const cotProblem = problem.replace('直接给出次数。', '请一步一步思考，写出推理过程，最后给出答案。')
      .replace('直接给出答案。', '请一步一步思考，写出推理过程，最后给出答案。')
    const messages: Message[] = [{ role: 'user', content: cotProblem }]
    const res = await chat(messages, {
      model: MODELS.GPT5_CODEX,
      maxTokens: 400,
      temperature: 0,
    })
    console.log('\n【CoT：逐步推理】')
    console.log(res.content.trim())
  }
}

console.log('='.repeat(60))
console.log('Chain of Thought 实验 — 推理质量对比')
console.log('='.repeat(60))

await compare('纸张对折问题', REASONING_PROBLEM)
await compare('鸡兔同笼', MATH_WORD_PROBLEM)

console.log('\n' + '='.repeat(60))
console.log('观察要点：')
console.log('  - 直接回答：模型跳过推理步骤，容易出错')
console.log('  - CoT：让模型把推理过程写出来，强迫它"算"而不是"猜"')
console.log('  - CoT 在复杂推理、数学、逻辑题上提升最明显')
console.log('  - 简单问题不需要 CoT，会增加不必要的 Token 消耗')
console.log('='.repeat(60))
