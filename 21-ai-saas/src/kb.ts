// 迷你知识库：用于演示 SaaS pipeline 中的检索阶段
// 本文件不引入向量数据库依赖，采用"关键词倒排 + TF 打分"的轻量检索，
// 原理和生产级 RAG 一致（参考第 06/07 篇），只是存储层被压缩到内存
// kb.ts 直接运行可以看到 3 个示例 query 的检索结果

export interface KbDoc {
  id: string
  title: string
  /** 知识库片段来源，便于前端展示引用 */
  source: string
  content: string
}

// 内联一份客服场景的知识库：退换、物流、质保、会员权益
export const KB: KbDoc[] = [
  {
    id: 'return-policy',
    title: '退换货政策',
    source: 'policy/return.md',
    content: `未拆封商品 30 天内可无理由退货，原路退款 5 个工作日内到账。
已拆封电子产品 14 天内且保留完整包装可退货。
定制商品除质量问题外不支持退货。`,
  },
  {
    id: 'shipping-policy',
    title: '物流与配送',
    source: 'policy/shipping.md',
    content: `标准快递 3-5 个工作日，订单满 99 元免运费。
加急快递 1-2 个工作日到货，统一收取 25 元运费。
每日 15:00 之后的订单顺延到次日发货。`,
  },
  {
    id: 'warranty',
    title: '质保服务',
    source: 'policy/warranty.md',
    content: `电子产品整机质保 12 个月，非人为损坏免费维修。
服装类商品 30 天内如有做工瑕疵可换货。
申请质保请提供订单号和故障照片，客服会在 24 小时内联系。`,
  },
  {
    id: 'membership',
    title: '会员权益',
    source: 'policy/vip.md',
    content: `金卡会员享 9 折优惠、免邮特权、生日礼金。
白金会员额外赠送 4 次加急快递次数及专属客服。
会员等级按累计消费金额每月 1 日重新结算。`,
  },
  {
    id: 'refund-timeline',
    title: '退款到账时效',
    source: 'policy/refund.md',
    content: `微信/支付宝支付：1-3 个工作日原路退回。
银行卡支付：3-5 个工作日原路退回。
礼品卡支付：退款会返回礼品卡余额，可再次消费。`,
  },
]

// 中英文混合分词的粗糙实现：按非字母数字切分，保留长度大于 1 的词
// 生产环境应替换为 jieba / pkuseg 等专业分词库
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase()
  const chunks = normalized.split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean)
  const tokens: string[] = []
  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/.test(chunk)) {
      tokens.push(chunk)
    } else {
      // 中文连续串：做 uni-gram + bi-gram，兼顾单字匹配与短语匹配
      for (let i = 0; i < chunk.length; i++) {
        tokens.push(chunk[i])
        if (i + 2 <= chunk.length) tokens.push(chunk.slice(i, i + 2))
      }
    }
  }
  return tokens
}

export interface KbHit {
  doc: KbDoc
  score: number
  matched: string[]
}

/**
 * 关键词打分检索：命中一次计 1 分，同一关键词命中多次按 log 平滑
 * 返回按分数降序排序的 Top N
 */
export function retrieve(query: string, topK = 2): KbHit[] {
  const queryTokens = new Set(tokenize(query))
  const hits: KbHit[] = []

  for (const doc of KB) {
    const docTokens = tokenize(doc.title + ' ' + doc.content)
    const freq = new Map<string, number>()
    for (const t of docTokens) {
      if (queryTokens.has(t)) {
        freq.set(t, (freq.get(t) ?? 0) + 1)
      }
    }
    if (freq.size === 0) continue

    let score = 0
    for (const [, count] of freq) {
      score += 1 + Math.log(count)
    }
    hits.push({ doc, score, matched: [...freq.keys()] })
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, topK)
}

/**
 * 把检索结果拼接成可以直接塞进 system prompt 的上下文块
 * 每个片段前加 [source] 便于 LLM 引用来源
 */
export function buildContextBlock(hits: KbHit[]): string {
  if (hits.length === 0) return '（未检索到相关知识库内容，按通用常识作答并提示用户联系人工）'
  return hits
    .map((h) => `[${h.doc.source}] ${h.doc.title}\n${h.doc.content}`)
    .join('\n\n')
}

// 直接运行本文件时的演示
async function main(): Promise<void> {
  const QUERIES = [
    '买了 15 天的耳机能退吗？',
    '加急快递多久能到',
    '金卡会员有什么特权',
  ]

  console.log('=== KB Retrieval Demo ===\n')
  for (const q of QUERIES) {
    const hits = retrieve(q, 2)
    console.log(`[query] ${q}`)
    for (const h of hits) {
      console.log(`  - ${h.doc.title}  score=${h.score.toFixed(2)}  source=${h.doc.source}`)
      console.log(`    matched: ${h.matched.slice(0, 6).join(', ')}`)
    }
    console.log()
  }
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  main().catch((err) => {
    console.error('kb demo failed:', err)
    process.exit(1)
  })
}
