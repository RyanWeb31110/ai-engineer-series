/**
 * 03-structured-output / tool-use.ts
 *
 * 演示用 Function Calling（工具调用）实现可靠结构化输出：
 * 定义一个「假工具」，其参数 schema 就是我们想要的数据结构，
 * 让模型强制按 schema 填参数，从而保证输出合法且字段完整。
 *
 * 对应文章：《结构化输出：让 AI 的回答变成程序能读的数据》
 *
 * 运行：pnpm tool-use
 * 前置：复制 .env.example 为 .env 并填入 API Key
 */

import OpenAI from 'openai'

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

interface ProductReview {
  product: string
  rating: number
  sentiment: 'positive' | 'negative' | 'neutral'
  summary: string
  pros: string[]
  cons: string[]
}

// ─── 测试文本（与 naive-json.ts 相同）────────────────────────────────────────

const REVIEW_TEXT = `
买了这款机械键盘用了两周，打字手感确实不错，段落感清晰，长时间码字也不累。
RGB 灯效很好看，支持自定义。但是噪音比较大，在办公室用有点尴尬，
同事反映有些吵。另外连接蓝牙偶尔会断连，需要重新配对。
整体来说性价比还可以，如果是在家用的话推荐入手，评分给 4 分。
`

// ─── Function Calling：把 schema 定义成工具参数 ───────────────────────────────

/**
 * 「假工具」：我们不真正执行这个工具，
 * 只是借用 function calling 机制让模型按 schema 填参数。
 * 这是 OpenAI 推荐的结构化输出方式之一。
 */
const EXTRACT_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_review',
    description: '从商品评价文本中提取结构化信息',
    parameters: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          description: '商品名称，从评价中推断',
        },
        rating: {
          type: 'number',
          description: '评分，1-5 的整数',
          minimum: 1,
          maximum: 5,
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
          description: '整体情感倾向',
        },
        summary: {
          type: 'string',
          description: '一句话总结这条评价',
        },
        pros: {
          type: 'array',
          items: { type: 'string' },
          description: '优点列表，每项一句话',
        },
        cons: {
          type: 'array',
          items: { type: 'string' },
          description: '缺点列表，每项一句话',
        },
      },
      required: ['product', 'rating', 'sentiment', 'summary', 'pros', 'cons'],
    },
  },
}

// ─── 调用 OpenAI API ──────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

const client = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL,
})

console.log('='.repeat(60))
console.log('方法 2：Function Calling 法（用工具参数 schema 约束输出）')
console.log('='.repeat(60))

const response = await client.chat.completions.create({
  model: 'gpt-5.2-codex',
  max_tokens: 1024,
  tools: [EXTRACT_TOOL],
  // tool_choice 强制模型必须调用工具，不能自由回答
  tool_choice: 'required',
  messages: [
    {
      role: 'user',
      content: `请从以下商品评价中提取结构化信息：\n\n${REVIEW_TEXT}`,
    },
  ],
})

// 从响应中取出工具调用参数
const toolCall = response.choices[0]?.message.tool_calls?.[0]
if (!toolCall || toolCall.type !== 'function') {
  throw new Error('模型没有调用工具，检查 tool_choice 配置')
}

// 参数是 JSON 字符串，需要 parse 一次，但格式由 schema 保证
const result = JSON.parse(toolCall.function.arguments) as ProductReview

console.log('\n【提取结果】')
console.log(JSON.stringify(result, null, 2))

console.log('\n【字段验证】')
console.log(`product:   ${result.product} (${typeof result.product})`)
console.log(`rating:    ${result.rating} (${typeof result.rating}) ← 保证是 number`)
console.log(`sentiment: ${result.sentiment} ← 保证是枚举值之一`)
console.log(`pros:      ${Array.isArray(result.pros) ? `array[${result.pros.length}]` : '非数组'} ← 保证是数组`)
console.log(`cons:      ${Array.isArray(result.cons) ? `array[${result.cons.length}]` : '非数组'}`)

console.log('\n' + '='.repeat(60))
console.log('观察要点：')
console.log('  - arguments 是合法 JSON 字符串，parse 不会失败')
console.log('  - rating 一定是 number，不会是字符串 "4"')
console.log('  - sentiment 一定是枚举值，不会出现 "mostly positive"')
console.log('  - required 字段保证存在，不会缺失')
console.log('  - tool_choice 强制调用，避免模型回答文字')
console.log('='.repeat(60))
