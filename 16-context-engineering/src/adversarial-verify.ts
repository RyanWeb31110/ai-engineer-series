/**
 * 16-context-engineering / adversarial-verify.ts
 *
 * 对抗验证模式（Adversarial Verification Pattern）
 *
 * 来源：《How To Be A World-Class Agentic Engineer》中的三角验证法
 * 原理：利用 Agent 的"讨好性"（Sycophancy），设计互相制衡的三个角色
 *
 *   Bug-Finder  → 激励找出所有潜在问题（偏向"有问题"）
 *   Adversarial → 激励推翻 Bug-Finder 的结论（偏向"没问题"）
 *   Referee     → 中立裁判，给出最终判断
 *
 * 适用场景：
 *   - 代码 Review（找 bug / 安全漏洞）
 *   - 方案评估（发现边界情况）
 *   - 事实核查（防止单 Agent 幻觉）
 *
 * 运行：pnpm adversarial-verify
 */

import { chat, MODELS } from '@ai-series/shared'
import type { Message, LLMConfig } from '@ai-series/shared'

// 简易重试包装：中转站偶尔返回空响应，重试 1 次
async function chatWithRetry(
  messages: Message[],
  config: LLMConfig,
): Promise<Awaited<ReturnType<typeof chat>>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chat(messages, config)
    } catch (err) {
      if (attempt === 2) throw err
      console.log(`[Retry] API call failed, retrying in ${(attempt + 1) * 2}s...`)
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000))
    }
  }
  throw new Error('Unreachable')
}

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
} catch { /* 使用系统环境变量 */ }

// ─── 待审查的代码 ─────────────────────────────────────────────────────────────
// 这段代码故意包含几个典型问题，用于演示三角验证

const CODE_TO_REVIEW = `
// 用户认证相关工具函数
import crypto from 'crypto'

export function hashPassword(password: string): string {
  // 用 MD5 生成密码哈希
  return crypto.createHash('md5').update(password).digest('hex')
}

export function generateToken(userId: string): string {
  // 生成用户 token
  const secret = 'my-secret-key'
  const payload = { userId, exp: Date.now() + 86400000 }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

export async function getUser(db: any, userId: string): Promise<any> {
  // 查询用户
  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`
  return await db.query(query)
}

export function isAdmin(user: any): boolean {
  return user.role == 'admin'
}
`

// ─── 问题评分标准 ────────────────────────────────────────────────────────────
// 利用"讨好性"设计积分激励，让 Bug-Finder 尽可能穷举所有问题

const SCORING_GUIDE = `
问题严重程度评分标准：
- 低危（+1分）：代码规范问题，不影响安全性
- 中危（+5分）：可能导致 bug 或性能问题
- 高危（+10分）：安全漏洞，可能被攻击者利用
`

// ─── Agent 1：Bug-Finder ──────────────────────────────────────────────────────

async function runBugFinder(code: string): Promise<{ findings: string; score: number }> {
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是一个安全专家和代码审查员。
${SCORING_GUIDE}
你的目标是找出所有可能的问题并获得尽可能高的分数。
对每个问题，明确标注严重程度和得分。
���后输出总分。
格式：
问题N（X分）：[问题描述]
...
总分：XX分`,
    },
    {
      role: 'user',
      content: `请审查以下代码，找出所有安全漏洞和代码质量问题：\n\n${code}`,
    },
  ]

  const result = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 600,
    temperature: 0.3,
  })

  // 从输出中提取总分
  const scoreMatch = result.content.match(/总分[：:]\s*(\d+)/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0

  return { findings: result.content, score }
}

// ─── Agent 2：Adversarial ────────────────────────────────���───────────────────

async function runAdversarial(
  code: string,
  findings: string,
): Promise<{ rebuttal: string; disputedCount: number }> {
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是一个怀疑主义的工程师，擅长反驳不成立的指控。
规则：
- 对每个"问题"，判断它是否是真实的、值得修复的问题
- 如果你成功推翻一个问题（证明它不是真正的问题），你获得该问题的分数
- 但如果你推翻错了（它其实是真问题），你扣 2 倍分数
- 所以要谨慎选择推翻哪些，不要盲目推翻所有
格式：
推翻N：[问题N] — [理由]（+X分 或 放弃推翻）
...
推翻总分：XX分`,
    },
    {
      role: 'user',
      content: `以下是对一段代码的审查报告，请判断哪些指控成立，哪些不成立：

【原始代码】
${code}

【审查报告】
${findings}`,
    },
  ]

  const result = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 500,
    temperature: 0.3,
  })

  // 统计推翻数量
  const disputedCount = (result.content.match(/推翻\d+/g) ?? []).length

  return { rebuttal: result.content, disputedCount }
}

// ─── Agent 3：Referee ────────────────────────────────────────────────────────

async function runReferee(
  code: string,
  findings: string,
  rebuttal: string,
): Promise<string> {
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是一个资深的代码安全裁判。
你手头有标准答案，对每个问题的判断：
- 判断正确（真问题判为真，假问题判为假）：+1分
- 判断错误：-1分
你的目标是给出最准确的最终裁定，所以你会仔细分析每个问题。
输出格式：
【最终裁定】
✅ 确认问题：[列出真实存在的问题，简要说明危害]
❌ 误报问题：[列出不成立的指控，说明原因]

【开发者行动建议】
[按优先级排列，最重要的修复项在前]`,
    },
    {
      role: 'user',
      content: `请对以下审查过程做出最终裁定：

【原始代码】
${code}

【Bug-Finder 报告】
${findings}

【Adversarial 反驳】
${rebuttal}`,
    },
  ]

  const result = await chatWithRetry(messages, {
    model: MODELS.GPT5_CODEX, // 裁判用更强的模型
    maxTokens: 700,
    temperature: 0,
  })

  return result.content
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('对抗验证模式（Adversarial Verification Pattern）')
console.log('三角制衡：Bug-Finder → Adversarial → Referee')
console.log('='.repeat(60))

console.log('\n【待审查代码】')
console.log(CODE_TO_REVIEW)

// Step 1: Bug-Finder
console.log('\n' + '-'.repeat(40))
console.log('Step 1 — Bug-Finder（激励穷举所有问题）')
console.log('-'.repeat(40))
const { findings, score: bugScore } = await runBugFinder(CODE_TO_REVIEW)
console.log(findings)
console.log(`\n→ Bug-Finder 总分: ${bugScore}（尽可能多地找问题）`)

// Step 2: Adversarial
console.log('\n' + '-'.repeat(40))
console.log('Step 2 — Adversarial（激励推翻不成立的指控）')
console.log('-'.repeat(40))
const { rebuttal, disputedCount } = await runAdversarial(CODE_TO_REVIEW, findings)
console.log(rebuttal)
console.log(`\n→ Adversarial 尝试推翻 ${disputedCount} 条`)

// Step 3: Referee
console.log('\n' + '-'.repeat(40))
console.log('Step 3 — Referee（中立裁判，最终裁定）')
console.log('-'.repeat(40))
const verdict = await runReferee(CODE_TO_REVIEW, findings, rebuttal)
console.log(verdict)

console.log('\n' + '='.repeat(60))
console.log('模式总结：')
console.log('  1. Bug-Finder 产出"问题超集"（宁可误报，不可漏报）')
console.log('  2. Adversarial 过滤误报（有惩罚机制，不会乱推翻）')
console.log('  3. Referee 做最终裁定（强模型 + 中立立场）')
console.log('  适用场景：代码 Review、方案评估、事实核查')
console.log('='.repeat(60))
