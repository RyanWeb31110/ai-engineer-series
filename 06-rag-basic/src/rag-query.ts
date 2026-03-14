/**
 * RAG 查询演示
 *
 * 演示：
 * 1. 构建知识库索引
 * 2. 向量检索：把问题 embed 后找最相关的文档
 * 3. 加相似度门槛过滤噪声（threshold）
 * 4. 把检索结果拼进 system prompt，让 LLM 基于上下文回答
 * 5. 来源引用：回答时附上文档出处
 *
 * 运行：pnpm query
 */

import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { buildIndex, embed, InMemoryVectorDB } from './build-index.js'

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

const MODEL = 'gpt-5.2-codex'

// ─── RAG System Prompt ─────────────────────────────────────────────────────────

/**
 * 良好的 RAG system prompt 要点：
 * 1. 明确角色和知识来源边界
 * 2. 告诉模型：知识库没有的内容不要编造
 * 3. 要求引用来源（方便用户核实）
 */
const SYSTEM_PROMPT_TEMPLATE = (context: string) => `你是一个技术支持助手，专门解答关于我们平台的问题。

请严格根据以下知识库内容回答用户问题：
- 如果知识库中有明确答案，直接引用相关内容回答
- 如果知识库中没有相关信息，回答"这个问题超出了我的知识库范围，建议联系技术支持"
- 不要凭空推断或编造不在知识库中的内容
- 回答结束后，用"参考来源：[文档分类] 文档标题"格式标注出处

知识库内容：
${context}`

// ─── RAG 查询流程 ──────────────────────────────────────────────────────────────

/**
 * 完整的 RAG 查询流程：
 * 1. 把用户问题 embed
 * 2. 向量检索 Top-K（带相似度门槛）
 * 3. 格式化检索结果为上下文
 * 4. 拼入 system prompt 调用 LLM
 * 5. 打印结果（带相似度分数，方便调试）
 */
async function ragQuery(db: InMemoryVectorDB, question: string): Promise<void> {
  console.log('\n' + '─'.repeat(60))
  console.log(`问题: ${question}`)
  console.log('─'.repeat(60))

  // 步骤 1：把问题转成向量（同步）
  const queryEmbedding = embed(question)

  // 步骤 2：向量检索，相似度低于 0.15 的结果会被过滤掉
  // 注意：TF-IDF 向量的相似度范围与神经网络 embedding 不同，有效匹配通常在 0.15~0.6 之间
  const results = db.search(queryEmbedding, 3, 0.15)

  if (results.length === 0) {
    console.log('向量检索：未找到相关文档（相似度均低于门槛值 0.15）')
    console.log('回答: 这个问题超出了我的知识库范围，建议联系技术支持。')
    return
  }

  // 打印检索结果（调试用）
  console.log(`\n向量检索结果（相似度 ≥ 0.15，共 ${results.length} 条）:`)
  for (const { record, score } of results) {
    console.log(`  [${score.toFixed(4)}] [${record.category}] ${record.title}`)
  }

  // 步骤 3：把检索结果格式化为上下文
  const context = results
    .map(({ record }) => `[${record.category}] ${record.title}\n${record.content}`)
    .join('\n\n---\n\n')

  // 步骤 4：带上下文调用 LLM
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_TEMPLATE(context) },
      { role: 'user', content: question },
    ],
  })

  console.log(`\n回答:\n${response.choices[0].message.content}`)
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 构建知识库索引（真实场景中只需要构建一次）
  const db = new InMemoryVectorDB()
  buildIndex(db)

  // 几个测试问题，覆盖：命中、边缘命中、知识库外
  const questions = [
    '服务器配置要求是什么？',
    '如何申请退款？',
    '遇到 429 错误怎么办？',
    '启动时服务一直报 connection refused，如何排查？',
    '支持微信支付吗？', // 知识库中没有这个信息
  ]

  for (const question of questions) {
    await ragQuery(db, question)
  }
}

main().catch(console.error)
