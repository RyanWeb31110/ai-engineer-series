/**
 * 02-prompt-engineering / prompt-basics.ts
 *
 * 演示 System Prompt、Few-shot 示例、角色扮演等基础技巧的效果对比
 * 对应文章：《Prompt Engineering：和 LLM 说话的艺术》
 *
 * 运行：pnpm basics
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

// ─── 实验 1：无 System Prompt vs 有 System Prompt ────────────────────────────

const USER_QUESTION = '帮我写一个 Python 函数，计算列表中所有偶数的和'

console.log('='.repeat(60))
console.log('实验 1：System Prompt 的效果')
console.log(`用户提问：${USER_QUESTION}`)
console.log('='.repeat(60))

// 无 System Prompt
{
  const messages: Message[] = [{ role: 'user', content: USER_QUESTION }]
  const res = await chat(messages, { model: MODELS.GPT5_CODEX, maxTokens: 300, temperature: 0 })
  console.log('\n【无 System Prompt】')
  console.log(res.content)
}

// 有 System Prompt（指定输出风格）
{
  const messages: Message[] = [{ role: 'user', content: USER_QUESTION }]
  const res = await chat(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 300,
    temperature: 0,
    // 通过 System Prompt 约束：只给代码，不要解释
    systemPrompt: '你是一个 Python 专家。用户提问时，直接给出简洁的代码，不加任何解释或说明。',
  })
  console.log('\n【有 System Prompt：只给代码】')
  console.log(res.content)
}

// ─── 实验 2：Zero-shot vs Few-shot ──────────────────────────────────────────

const SENTIMENT_TASK = '这个产品真的太棒了，超出了我的预期！'

console.log('\n' + '='.repeat(60))
console.log('实验 2：Zero-shot vs Few-shot 情感分类')
console.log(`输入文本：${SENTIMENT_TASK}`)
console.log('='.repeat(60))

// Zero-shot：直接问
{
  const messages: Message[] = [
    {
      role: 'user',
      content: `判断以下文本的情感倾向，只回答"正面"、"负面"或"中性"：\n${SENTIMENT_TASK}`,
    },
  ]
  const res = await chat(messages, { model: MODELS.GPT5_CODEX, maxTokens: 10, temperature: 0 })
  console.log('\n【Zero-shot】')
  console.log(res.content)
}

// Few-shot：给几个示例，模型能更准确地理解输出格式
{
  const messages: Message[] = [
    {
      role: 'user',
      content: `判断以下文本的情感倾向，只回答"正面"、"负面"或"中性"。

示例：
文本：物流很慢，等了一周才到。→ 负面
文本：价格合理，性价比不错。→ 正面
文本：包装很普通，没什么特别。→ 中性

现在判断：
文本：${SENTIMENT_TASK}→`,
    },
  ]
  const res = await chat(messages, { model: MODELS.GPT5_CODEX, maxTokens: 10, temperature: 0 })
  console.log('\n【Few-shot（3 个示例）】')
  console.log(res.content)
}

// ─── 实验 3：角色扮演（Persona）──────────────────────────────────────────────

const EXPLAIN_TASK = '什么是递归？'

console.log('\n' + '='.repeat(60))
console.log('实验 3：不同角色对解释方式的影响')
console.log(`问题：${EXPLAIN_TASK}`)
console.log('='.repeat(60))

const personas = [
  { label: '普通回答', system: undefined },
  {
    label: '面向小学生解释',
    system: '你在跟一个 10 岁的小学生聊天，用简单易懂的话解释技术概念，多用生活中的比喻。',
  },
  {
    label: '面向有经验的程序员',
    system: '你在和一个有 5 年工作经验的程序员聊天，直接说技术本质，不需要绕弯子。',
  },
]

for (const { label, system } of personas) {
  const messages: Message[] = [{ role: 'user', content: EXPLAIN_TASK }]
  const res = await chat(messages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 150,
    temperature: 0.3,
    ...(system ? { systemPrompt: system } : {}),
  })
  console.log(`\n【${label}】`)
  console.log(res.content.trim())
}

console.log('\n' + '='.repeat(60))
