/**
 * 03-structured-output / naive-json.ts
 *
 * 演示「朴素提示法」提取 JSON 的问题：
 * 在 Prompt 里要求输出 JSON，但无法保证格式合法，
 * 也无法保证字段齐全。
 *
 * 对应文章：《结构化输出：让 AI 的回答变成程序能读的数据》
 *
 * 运行：pnpm naive
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

// ─── 目标数据结构 ────────────────────────────────────────────────────────────

/**
 * 我们期望从文本中提取出来的结构
 */
interface ProductReview {
  product: string
  rating: number       // 1-5
  sentiment: 'positive' | 'negative' | 'neutral'
  summary: string
  pros: string[]
  cons: string[]
}

// ─── 测试文本 ────────────────────────────────────────────────────────────────

const REVIEW_TEXT = `
买了这款机械键盘用了两周，打字手感确实不错，段落感清晰，长时间码字也不累。
RGB 灯效很好看，支持自定义。但是噪音比较大，在办公室用有点尴尬，
同事反映有些吵。另外连接蓝牙偶尔会断连，需要重新配对。
整体来说性价比还可以，如果是在家用的话推荐入手，评分给 4 分。
`

// ─── 方法 1：朴素提示 ────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('方法 1：朴素提示法（在 Prompt 里要求输出 JSON）')
console.log('='.repeat(60))

{
  const messages: Message[] = [
    {
      role: 'user',
      content: `请从以下商品评价中提取信息，以 JSON 格式输出，包含字段：
product（商品名）、rating（评分1-5）、sentiment（positive/negative/neutral）、
summary（一句话总结）、pros（优点数组）、cons（缺点数组）。

评价内容：
${REVIEW_TEXT}

直接输出 JSON，不要加任何解释。`,
    },
  ]

  const res = await chat(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 500,
    temperature: 0,
  })

  console.log('\n【原始输出】')
  console.log(res.content)

  // 尝试解析，观察问题
  console.log('\n【尝试 JSON.parse】')
  try {
    // 有时候模型会在 JSON 前后包裹 ```json ... ```，需要手动清理
    const cleaned = res.content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned) as ProductReview
    console.log('解析成功：', parsed)
    console.log(`rating 类型：${typeof parsed.rating}（期望 number）`)
    console.log(`pros 类型：${Array.isArray(parsed.pros) ? 'array' : typeof parsed.pros}`)
  } catch (e) {
    console.error('解析失败：', e instanceof Error ? e.message : e)
    console.log('→ 朴素提示法的问题：输出格式不可控，JSON 可能被 markdown 包裹或字段缺失')
  }
}

console.log('\n' + '='.repeat(60))
console.log('观察要点：')
console.log('  - 模型可能在 JSON 外包裹 ```json 代码块，直接 parse 会报错')
console.log('  - 字段类型不保证（rating 可能是字符串 "4" 而不是数字 4）')
console.log('  - 字段名可能与约定不一致（如 "score" 代替 "rating"）')
console.log('  - 复杂 schema 时遗漏字段的概率更高')
console.log('='.repeat(60))
