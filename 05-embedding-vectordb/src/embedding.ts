/**
 * Embedding 基础示例
 *
 * 演示：
 * 1. 调用 OpenAI Embedding API 把文本转成向量
 * 2. 用余弦相似度计算两段文本的语义距离
 * 3. 直观感受哪些句子"语义接近"
 *
 * 运行：pnpm embed
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'

// 加载 .env
const dotenvPath = new URL('../.env', import.meta.url).pathname
try {
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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

// ─── 向量工具函数 ──────────────────────────────────────────────────────────────

/**
 * 把文本转成 embedding 向量。
 * text-embedding-3-small 是 OpenAI 当前性价比最高的嵌入模型，
 * 默认输出 1536 维浮点数向量。
 */
async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

/**
 * 余弦相似度：衡量两个向量方向的接近程度。
 * 结果范围 [-1, 1]，值越大表示语义越接近。
 * 实际中文本相似度通常在 [0, 1] 之间。
 */
function cosineSimilarity(a: number[], b: number[]): number {
  // 点积
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  // 各自的模
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return dot / (normA * normB)
}

/**
 * 格式化相似度分数，带直觉性描述。
 */
function describeScore(score: number): string {
  if (score > 0.9) return `${score.toFixed(4)} （非常相似）`
  if (score > 0.7) return `${score.toFixed(4)} （比较相似）`
  if (score > 0.5) return `${score.toFixed(4)} （有一定关联）`
  return `${score.toFixed(4)} （差异明显）`
}

// ─── 实验一：语义相似度直觉 ──────────────────────────────────────────────────

/**
 * 选取 6 个句子，两两对比，观察哪些"语义近"、哪些"语义远"。
 */
async function experimentSimilarity(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('实验一：语义相似度直觉')
  console.log('='.repeat(60))

  const sentences = [
    '今天天气真好，阳光明媚',
    '今日天空晴朗，阳光充足',      // 语义极近
    '明天会下雨，记得带伞',         // 同领域但内容不同
    '机器学习是人工智能的一个分支', // 话题完全不同
    '深度学习依赖大量训练数据',     // 与上一句领域相近
    '我今天吃了一碗面条',           // 无关话题
  ]

  // 批量获取所有句子的向量
  console.log('正在生成 embedding 向量...')
  const embeddings = await Promise.all(sentences.map(embed))
  console.log(`每个向量维度：${embeddings[0].length}`)

  // 以第一句为基准，和其他句子对比
  const base = sentences[0]
  const baseEmbed = embeddings[0]
  console.log(`\n基准句子: "${base}"`)
  console.log('-'.repeat(50))

  for (let i = 1; i < sentences.length; i++) {
    const score = cosineSimilarity(baseEmbed, embeddings[i])
    console.log(`vs "${sentences[i]}"`)
    console.log(`   相似度: ${describeScore(score)}`)
  }
}

// ─── 实验二：中英文跨语言对齐 ────────────────────────────────────────────────

/**
 * text-embedding-3-small 支持多语言，
 * 测试同一个意思的中英文是否能被对齐到相近的向量空间。
 */
async function experimentCrossLingual(): Promise<void> {
  console.log('\n' + '='.repeat(60))
  console.log('实验二：中英文跨语言语义对齐')
  console.log('='.repeat(60))

  const pairs: Array<[string, string]> = [
    ['猫喜欢睡觉', 'Cats love to sleep'],
    ['如何优化数据库查询性能', 'How to optimize database query performance'],
    ['今天股市大跌', 'The stock market crashed today'],
  ]

  for (const [cn, en] of pairs) {
    const [cnEmbed, enEmbed] = await Promise.all([embed(cn), embed(en)])
    const score = cosineSimilarity(cnEmbed, enEmbed)
    console.log(`\n中: "${cn}"`)
    console.log(`英: "${en}"`)
    console.log(`跨语言相似度: ${describeScore(score)}`)
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await experimentSimilarity()
  await experimentCrossLingual()

  console.log('\n' + '='.repeat(60))
  console.log('提示：可以修改句子内容，观察相似度的变化规律')
  console.log('='.repeat(60))
}

main().catch(console.error)
