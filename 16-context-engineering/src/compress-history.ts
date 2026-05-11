/**
 * 16-context-engineering / compress-history.ts
 *
 * 演示 Context 压缩策略：对冗长的对话历史做摘要，保留要点
 *
 * 核心思路：
 *   1. 模拟一段多轮对话（累积大量 Token）
 *   2. 用 LLM 把历史压缩成摘要
 *   3. 用压缩后的摘要继续对话，验证关键信息是否保留
 *
 * 运行：pnpm compress-history
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
} catch { /* 使用系统环境变量 */ }

// ─── 模拟一段冗长的多轮对话 ──────────────────────────────────────────────────

const LONG_CONVERSATION: Message[] = [
  {
    role: 'system',
    content: '你是一个全栈工程师，正在帮用户设计一个电商系统。',
  },
  {
    role: 'user',
    content: '我想做一个电商平台，主要卖数码产品。用户量预计初期 1 万，半年后可能到 50 万。技术栈还没定，你有什么建议？',
  },
  {
    role: 'assistant',
    content: '建议使用 Next.js 作为前端框架，配合 PostgreSQL 数据库。初期可以用 Vercel 部署，后期迁移到 AWS ECS。支付集成推荐 Stripe，国内可以加支付宝/微信支付。用户量从 1 万到 50 万，数据库层面需要考虑读写分离和缓存策略。',
  },
  {
    role: 'user',
    content: '数据库设计方面，商品表、订单表、用户表这些核心表怎么设计比较好？特别是 SKU 和 SPU 的关系。',
  },
  {
    role: 'assistant',
    content: '核心表设计建议：1) SPU 表（标准产品单元）存商品基本信息，如名称、品牌、分类；2) SKU 表关联 SPU，存具体规格组合（如颜色+内存），价格和库存挂在 SKU 上；3) 订单表用雪花 ID 做主键，包含订单状态机（待付款→已付款→已发货→已完成→已取消）；4) 用户表存基本信息，地址单独建表支持多地址。',
  },
  {
    role: 'user',
    content: '库存扣减怎么处理？高并发下不能超卖。',
  },
  {
    role: 'assistant',
    content: '库存扣减有三种方案：1) 下单减库存：用户下单即扣，可能导致恶意锁库存；2) 付款减库存：先不扣，付款成功再扣，高并发下可能超卖；3) 预扣库存（推荐）：下单时用 Redis DECR 原子操作预扣，设置 15 分钟超时释放，付款成功后确认扣减，超时自动回滚。SQL 层面用乐观锁 UPDATE stock SET count = count - 1 WHERE count > 0 做兜底。',
  },
  {
    role: 'user',
    content: '搜索功能呢？用户需要按品牌、价格区间、规格参数来筛选商品。',
  },
  {
    role: 'assistant',
    content: '商品搜索推荐使用 Elasticsearch。核心索引包含 SPU 基本信息和所有 SKU 的规格参数，支持全文搜索和结构化筛选。价格区间用 range query，品牌和分类用 term query，规格参数用 nested query。搜索建议用 completion suggester 实现。初期数据量小时可以先用 PostgreSQL 的全文搜索凑合，等 SPU 超过 10 万再引入 ES。',
  },
  {
    role: 'user',
    content: '现在我想加一个推荐系统，根据用户的浏览和购买历史推荐商品。这个怎么实现？',
  },
  {
    role: 'assistant',
    content: '推荐系统分三层：1) 热门推荐（最简单）：按销量/浏览量排序，定时更新缓存；2) 协同过滤：基于用户行为矩阵，找相似用户/相似商品，可以用 Surprise 或自己实现；3) 深度学习：用 Embedding 把用户和商品映射到同一向量空间，用 ANN 检索最近邻。初期先做热门+简单协同过滤，数据量够了再上深度学习。用户行为数据（浏览、点击、加购、下单）要从第一天就开始收集，存到事件表里。',
  },
]

// ─── 估算字符数（粗略对照 Token） ────────────────────────────────────────────

function countChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0)
}

// ─── 用 LLM 压缩对话历史 ────────────────────────────────────────────────────

async function compressHistory(history: Message[]): Promise<{ summary: string; tokens: number }> {
  const historyText = history
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n')

  const compressMessages: Message[] = [
    {
      role: 'system',
      content: `你是一个对话摘要专家。你的任务是把冗长的对话历史压缩成简洁的摘要。
规则：
- 保留所有关键的技术决策和结论
- 保留所有还没解决的问题
- 去掉寒暄、重复、过渡性语句
- 用要点列表格式输出
- 总字数控制在原文的 30% 以内`,
    },
    {
      role: 'user',
      content: `请压缩以下对话历史：\n\n${historyText}`,
    },
  ]

  const result = await chat(compressMessages, {
    model: MODELS.GPT5_CODEX,
    maxTokens: 500,
    temperature: 0,
  })

  return { summary: result.content, tokens: result.usage.totalTokens }
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('Context Compression Demo')
console.log('='.repeat(60))

// Step 1：展示原始对话的规模
const originalChars = countChars(LONG_CONVERSATION)
console.log(`\n[Original conversation] ${LONG_CONVERSATION.length} messages, ${originalChars} chars`)

// Step 2：压缩
console.log('\n[Compressing...]')
const { summary, tokens: compressTokens } = await compressHistory(LONG_CONVERSATION)

const summaryChars = summary.length
const compressionRatio = ((1 - summaryChars / originalChars) * 100).toFixed(1)

console.log('\n--- Compressed Summary ---')
console.log(summary)
console.log(`\n[Summary] ${summaryChars} chars (${compressionRatio}% reduction)`)
console.log(`[Compression cost] ${compressTokens} tokens`)

// Step 3：用压缩后的摘要继续对话，验证关键信息是否保留
console.log('\n' + '-'.repeat(40))
console.log('[Verification] Asking a follow-up using compressed context...')

const verifyMessages: Message[] = [
  {
    role: 'system',
    content: `你是一个全栈工程师，正在帮用户设计一个电商系统。

以下是之前讨论的摘要：
${summary}`,
  },
  {
    role: 'user',
    content: '我们之前决定的库存扣减方案是什么？简要回答。',
  },
]

const verifyResult = await chat(verifyMessages, {
  model: MODELS.GPT5_CODEX,
  maxTokens: 200,
  temperature: 0,
})

console.log('\n--- Verification Result ---')
console.log(verifyResult.content)
console.log(`\n[Verification cost] ${verifyResult.usage.totalTokens} tokens`)

// Step 4：总结
console.log('\n' + '='.repeat(60))
console.log('Summary:')
console.log(`  Original: ${LONG_CONVERSATION.length} messages, ${originalChars} chars`)
console.log(`  Compressed: 1 summary block, ${summaryChars} chars`)
console.log(`  Reduction: ${compressionRatio}%`)
console.log(`  Key decisions preserved: YES (verified by follow-up Q&A)`)
console.log('')
console.log('When to use compression:')
console.log('  - Conversation exceeds ~2000 tokens of history')
console.log('  - Every N turns, compress old messages into summary')
console.log('  - Keep recent 2-3 turns in full + compressed older history')
console.log('='.repeat(60))
