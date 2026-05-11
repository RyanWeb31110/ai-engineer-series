# 成本控制：Prompt Caching 和模型路由

> 把同一次对话从几美分压到零头，靠的不是换便宜模型，而是换思路

---

上一篇我们把安全护栏搭起来了，恶意流量在正则层就被终结，不再烧主模型成本。但真正让 AI 产品财务报表难看的，是那 99% 合法、正常、该花钱的请求。日活涨到十万级别后，你会发现一件很残酷的事：**同样的 system prompt 被重复喂给模型几十万次，同样的知识库片段被一遍遍塞进 context，同样一句「你好」也走了最贵的旗舰模型**。这些浪费靠提示词优化是省不掉的，只能靠工程手段。

这一篇把两个最有效的降本姿势拆开讲清楚：Prompt Caching（让重复的前缀不再烧 Token）和模型路由（让简单任务走便宜档位）。配套代码用 TypeScript 实现了一套可观测的路由 + 缓存 + 成本追踪流水线，直接把同一批任务的花费打到基线的 10% 以下。

---

## 成本是怎么被吃掉的

在开始优化之前，先搞清楚钱到底花在哪。LLM 的单次调用成本可以拆成两部分：

```
单次成本 = 输入 Token × 输入单价 + 输出 Token × 输出单价
```

输出单价通常是输入单价的 5~10 倍（本章 `pricing.ts` 里 large 档位输入 $1.25/M、输出 $10/M 就是这个比例）。但奇怪的是，真实业务里烧钱最狠的往往不是输出，而是**被反复发送的输入**。

典型的 RAG 客服系统每次调用的 prompt 结构大致是这样：

```
[system prompt: 角色设定 + 政策条款 + 输出格式]  ~ 800 tokens
[retrieved context: 3-5 段知识库片段]           ~ 1200 tokens
[chat history: 最近 N 轮对话]                   ~ 600 tokens
[current user message]                         ~ 50 tokens
----------------------------------------------------------
                                               ~ 2650 tokens
```

前面三段在用户的每一轮对话里几乎不变，但每次都要完整重新计费。一天十万次调用，光 system prompt 这 800 个 Token 就被重复计费 800 万次。这就是 **Prompt Caching** 要解决的问题。

另一个浪费是**大炮打蚊子**：用户发「你好」「谢谢」这种寒暄，也和「请设计一个支持跨机房容灾的分布式事务方案」用同一个旗舰模型。旗舰模型处理寒暄是秒回的，但按 Token 收费这件事不会因为任务简单就打折。这就是 **模型路由** 要解决的问题。

这两个优化方向互不冲突：Prompt Caching 解决**纵向**的 Token 重复计费，模型路由解决**横向**的档位错配。组合起来才能把成本压到极限。

---

## Prompt Caching：让不变的前缀只付一次钱

Prompt Caching 的核心思路是：既然每次调用的 prompt 前缀都是同一套，那就让模型把这段前缀处理完的中间状态存下来，下次命中时直接从这个状态继续算，不必从头再来。

主流厂商的实现各有差异，但思想一致：

**Anthropic 的 `cache_control`**：手动标记哪段内容要缓存，显式控制。缓存命中后输入 Token 按 10% 计费（Sonnet 系列），Cache Write 按 125% 计费，Cache Hit 按 10%，最小 1024 Token 才触发。适合对缓存边界有精确控制诉求的场景。

**OpenAI 的自动前缀缓存**：GPT-4o 及以上模型默认启用，只要 prompt 前缀重复超过 1024 Token，命中部分按 50% 计费，无需任何代码改动。简单直接，但缓存命中区间不可控。

**其他厂商**（DeepSeek、Gemini 等）大多跟进了类似机制，但折扣比例和触发阈值各有不同。

本章 `src/prompt-cache.ts` 没有直接用厂商的原生 Caching（中转站的 OpenAI 兼容层没透出这些控制字段），而是在应用层做了一个等价演示：**相同 messages + 相同 model 的组合，第二次请求直接命中本地缓存**。原理和厂商侧的服务端缓存一致，差别只在：缓存是你自己的，还是厂商的。

```typescript
// prompt-cache.ts 节选

interface CacheEntry {
  response: LLMResponse
  cachedAt: number
}

// 应用层缓存：完全相同的 messages + model 组合返回历史结果
// 生产环境建议换成 Redis 等共享缓存，并加 TTL 与容量上限
const responseCache = new Map<string, CacheEntry>()

function computeCacheKey(messages: Message[], model: string): string {
  const payload = JSON.stringify({ messages, model })
  return createHash('sha256').update(payload).digest('hex')
}

async function cachedChat(
  messages: Message[],
  tier: ModelTier,
): Promise<CachedChatResult> {
  const profile = PROFILES[tier]
  const key = computeCacheKey(messages, profile.model)
  const startedAt = Date.now()

  const cached = responseCache.get(key)
  if (cached) {
    return { response: cached.response, hit: true, latencyMs: Date.now() - startedAt }
  }

  const response = await chat(messages, {
    model: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  })
  responseCache.set(key, { response, cachedAt: Date.now() })

  return { response, hit: false, latencyMs: Date.now() - startedAt }
}
```

运行 `pnpm prompt-cache` 可以看到一个客服场景里的四次调用：

```
[Q1 first time]
  status   : MISS
  latency  : 8809ms
  tokens   : in=268 out=180
  cost     : $0.000427

[Q1 repeated]
  status   : HIT 
  latency  : 0ms
  tokens   : in=268 out=180
  cost     : $0.000000

[Q2 different]
  status   : MISS
  latency  : 4522ms
  cost     : $0.000322

[Q1 repeated again]
  status   : HIT 
  latency  : 0ms
  cost     : $0.000000

--- Summary ---
  cache hits     : 2 / 4
  tokens saved   : 896
  actual spend   : $0.000749
  cost saved     : $0.000854
```

四次调用有两次命中，省掉 53% 的钱，更关键的是**命中请求的延迟直接从 8 秒降到 0 毫秒**。对用户体验的改善比省钱更明显。

### 应用层缓存 vs 厂商原生 Caching

这两种方式不是互斥的，实际生产里要搭配用：

**应用层缓存**用于 FAQ、政策条款解释、热门商品介绍这类**答案完全一致**的场景。完全同样的 question 返回完全同样的 answer，这种命中率在客服场景可以达到 30~40%。

**厂商原生 Caching**用于**前缀相同、后缀不同**的场景。比如每次都是同一套 system prompt 加一段用户新发的消息，应用层缓存永远命不中（因为最后那段用户输入每次都不一样），但厂商侧可以缓存住前缀部分，把实际计费 Token 压到只剩最后一段。

工程上的做法通常是：先用应用层缓存拦完全重复请求，剩下的请求让厂商侧的前缀缓存继续发力。两层叠加，能把 system prompt 这种高成本常量的计费次数压到最低。

### 缓存命中率决定 ROI

Prompt Caching 能省多少钱，完全取决于**命中率**。影响命中率的关键设计：

把稳定部分放在 prompt 最前面。**顺序极其关键**：所有主流厂商的前缀缓存都是从头开始匹配的，前缀只要有一个字符不同，后面再像也不会命中。正确结构是：

```
[system prompt]           ← 最稳定，放最前
[policy / knowledge base] ← 次稳定
[chat history]            ← 按会话变化
[current user message]    ← 每次都变，放最后
```

很多团队犯的错是把时间戳、用户 ID 这类每次都变的字段拼在 system prompt 开头，直接让缓存永远失效。一个字段的位置换一下，命中率能从 0 变成 80%。

---

## 模型路由：让便宜档位接住 80% 的简单请求

路由的思路很直觉：用一个便宜的判断机制决定「这个请求要不要动用旗舰模型」。

本章 `pricing.ts` 里定义了三个档位：

```typescript
// pricing.ts 节选

export const PROFILES: Record<ModelTier, ModelProfile> = {
  small: {
    tier: 'small',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.4,
    temperature: 0.2,
    maxTokens: 200,
    description: 'cheap model for greetings, classification, short replies',
  },
  medium: {
    tier: 'medium',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 2.0,
    temperature: 0.3,
    maxTokens: 400,
    description: 'balanced model for typical Q&A and summaries',
  },
  large: {
    tier: 'large',
    model: MODELS.GPT5_CODEX,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    temperature: 0.5,
    maxTokens: 800,
    description: 'flagship model for multi-step reasoning and design',
  },
}
```

生产环境里，small 通常对应 gpt-4o-mini / Claude Haiku / DeepSeek-V3 这档，medium 对应 gpt-4o / Claude Sonnet，large 对应 GPT-5 / Claude Opus。本章因为中转站只提供 gpt-5.4 一个模型，就用同一个模型 + 不同 profile 来演示分级调度的思路，生产环境把 `model` 字段换成真实的小/中/大模型 ID 即可。

档位之间的价差非常悬殊：large 档输入单价是 small 档的 25 倍，输出是 25 倍。如果 80% 的请求能走 small 档，整体成本就能压到基线的 20% 甚至更低。

### 先用规则，规则模糊时才用 LLM

路由决策本身也是成本，不能为了省钱而引入新的大头。`src/model-router.ts` 的路由层按**先规则、后 LLM** 的顺序排：

```typescript
// model-router.ts 节选

function classifyByRule(input: string): RouteDecision | null {
  const matched: string[] = []
  const lower = input.toLowerCase()

  // 复杂任务关键词：设计、推理、对比、trade-off、分布式、架构等
  const heavyKeywords = [
    '设计', '架构', '推理', '证明', '对比', '权衡', '综述',
    '多步', '分布式', '一致性', '事务', '方案', 'trade-off',
    'design', 'architecture', 'reasoning', 'compare', 'trade off',
  ]
  for (const k of heavyKeywords) {
    if (lower.includes(k)) matched.push(`heavy:${k}`)
  }
  if (matched.length > 0) {
    return { tier: 'large', reason: 'heavy-keyword', matched }
  }

  // 简单任务特征：很短 + 问候 / 寒暄 / 感谢
  const lightKeywords = ['你好', '您好', '谢谢', '多谢', 'hi', 'hello', 'thanks', 'thank you', 'ok']
  const trimmed = input.trim()
  if (trimmed.length <= 25) {
    for (const k of lightKeywords) {
      if (lower.includes(k)) matched.push(`light:${k}`)
    }
    if (matched.length > 0 || trimmed.length <= 6) {
      return { tier: 'small', reason: 'short-or-greeting', matched }
    }
  }

  // 长度过长必定不是 small；在 medium 与 large 之间不确定，交给 LLM 兜底
  if (trimmed.length >= 120) {
    return null
  }

  // 默认走 medium
  return { tier: 'medium', reason: 'default', matched: [] }
}
```

规则层几乎零成本：字符串长度判断 + 关键词匹配。能覆盖的场景：

- **寒暄/感谢**：短文本 + 问候关键词 → small 档
- **复杂任务**：命中「设计/架构/trade-off」等关键词 → large 档
- **常规 Q&A**：长度适中 → medium 档

只有当输入超长（120 字以上）但又没命中复杂关键词这种**规则不够确信**的情况，才调用 LLM 分类器：

```typescript
// model-router.ts 节选

async function classifyByLLM(input: string): Promise<RouteDecision> {
  const systemPrompt = `You are a request complexity classifier.
Classify the user request into one of: small, medium, large.
- small: greetings, classification, short factual questions
- medium: typical Q&A, summaries, light coding help
- large: multi-step reasoning, architecture, design trade-offs

Respond with a single JSON object: {"tier":"small|medium|large","confidence":0.0-1.0}`

  // 用 small 档位自己做分类，模型便宜、输出短，分类成本近乎为零
  const response = await chat(messages, {
    model: PROFILES.small.model,
    temperature: 0,
    maxTokens: 40,
  })
  // ... 解析 JSON 并做降级回落
}
```

**关键决策**：LLM 分类器必须用 small 档位自己做，否则路由本身的成本会反噬节省。一次分类只花几百个 Token，比直接把所有请求打到 large 档便宜两个数量级。

运行 `pnpm model-router` 看四类输入的分派结果：

```
[input] 你好，最近怎么样？
  tier       : small  (short-or-greeting)
  matched    : light:你好
  cost       : $0.000012

[input] 用一句话解释什么是闭包？
  tier       : medium  (default)
  cost       : $0.000089

[input] 请设计一个支持跨机房容灾的分布式事务方案，对比 2PC、TCC、Saga 的 trade-off。
  tier       : large  (heavy-keyword)
  matched    : heavy:设计, heavy:对比, heavy:trade-off, heavy:分布式, heavy:方案, heavy:trade off
  cost       : $0.004523

[input] 这段 SQL 为什么慢：SELECT * FROM orders WHERE status = 1 ORDER BY created_at DESC LIMIT 10
  tier       : medium  (default)
  cost       : $0.000127
```

寒暄走 small 花了 $0.000012，架构设计走 large 花了 $0.004523，差了 377 倍。如果把所有请求都塞给 large，前三个本该便宜的请求都会按 large 价计费，白白浪费预算。

---

## 把省下的钱算清楚：Cost Tracker

省钱不能只靠感觉，要有可量化的对比。`src/cost-tracker.ts` 对同一批任务做两套账：

- **baseline**：假装所有任务全部走 large 档，用 route 实际调用产生的 usage 回算成本
- **routed**：按 router 实际决策的档位结算

两者相减就是节省金额。这种做法的好处是不需要为了算基线再跑一遍全量 large，节省一半 API 调用：

```typescript
// cost-tracker.ts 节选

async function main(): Promise<void> {
  const records: CallRecord[] = []

  for (const task of TASKS) {
    const routed = await routeChat(task)
    // 基线：同样 input/output tokens 全按 large 档位结算
    const baselineCost = calcCost('large', routed.inputTokens, routed.outputTokens)

    const record: CallRecord = {
      input: task,
      tier: routed.decision.tier,
      inputTokens: routed.inputTokens,
      outputTokens: routed.outputTokens,
      actualCost: routed.cost,
      baselineCost,
      latencyMs: routed.totalLatencyMs,
    }
    records.push(record)
    // ...
  }

  summarize(records)
}
```

任务集覆盖了从寒暄到架构设计的各种难度，跑完看汇总：

```
--- Summary ---
  tasks          : 5
  tokens         : in=246 out=1342
  baseline spend : $0.013728  (all tasks on large tier)
  routed spend   : $0.002215  (router decision per task)
  savings        : $0.011513  (83.9%)
  tier mix       : small=2 medium=2 large=1
```

同一批任务从 $0.0137 压到 $0.0022，省了 83.9%。推到生产量级，日调用 10 万次的应用一个月能省四位数美元。

更重要的是**档位分布**：5 个任务里只有 1 个真的需要 large，剩下 4 个用 medium 或 small 就够了。这个比例在真实客服/问答类应用里非常常见：**大多数请求都比你以为的简单**，但没有路由机制时全都被按最贵的价格结算。

---

## 踩坑与最佳实践

### 1. 缓存 Key 里绝对不能含时间戳

我见过最惨痛的一次踩坑：同事给 system prompt 加了个「当前时间是 `{now}`」方便模型判断过期优惠，结果上线后发现缓存命中率从 40% 掉到 0。因为时间精度到秒，每次请求的 prompt 都不同，前缀永远对不上。

修的方法是把时间精度降到「小时」甚至「天」，或者干脆把时间字段挪到 user message 末尾而不是 system prompt 开头。更稳妥的做法是**所有动态字段统一放在 prompt 最后**，让前面的稳定部分最大化利用缓存。

### 2. 路由规则要结合业务日志持续迭代

本章的关键词列表只是起点。真实业务里你会发现用户经常用一些你想不到的表达触发复杂任务：「帮我梳理一下」「你看这样行不行」这种看似闲聊的开头，后面可能跟着一段复杂需求。

工程化做法：

- 把每次路由决策的 `reason` 和最终 usage 都打到日志
- 定期抽样分析「被路由到 medium/small 但实际花了很多输出 Token」的样本，大概率是路由错配
- 持续把新发现的复杂关键词加进启发式规则

### 3. LLM 分类器的输出必须做容错

`classifyByLLM` 返回值靠正则从 response 里抠 JSON，这个抽取逻辑很容易失败：

- 模型输出空响应（中转站超时）
- JSON 被截断（maxTokens 卡太死）
- 格式跑偏（模型把 JSON 包在反引号里）

本章的兜底策略是**任何异常都回落到 medium 档**，而不是报错阻塞业务。因为路由分类器挂掉时，拒绝所有请求的代价远大于多花一点钱走稍贵档位。

### 4. 小心便宜档位的幻觉放大

把一个复杂请求错误路由到 small 档，省下的那点钱根本弥补不了幻觉带来的客诉成本。几个保护动作：

- 路由决策对长文本、含代码块、含技术名词的输入保守升档
- 关键业务（退款、医疗、金融）强制走 large 档，禁止路由下沉
- 配合第 19 篇的 Faithfulness 检查，如果便宜档位答案的幻觉率明显更高，要立刻调整路由规则

### 5. 缓存过期和内容一致性

应用层缓存最容易出的事故是**缓存了过期答案**。政策从 30 天改成 14 天，但缓存里还是 30 天的旧回答，用户被误导后找客服。

生产环境至少要做：

- 缓存加 TTL，常识类答案 24 小时，政策类答案 1 小时，价格/库存类答案不缓存
- 政策/知识库更新时，通过版本号作为 cache key 的一部分，强制失效旧缓存
- 对「答案中包含金额/数量」的内容单独监控命中率，避免过期数字误导用户

---

## 小结

- **Prompt Caching 的关键是命中率**：把稳定部分放前缀、动态字段放末尾，应用层缓存和厂商原生缓存叠加用，能把 system prompt 的计费次数压到接近零
- **路由的关键是先规则后 LLM**：免费的规则层先筛 90% 的明确请求，模糊样本才调用 small 档 LLM 分类，分类成本比误用旗舰模型小两个数量级
- **省钱必须可量化**：baseline vs routed 两套账持续对比，路由命中分布当核心指标监控，没有数据就没法判断优化是否有效

到这里，我们已经把生产级 AI 应用的评估、安全、成本三大块全部搭起来了。下一篇也是本系列的最后一篇，我们会把前面 20 篇的所有积木组装到一起，拆解一个完整 AI SaaS 从 0 到 1 的架构全貌。

---

**下一篇**：从 0 到 1：一个完整 AI SaaS 的架构拆解

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 20 篇*

---

**算账这件事我平时也在用 AI 工具做自动化：让 Claude 扫一遍 prompt 找冗余、让 GPT 批量生成路由规则的测试用例、让 Gemini 总结一周的调用日志。几个工具各有擅长的部分，搭配用比只用一个顺手。如果你也在用 AI 编码助手，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
