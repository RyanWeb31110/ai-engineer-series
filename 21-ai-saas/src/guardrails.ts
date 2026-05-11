// 输入/输出护栏：过滤明显的 Prompt 注入与敏感内容
// 生产级实现请参考第 19 篇 Guardrails，本文件只保留最核心的正则层

export interface GuardResult {
  allowed: boolean
  reason?: string
  matched?: string[]
}

// 输入护栏：屏蔽常见的越狱、指令注入、泄漏 system prompt 企图
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /forget\s+(all\s+)?previous/i,
  /show\s+me\s+(your\s+)?(system\s+)?prompt/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /reset\s+your\s+rules/i,
  /disregard\s+(all\s+)?rules/i,
  /重置你的(规则|设定|角色)/,
  /忽略(之前|前面)的(指令|要求|规则)/,
  /展示你的(系统)?(提示词|prompt)/,
  /告诉我你的(系统)?(提示词|prompt)/,
]

// 业务越界：在客服场景里拒答与业务无关的高风险请求
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /怎么(制作|制造|合成)(炸药|毒品|武器)/,
  /how\s+to\s+make\s+(a\s+)?(bomb|weapon|drug)/i,
]

export function guardInput(text: string): GuardResult {
  const matched: string[] = []
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) matched.push(`injection:${re.source.slice(0, 30)}`)
  }
  for (const re of OFF_TOPIC_PATTERNS) {
    if (re.test(text)) matched.push(`off-topic:${re.source.slice(0, 30)}`)
  }
  if (matched.length > 0) {
    return { allowed: false, reason: 'input-guard-block', matched }
  }
  return { allowed: true }
}

// 输出护栏：脱敏明显的 PII（邮箱、手机号、身份证号）
// 避免模型把知识库里偶然出现的真实联系方式回吐给用户
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /\b1[3-9]\d{9}\b/g
const ID_RE = /\b\d{15}(\d{2}[0-9Xx])?\b/g

export function redactPII(text: string): { redacted: string, hits: number } {
  let hits = 0
  let out = text.replace(EMAIL_RE, () => {
    hits++
    return '[email-redacted]'
  })
  out = out.replace(PHONE_RE, () => {
    hits++
    return '[phone-redacted]'
  })
  out = out.replace(ID_RE, () => {
    hits++
    return '[id-redacted]'
  })
  return { redacted: out, hits }
}
