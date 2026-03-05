/**
 * 01-llm-basics / sampling.ts
 *
 * 演示 Temperature 和 Top-p 对生成结果的影响
 * 对应文章：《LLM 是怎么工作的：Token、Attention、采样》
 *
 * 运行：pnpm sampling
 * 前置：复制 .env.example 为 .env 并填入 API Key
 */

import { config } from 'process'
import { chat, MODELS } from '@ai-series/shared'
import type { LLMConfig } from '@ai-series/shared'

// 加载 .env（Node 22 原生支持 --env-file，tsx 需手动处理）
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
  // .env 不存在时跳过，使用系统环境变量
}

// ─── 实验配置 ─────────────────────────────────────────────────────────────────

const PROMPT = '用一句话描述量子纠缠'

/**
 * 不同采样参数的对比组
 * Temperature 越高 → 越随机；越低 → 越确定
 */
const EXPERIMENTS: Array<{ label: string; config: LLMConfig }> = [
  {
    label: 'Greedy (temperature=0)',
    config: { model: MODELS.CLAUDE_HAIKU, maxTokens: 100, temperature: 0 },
  },
  {
    label: 'Balanced (temperature=0.7)',
    config: { model: MODELS.CLAUDE_HAIKU, maxTokens: 100, temperature: 0.7 },
  },
  {
    label: 'Creative (temperature=1.2)',
    config: { model: MODELS.CLAUDE_HAIKU, maxTokens: 100, temperature: 1.2 },
  },
  {
    label: 'Top-p only (temperature=1, top_p=0.1)',
    config: { model: MODELS.CLAUDE_HAIKU, maxTokens: 100, temperature: 1, topP: 0.1 },
  },
]

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('采样参数实验 — Temperature vs Top-p')
console.log(`提问：${PROMPT}`)
console.log('='.repeat(60))
console.log('(每组参数调用 3 次，观察结果的一致性 / 多样性)\n')

for (const exp of EXPERIMENTS) {
  console.log(`\n【${exp.label}】`)

  // 每组跑 3 次
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await chat([{ role: 'user', content: PROMPT }], exp.config)
      console.log(`  第${i}次: ${res.content.trim()}`)
    } catch (err) {
      console.error(`  第${i}次失败:`, err instanceof Error ? err.message : err)
    }
  }
}

console.log('\n' + '='.repeat(60))
console.log('观察要点：')
console.log('  - temperature=0：每次结果几乎相同（确定性输出）')
console.log('  - temperature=0.7：有变化但语义稳定（推荐默认值）')
console.log('  - temperature>1：结果多样，偶尔出现奇怪表达')
console.log('  - top_p=0.1：只从最高概率的 10% token 中采样，比 temp=0 略多样')
console.log('='.repeat(60))
