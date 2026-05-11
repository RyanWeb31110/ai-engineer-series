# 从 0 到 1：一个完整 AI SaaS 的架构拆解

> 前 20 篇搭的是零件，这一篇把它们拼成能上线、能收费、能扩容的系统

---

到这里，系列走到最后一篇。过去 20 篇里我们一件一件拆过：LLM 怎么工作、Prompt 怎么写、结构化输出、Function Calling、RAG、ReAct、Agent、MCP、A2A、Context Engineering、LLMOps、Guardrails、成本控制。每一块都是能独立运行的 Demo，但放到真实产品里，它们不能各自为政。一个用户请求从进 API 到返回结果，中间要顺序穿过这些组件，每一环都要能被观测、能被计费、能在上游挂掉时不把系统带下去。

这一篇把前面所有积木装进一条 pipeline，演示一个最小但结构完整的 AI SaaS 后端：多租户、路由分档、缓存复用、RAG 检索、Guardrails、容错降级、Trace 观测、用量结算一次性串起来。配套代码是一个可以直接跑通的 TypeScript monorepo 章节，跑完会看到 8 个请求走过完整链路，系统级省下 72.7% 的成本，还产出一份可以直接接入监控系统的指标报告。

---

## SaaS 和 Demo 的本质差异

很多人做 AI 应用卡在「Demo 到产品」这一跳。原因不是技术难，而是**视角变了**。

Demo 关心的是：这段 Prompt 能不能让模型输出正确答案。SaaS 关心的是：

- **谁**在调（租户、套餐、权限）
- **值不值**（这次花了多少钱，用户是不是免费版在薅企业版模型）
- **稳不稳**（上游抖动时用户看到什么，是 500 错误还是降级提示）
- **看得见吗**（出问题时能不能 5 分钟内定位到哪一步慢了、哪个租户在烧钱）

这四个问题推着你把原本扁平的 `chat(messages)` 调用拆成一条 pipeline：每一步有明确的输入输出，每一步都能被插入、替换、观测。下图是本章 `src/pipeline.ts` 的完整链路：

```
User Request
    │
    ▼
 [guard-input]      ← 输入护栏：注入检测、越界拦截
    │
    ▼
 [quota-check]      ← 租户配额：调用次数、预算上限
    │
    ▼
 [route]            ← 模型路由：small / medium / large
    │
    ▼
 [retrieve]         ← RAG 检索：拼接知识库上下文
    │
    ▼
 [cache-lookup]     ← 应用层缓存：重复请求直接命中
    │
    ▼
 [llm-call]         ← 主调用 + 失败重试 + 降级响应
    │
    ▼
 [guard-output]     ← 输出护栏：PII 脱敏
    │
    ▼
 [record-trace]     ← Trace 落盘：用量、延迟、决策原因
    │
    ▼
User Response
```

9 个阶段，每个阶段都可能把请求直接终止（护栏阻断、配额超限），或者改变后续的执行参数（路由决定模型、检索决定上下文）。

---

## 模块边界：把可替换的东西抽干净

SaaS 能长期演进，关键是**边界清晰**。本章把 pipeline 拆成 8 个独立模块，每个文件只干一件事，对外只暴露必要的函数和类型：

```
21-ai-saas/src/
├── env.ts              # .env 加载
├── pricing.ts          # 模型档位与成本计算
├── kb.ts               # 迷你知识库 + 关键词检索
├── guardrails.ts       # 输入/输出护栏
├── router.ts           # 规则层路由决策
├── cache.ts            # 响应缓存（带 tenant 隔离）
├── tenant.ts           # 租户配额与用量
├── observability.ts    # Trace 记录与指标聚合
├── pipeline.ts         # 把上面全部串起来
└── saas-demo.ts        # 多租户端到端演示入口
```

这种拆分不是为了文件数量好看，而是为了让**替换**成本接近零。比如：

- `cache.ts` 现在用 `Map`，换成 Redis 只改这个文件
- `kb.ts` 现在是关键词检索，换成第 07 篇的 Hybrid Search + Reranking 只改这个文件
- `router.ts` 现在是规则，加上第 20 篇的 LLM 分类器兜底只改这个文件
- `guardrails.ts` 现在是正则，升级到第 19 篇的三层护栏只改这个文件

`pipeline.ts` 不动。对外 API 不动。这是做 SaaS 的第一性原则：**先定边界，后填实现**。如果一上来就把 chat、retrieve、cache、guardrails 全揉进一个 500 行的函数，后面每加一个能力都会引发连锁修改，也就是所谓的僵化。

---

## 多租户：配额、隔离、封顶

多租户是 SaaS 的分水岭。单用户应用可以忽略这层，一旦开始收费，你得回答三个问题：

1. **配额**：这个租户今天还能调几次、还能花多少钱？
2. **隔离**：一个租户的数据会不会漏给另一个租户？
3. **分层**：Free 版和 Pro 版的差异怎么落到代码里？

本章在 `src/tenant.ts` 里用三个字段覆盖了这三个问题：

```typescript
// tenant.ts 节选

export interface TenantQuota {
  /** 每日允许的调用次数 */
  dailyCalls: number
  /** 每日允许的花费（USD） */
  dailyBudgetUSD: number
  /** 允许访问的最高档位，low-tier plan 可能禁用 large */
  maxTier: ModelTier
}
```

`dailyCalls` 和 `dailyBudgetUSD` 做配额预检查，`maxTier` 做**档位封顶**。这是一个容易忽略的设计点：如果只靠预算控制，Free 用户照样能触发 large 档的超贵请求，只是调用次数少一点，单次成本却极高，预算瞬间烧光。正确做法是：

```typescript
// tenant.ts 节选

export function capTier(desired: ModelTier, cap: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { small: 1, medium: 2, large: 3 }
  return rank[desired] <= rank[cap] ? desired : cap
}
```

在 pipeline 里：

```typescript
// pipeline.ts 节选

// 3) 路由决策：先得到期望档位，再用租户套餐封顶
const decision = stage('route', () => routeDecide(req.input))
const finalTier = capTier(decision.tier, tenant.quota.maxTier)
const profile = PROFILES[finalTier]
```

路由层按输入特征决定期望档位，租户层按套餐封顶。即使 Free 用户问的是架构设计这种 large 档问题，实际也只会走 medium。运行 `pnpm demo` 能直观看到这个效果：

```
[tenant-pro] 复杂任务 → large 档
  tier       : large  cache=MISS
  tokens     : in=109 out=127
  cost       : $0.001406

[tenant-free] Free 租户 → 被封顶到 medium 档
  tier       : medium  cache=MISS
  tokens     : in=99 out=72
  cost       : $0.000169
```

同一类问题，Pro 走 large 花 $0.0014，Free 被封到 medium 花 $0.00017，相差 8 倍。这就是套餐分层的代码落点。

**隔离**落在 `src/cache.ts` 的 key 设计里：

```typescript
// cache.ts 节选

export function cacheKey(tenantId: string, messages: Message[], model: string): string {
  const payload = JSON.stringify({ tenantId, messages, model })
  return createHash('sha256').update(payload).digest('hex')
}
```

`tenantId` 参与 key 计算，两个租户哪怕问一模一样的问题，也命中不了彼此的缓存。这对缓存命中率是个损失，但**跨租户数据泄漏**是 SaaS 的红线，宁可少命中也不能冒险。

---

## 容错：让上游的抖动被单次请求吸收

开发环境里 LLM 调用 99% 能正常返回。上到生产后你会发现中转站、网络、模型自身都会出问题：超时、空响应、JSON 截断、限流 429。一次挂掉不可怕，可怕的是**没人接住，用户直接看到 500**。

本章在 `pipeline.ts` 的 llm-call 阶段做了最朴素但最有效的两层保护：**一次重试 + 降级响应**：

```typescript
// pipeline.ts 节选

response = await stageAsync('llm-call', async () => {
  const callOnce = () =>
    chat(messages, {
      model: profile.model,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
    })
  try {
    return await callOnce()
  } catch (err) {
    try {
      return await callOnce()
    } catch (err2) {
      upstreamError = err2 instanceof Error ? err2.message : String(err2)
      // 构造降级响应，usage 置 0，让上层照常完成 trace 和结算
      return {
        content: '当前服务繁忙，请稍后再试或联系人工客服。',
        model: profile.model,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }
    }
  }
})
// 降级响应不入缓存，避免把失败结果喂给下一个用户
if (!upstreamError) cacheSet(key, response)
```

这段代码有三个很关键的细节：

**第一**，降级响应是一个合法的 `LLMResponse`，usage 置 0，这样上层的成本计算、trace 记录、用量扣减都能照常走完，不用写一堆条件分支。

**第二**，降级响应不入缓存。你绝对不想把一条失败提示缓存起来，然后重复发给后面每个问同样问题的用户。

**第三**，异常信息写到 trace 的 `reason` 字段：

```typescript
const reasonParts: string[] = []
if (upstreamError) reasonParts.push(`upstream-error:${upstreamError.slice(0, 40)}`)
if (piiHits > 0) reasonParts.push(`pii-redacted:${piiHits}`)
```

出问题时打开日志就能看到是上游错还是 PII 脱敏触发了，不用再翻栈。我在最早跑这份代码时，中转站刚好返回了一次空流，这段容错直接把它吸收了，用户看到友好提示，运维看到 trace，指标里多一条 upstream-error 记录，完全不阻塞后续请求。

---

## 观测：所有决策都能事后重现

SaaS 出线上问题，最怕的是「用户说他的退款问题回答得不对，但你不知道他走的是哪个档位、哪个知识库片段、哪次缓存命中」。解决办法是**每一次请求都产出一条结构化 Trace**。

`src/observability.ts` 的 TraceRecord 定义就是把这条链路的每个决策点都捞出来：

```typescript
// observability.ts 节选

export interface TraceRecord {
  traceId: string
  tenantId: string
  input: string
  tier: ModelTier | null
  cacheHit: boolean
  blocked: boolean
  reason?: string
  inputTokens: number
  outputTokens: number
  costUSD: number
  /** 基线成本：同样 usage 按 large 档结算，便于计算省下的金额 */
  baselineCostUSD: number
  stages: TraceStage[]
  totalMs: number
  answerPreview: string
}
```

字段设计有三个实战考量：

- `tier` 和 `cacheHit` 是**排查路由错配**的第一入口
- `stages` 记录每个阶段的耗时，慢查询时一眼看出是 LLM 慢还是检索慢
- `baselineCostUSD` 是**持续证明 ROI** 的依据，没有这个字段就永远说不清「如果不做路由会花多少钱」

Trace 攒起来就是系统级指标。`computeMetrics()` 汇总成一张报告：

```
--- System Metrics ---
  requests     : 8
  blocked      : 1
  cache hits   : 1
  total tokens : 1397
  routed spend : $0.002284
  baseline     : $0.008353  (all on large)
  savings      : $0.006069  (72.7%)
  p50 / p95    : 3987ms / 8022ms
  tier mix     : small=2 medium=4 large=1 blocked=1
```

一眼能看出：8 个请求里路由分档 2/4/1，缓存命中率 12.5%，p95 延迟 8 秒（主要是 large 档的 LLM 调用），同期相比全量走 large 省了 72.7%。这四个数字基本就是生产 AI SaaS 仪表盘上 24 小时要盯的核心指标。

生产环境只要把 `record()` 从 push 到内存数组改成写 OpenTelemetry 或 LangFuse（第 18 篇），其他代码一行不用改。

---

## 代码实战

把完整链路跑一遍，需要三条命令。先进入章节目录：

```bash
cd 21-ai-saas
pnpm install
```

然后分别跑三个入口：

```bash
pnpm kb        # 只跑检索，验证知识库
pnpm pipeline  # 跑一次完整请求，看 trace 细节
pnpm demo      # 多租户 8 个请求的端到端演示
```

重点看 `pnpm demo` 的输出。第一个请求是短寒暄：

```
[tenant-pro] 短寒暄 → small 档
  tier       : small  cache=MISS
  tokens     : in=84 out=28
  cost       : $0.000015  (baseline $0.000385)
  stages     : guard-input=0ms quota-check=0ms route=0ms retrieve=1ms cache-lookup=0ms llm-call=3166ms guard-output=1ms
  latency    : 3169ms
```

被路由到 small 档，花了基线成本的 1/25。第二和第三个请求是同样的退款问题：

```
[tenant-pro] 常规问答 → medium 档
  tier       : medium  cache=MISS
  cost       : $0.000376

[tenant-pro] 相同问题 → 命中缓存
  tier       : medium  cache=HIT
  cost       : $0.000000
  latency    : 1ms
```

同一问题第二次直接缓存命中，成本归零，延迟从 8 秒降到 1 毫秒。这就是 SaaS 里**请求越集中，边际成本越低**的来源。

再看护栏阻断：

```
[tenant-pro] 注入攻击 → 输入护栏阻断
  tier       : BLOCKED  cache=MISS
  reason     : input-guard-block
  tokens     : in=0 out=0
  cost       : $0.000000
  stages     : guard-input=1ms
  latency    : 1ms
```

注入尝试在输入护栏就被终结，没有触达 LLM，也就没有 Token 消耗。这是第 19 篇提到的「恶意流量零成本消化」在 SaaS 里的落点。

最后看租户分层效果。Pro 的架构设计走 large：

```
[tenant-pro] 复杂任务 → large 档
  tier       : large
  cost       : $0.001406
```

Free 的同类问题被封顶：

```
[tenant-free] Free 租户 → 被封顶到 medium 档
  tier       : medium
  cost       : $0.000169
```

路由决策依然判定是 large 档（因为命中「设计」「对比」等关键词），但 `capTier` 把它压回 medium。这个行为在 trace 里看得一清二楚：`route` 阶段记录了期望档位，最终执行的 `tier` 是封顶后的档位，两者不一致时就是租户被降档了。

---

## 踩坑与最佳实践

### 1. 阶段顺序错了，钱就白花

pipeline 的 9 个阶段顺序不是随便排的。几个硬约束：

- **Guardrails 必须在 Quota 之前**：恶意流量不应该计入租户用量，否则用户能被别人刷爆配额
- **Quota 必须在 Route 之前**：已超限的租户不值得再跑路由 LLM 分类器
- **Cache 必须在 LLM 之前**：缓存命中就别发请求
- **Cache Key 必须包含 Tenant**：跨租户泄漏是红线

我见过最惨的一次事故是把 Guardrails 放在 Cache 之后。某次上线后发现一段 PII 数据被缓存了，后续用户在完全无关的对话里收到了这段信息，因为缓存查询绕过了输出护栏。修起来不难，但事故已经发生。**顺序就是契约**，代码里用阶段名明确写出来比注释靠谱。

### 2. Trace 字段比日志重要

生产排障时 99% 的需求是「给我看这个 traceId 的完整信息」。文本日志里 grep 能查到，但字段不全。结构化 Trace 的价值在于：

- 任何时间、任何维度都能重新聚合（比如「昨天 Pro 租户的 p99 延迟」）
- 出现异常指标时能快速下钻到单条请求
- 可以直接喂给 LangFuse / Datadog 做可视化

定义 TraceRecord 时宁可多留几个字段，也不要等出事时才发现关键信息没记。字段命名用 `camelCase`，枚举类字段（`tier`、`reason`）的取值在代码里写死成 union type，避免拼写漂移。

### 3. 别把 RAG 检索放在缓存之后

如果检索在缓存之前，那相同输入命中缓存后，知识库更新了也不会反映。反过来，如果把检索放在缓存之后（缓存只缓存 LLM 回答），相同输入可能因为每次检索微小差异而永远命不中。

本章选了前者：**知识库稳定时优先命中缓存，不稳定时显式 invalidate**。具体做法是把知识库的版本号（比如 `kb:v20260511`）写进 cache key，每次知识库更新就换版本号，旧缓存全部自然失效。这比做细粒度的失效管理简单得多。

### 4. 配额计数器要用原子操作

本章用普通 `Map` 演示，生产必须换成 Redis 的 `INCR + EXPIRE`。原因是并发请求下，`if (usage.calls < limit) { usage.calls++ }` 这种两步操作会 TOCTOU（检查和赋值之间有窗口），高并发时租户能冲破配额几十次。Redis 的原子自增 + TTL 才是正解。

顺便一提，预算控制比次数控制难：次数可以用 INCR 精确扣，但预算扣减依赖 LLM 返回的 usage，而这个 usage 要到请求完成才能拿到。所以实际实现里，预算检查只能用**已累计花费**做保守估计，允许短时间内超额一点。用户升级套餐后重算即可。

### 5. 降级响应不要用预先写好的固定文案

本章为了简单用了「当前服务繁忙，请稍后再试」这种笼统话术。生产环境建议按失败类型给不同文案：

- 上游超时 → 「正在请求，请稍候」+ 建议刷新
- 上游限流 → 「当前服务压力较大，30 秒后自动重试」
- 配额超限 → 直接给升级套餐入口
- 护栏阻断 → 明确告诉用户哪类内容不支持，但不要泄漏护栏规则细节

文案统一放在一个常量表里，运营同学能自己改，不用每次改都发版。

---

## 小结

- **SaaS 和 Demo 的分水岭不是功能多少，而是每次请求都要能被观测、计费、隔离、降级**，这四件事在 pipeline 的 9 个阶段里各有明确位置
- **模块边界决定了系统能不能长期演进**：cache、router、guardrails、kb、tenant 全部独立成文件，换实现时 pipeline 不动，这是对抗僵化的硬要求
- **Trace 是生产 AI SaaS 的命脉**：没有结构化 Trace 就没有指标，没有指标就没有优化依据，先把 TraceRecord 字段定全，再考虑接 LangFuse / OpenTelemetry

到这里，「AI 工程师实战」系列 21 篇全部更新完毕。从 LLM 原理、Prompt、结构化输出、Function Calling、RAG、Agent、MCP、A2A、Context Engineering、LLMOps、Guardrails、成本控制，一路走到这一篇的端到端 SaaS，每一块能力都落到了可以直接跑的代码。后面的路要靠自己走了：找一个真实场景、定一个用户量目标、把这份 pipeline 跑起来，剩下的问题会在日志里一个一个浮出来。

愿你接下来做的每一个 AI 产品，都经得起生产环境的第一轮流量。

---

**下一篇**：（系列完结，后续见新系列）

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 21 篇*

---

**把这 21 篇写完，我日常也在用 AI 工具帮我处理各种重活：Claude 梳理架构图、GPT 生成压测用例、Gemini 帮我扫文档找漏讲的细节。不同模型擅长的事不一样，搭配起来比只押宝一家顺手。如果你也在用 AI 编码助手，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
