/**
 * 16-context-engineering / context-demo.ts
 *
 * 演示 Context 污染 vs 精确 Context 的实际效果差异
 * 对应文章：《Context Engineering：在有限空间里装最多价值》
 *
 * 核心原则（来自 Anthropic 四策略）：
 *   Write   → 信息写到外部存储，不占窗口
 *   Select  → 只把当前任务需要的内容拉进来
 *   Compress → 对历史做摘要，保留要点
 *   Isolate  → 大任务拆子 Agent，各自独立 Context
 *
 * 运行：pnpm context-demo
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
} catch { /* ���用系统环境变量 */ }

// ─── 实验 1：Context 污染 ─────────────────────────────────────────────────────
//
// 模拟"什么都塞进来"的反模式：
// 一个简单的"给函数写单测"任务，却带着大量不相关的历史 Context

const POLLUTED_MESSAGES: Message[] = [
  {
    role: 'system',
    content: `你是一个 AI 助手。
用户之前在做数据库迁移，遇到了 PostgreSQL 连接池耗尽的问题。
用户之前还在研究 Redis 缓存穿透的方案。
用户之前讨论过 Kubernetes HPA 的配置。
用户之前问过 Stripe Webhook 签名验证的问题。
用户之前在分析 AWS S3 存储成本优化方案。
现在用户需要写代码。`,
  },
  {
    role: 'user',
    content: `帮我给这个函数写单测：

function add(a: number, b: number): number {
  return a + b
}`,
  },
]

// ─── 实验 2：精确 Context ─────────────────────────────────────────────────────
//
// 只注入当前任务需要的信息，完全不提无关背景

const CLEAN_MESSAGES: Message[] = [
  {
    role: 'system',
    content: '你是一个 TypeScript 工程师，擅长写单元测试。使用 Vitest 框架，测试要覆盖正常情况和边界情况。',
  },
  {
    role: 'user',
    content: `帮我给这个函数写单测：

function add(a: number, b: number): number {
  return a + b
}`,
  },
]

// ─── 实验 3：研究与实现分离 ───────────────────────────────────────────────────
//
// 演示"先让 Agent 研究，再用独立 Context 实现"的正确工作流
// 对应文章观点：不要说"帮我实现一个 auth 系统"，而要先研究再用干净 Context 实现

async function demonstrateResearchThenImplement(): Promise<void> {
  console.log('\n【实验 3：研究与实现分离】')
  console.log('错误做法：直接说"帮我做个 auth 系统"')
  console.log('正确做法：先研究 → 选型确认 → 干净 Context 实现\n')

  // Step 1：研究阶段（宽 Context，探索用）
  const researchMessages: Message[] = [
    {
      role: 'user',
      content: `我需要在 Next.js 16 应用里实现用户认证。
请简要对比以下方案的适用场景（每项 2-3 句话即可）：
1. NextAuth.js (Auth.js)
2. Clerk
3. 手写 JWT + bcrypt
不需要写代码，只需要给出选型建议。`,
    },
  ]

  console.log('Step 1 — 研究阶段（探索 3 种方案）:')
  const researchResult = await chat(researchMessages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 400,
    temperature: 0.3,
  })
  console.log(researchResult.content)
  console.log(`\n[研究阶段 Token 消耗: ${researchResult.usage.totalTokens}]`)

  // Step 2：确认选型后，用全新 Context 实现（不带研究阶段的噪音）
  console.log('\nStep 2 — 实现阶段（假设已选定 NextAuth.js，全新 Context）:')
  const implementMessages: Message[] = [
    {
      role: 'system',
      content: '你是一个 Next.js 16 工程师，使用 App Router。',
    },
    {
      role: 'user',
      content: `实现 NextAuth.js v5 的 Google OAuth 登录。
只需要给出 auth.ts 配置文件的核心代码，不超过 30 行。`,
    },
  ]

  const implementResult = await chat(implementMessages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 400,
    temperature: 0,
  })
  console.log(implementResult.content)
  console.log(`\n[实现阶段 Token 消耗: ${implementResult.usage.totalTokens}]`)
  console.log(`总消耗: ${researchResult.usage.totalTokens + implementResult.usage.totalTokens} tokens`)
  console.log('→ 两阶段分离，实现阶段的 Context 完全聚焦，不被研究噪音干扰')
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('Context Engineering 演示')
console.log('核心原则：给 Agent 恰好够用的信息，不多也不少')
console.log('='.repeat(60))

// 实验 1 vs 2：对比 Context 污染
console.log('\n【实验 1 vs 2：Context 污染 vs 精确 Context】')
console.log('任务：给 add(a, b) 函数写单测\n')

const pollutedResult = await chat(POLLUTED_MESSAGES, { model: MODELS.GPT5_CODEX, maxTokens: 300, temperature: 0 })
const cleanResult = await chat(CLEAN_MESSAGES, { model: MODELS.GPT5_CODEX, maxTokens: 300, temperature: 0 })

console.log('--- 污染 Context 的输出 ---')
console.log(pollutedResult.content)
console.log(`\nToken 消耗: ${pollutedResult.usage.totalTokens}`)

console.log('\n--- 精确 Context 的输出 ---')
console.log(cleanResult.content)
console.log(`\nToken 消耗: ${cleanResult.usage.totalTokens}`)

console.log(`\n节省 Token: ${pollutedResult.usage.totalTokens - cleanResult.usage.totalTokens}`)
console.log('→ 精确 Context 不仅更省钱，输出质量也更聚焦')

// 实验 3：研究与实现分离
await demonstrateResearchThenImplement()

console.log('\n' + '='.repeat(60))
console.log('Context Engineering 四策略回顾:')
console.log('  Write   → 把信息存到外部（文件/DB），不占窗口')
console.log('  Select  → 只拉当前任务相关的内容进来')
console.log('  Compress → 对历史做摘要，保留要点丢弃细节')
console.log('  Isolate  → 子任务用独立 Agent，各自持有最小 Context')
console.log('='.repeat(60))
