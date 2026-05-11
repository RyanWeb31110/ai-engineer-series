# AI 应用的监控与评估：LangFuse + RAGAS

> 把「模型效果」变成可观测、可量化、可回归的数值

---

上一篇我们用 Next.js + Vercel AI SDK 搭了一个能跑起来的 AI 应用。但应用上线之后，麻烦才真正开始：用户反馈「昨天答得好好的，今天怎么开始胡说八道了」，你打开日志只看到 `POST /api/chat 200`，完全不知道模型那一轮到底发生了什么。

传统 Web 应用有 APM 和日志系统，AI 应用需要一套专门的观测和评估体系：**LangFuse** 解决"线上每次调用发生了什么"，**RAGAS** 解决"模型效果到底好不好"。这篇我们从零搭一套轻量版，理解它们背后的核心模型。

---

## 为什么普通日志不够用

先看一个典型的 AI 应用调用链：

```
用户提问
  ↓
意图识别（LLM 调用 1）
  ↓
向量检索
  ↓
上下文重排序（LLM 调用 2）
  ↓
答案生成（LLM 调用 3）
  ↓
返回用户
```

普通日志能告诉你"接口返回 200，耗时 3.2 秒"。但你真正关心的是：

- 这 3.2 秒里，三次 LLM 调用各占多少
- 每次调用输入了什么 Prompt，输出了什么内容
- 整条链路一共烧了多少 Token，花了多少钱
- 如果答案质量差，是检索阶段召回错了，还是生成阶段产生了幻觉

**普通日志是一维的**（时间线上一行一行），**AI 应用需要二维的结构化观测**（嵌套的调用树加上每个节点的输入输出）。这就是为什么 LangFuse、Langsmith、Phoenix 这类 LLM 可观测平台火起来的原因。

---

## LangFuse 的核心模型：Trace / Span / Generation

LangFuse 不是一个玄学工具，它的数据模型非常简单，三个概念：

**Trace**：一次完整的业务调用。比如用户发一条消息、一次 RAG 查询。Trace 是最顶层的容器，关联 `userId`、`sessionId` 这些业务维度。

**Span**：Trace 下的任意子步骤。向量检索、数据库查询、工具调用都是 Span。Span 可以嵌套，形成一棵树。

**Generation**：专门标记 LLM 调用的特殊 Span。除了常规的输入输出，还会记录模型名、Token 消耗、成本。

这套模型和 OpenTelemetry 的 Span 树是同一个思路，只是针对 LLM 做了语义化扩展。

---

## 自己实现一个轻量版 Tracer

LangFuse 需要部署一套服务端，对于原理理解而言有点重。我们先用 80 行代码自己写一个，跑通之后再讨论什么时候该上真正的 LangFuse。

核心数据结构：

```typescript
// tracer.ts 节选

export interface Observation {
  id: string
  traceId: string
  parentId: string | null
  type: 'trace' | 'span' | 'generation'
  name: string
  startTime: string
  endTime?: string
  durationMs?: number
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  usage?: Usage       // 仅 generation
  costUsd?: number    // 仅 generation
  model?: string      // 仅 generation
  error?: string
}
```

每条观测记录都有 `traceId` 和 `parentId`，这样就能还原出完整的调用树。Tracer 本身只做一件事：把观测记录追加到 `traces/<traceId>.jsonl`。

```typescript
// tracer.ts 节选

export class Tracer {
  _write(observation: Observation): void {
    const file = `${this.outDir}/${observation.traceId}.jsonl`
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(observation) + '\n', 'utf-8')
  }
}
```

JSONL（每行一条 JSON）是最方便的观测数据格式：追加写不会锁文件，单条故障不影响其他行，`jq`、DuckDB、Pandas 都能直接读。

Generation 在 `end` 时会自动按模型算成本：

```typescript
// tracer.ts 节选

function estimateCost(model: string, usage: Usage): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-5.4']
  return (usage.inputTokens / 1000) * price.inputPer1k
       + (usage.outputTokens / 1000) * price.outputPer1k
}
```

把调用看板所需的三个核心维度(延迟、Token、成本)全自动采集到了。

---

## 给 RAG 调用套上 Trace

来看完整的使用方式。`tracer-demo.ts` 模拟一次带检索和重排序的 RAG 调用：

```typescript
// tracer-demo.ts 节选

const tracer = new Tracer({ console: true, outDir: './traces' })

async function runRagQuery(query: string, userId: string): Promise<string> {
  const trace = tracer.trace('rag-query', { userId, query })

  // Step 1: 向量检索
  const retrieveSpan = trace.span('retrieve', { topK: 3 })
  const retrieved = mockRetrieve(query, 3)
  retrieveSpan.end({ hits: retrieved.length, docIds: retrieved.map(d => d.id) })

  // Step 2: 重排序
  const rerankSpan = trace.span('rerank')
  const reranked = mockRerank(retrieved)
  rerankSpan.end({ orderedIds: reranked.map(d => d.id) })

  // Step 3: LLM 生成答案
  const generation = trace.generation('answer', {
    model: MODELS.GPT5_CODEX,
    input: messages,
  })
  const response = await chat(messages, { model: MODELS.GPT5_CODEX, maxTokens: 150 })
  generation.end({ output: response.content, usage: response.usage })

  trace.end({ answer: response.content })
  return response.content
}
```

注意几个细节：

**Span 的命名要反映业务语义**。`retrieve`、`rerank`、`answer` 一眼就能看出是 RAG 流水线的哪一步，后续分析时能按 Span 名做 group by。

**`metadata` 放业务维度**。`userId`、`topK` 这些不是调用本身的输入输出，但对后续分析（按用户分群、按 topK 做 A/B）很有用。

**异常也要 end**。`try/catch` 里要记得在 catch 分支里 end 掉 generation 和 trace，否则你会丢失"失败案例"的数据，而失败案例恰恰是最值得分析的。

跑起来的输出长这样：

```
[Query] Next.js 15 有什么新特性
[trace] rag-query
[span] retrieve
[span] rerank
[generation] answer 1888ms 109tok $0.000423
[trace] rag-query [end] 1891ms
[Answer] Next.js 15 默认采用 App Router，取代旧的 Pages Router。
```

最后 Demo 会从 `traces/*.jsonl` 把所有 Trace 读回来做汇总：

```
Aggregate: 3 traces, 348 tokens, $0.001388, 8065ms total
```

有了这份结构化数据，你就能回答很多原来回答不了的问题：P95 延迟是多少、平均每次调用多少 Token、哪个用户烧钱最多、哪类问题检索最容易召回失败。

---

## 评估：比观测更难的问题

监控告诉你"发生了什么"，但没告诉你"答得好不好"。

最朴素的评估方式是人眼抽查：运营同学每天随机看 50 条对话打分。这种做法有三个问题：**不可扩展、不一致、不能回归**。你换了一个 Prompt 之后，只能重新抽查，不知道这次改动到底让效果变好还是变差。

2023 年底社区给出了一个方向：**LLM-as-Judge**。用一个裁判 LLM 来评估另一个 LLM 的输出。这不是简单的"自己评自己"，而是把评估任务拆解成几个可量化的子任务，每个子任务让 LLM 做一个相对客观的判断。

**RAGAS**（RAG Assessment）是这套思路最流行的开源实现，提供了几个针对 RAG 应用的核心指标：

- **Faithfulness**：答案是否忠实于检索到的上下文（防幻觉）
- **Answer Relevancy**：答案是否针对问题（防跑题）
- **Context Precision**：检索到的上下文有多少是真正相关的（防召回噪音）
- **Context Recall**：真正相关的上下文有多少被检出了（防漏召回）

---

## Faithfulness：幻觉检测怎么做

Faithfulness 的核心算法不复杂：

1. 把答案拆成若干独立的"事实陈述"
2. 对每个陈述，让 LLM 判断能否从上下文推出
3. 分数 = 可推出的陈述数 / 总陈述数

本章的 `ragas-metrics.ts` 用 JSON 模式实现了这个流程：

```typescript
// ragas-metrics.ts 节选

export async function faithfulness(answer: string, context: string) {
  const systemPrompt = `你是一个严格的事实核查员。把答案拆成若干独立的事实陈述，
然后判断每条陈述是否能从给定的上下文中推出。
只输出 JSON，格式：
{
  "statements": ["陈述1", "陈述2"],
  "verdicts": [
    { "statement": "陈述1", "supported": true, "reason": "..." },
    { "statement": "陈述2", "supported": false, "reason": "..." }
  ]
}`

  const prompt = `【上下文】\n${context}\n\n【答案】\n${answer}\n\n请拆解答案并逐条核查。`

  const detail = await judgeWithJson<FaithfulnessJudgement>(prompt, systemPrompt)
  const supported = detail.verdicts.filter(v => v.supported).length
  const score = detail.verdicts.length === 0 ? 0 : supported / detail.verdicts.length

  return { score, detail }
}
```

这里有个关键工程细节：**LLM 返回 JSON 必须容错**。中转站、代理层、网络抖动都可能让响应变空或者格式跑偏。`judgeWithJson` 里做了三次重试和 JSON 片段抽取：

```typescript
// ragas-metrics.ts 节选

for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const response = await chat(messages, { model: MODELS.GPT5_CODEX, temperature: 0 })
    const content = response.content.trim()
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/\{[\s\S]*\}/)
    const rawJson = jsonMatch ? (Array.isArray(jsonMatch) && jsonMatch[1] ? jsonMatch[1] : jsonMatch[0]) : content
    return JSON.parse(rawJson) as T
  } catch (err) {
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 1500))
  }
}
```

跑起来看实际效果。`ragas-metrics.ts` 构造了两个对比案例：

```
【案例 1：高质量答案】
  faithfulness     : 1.00
  answerRelevancy  : 1.00
  contextPrecision : 1.00

【案例 2：有幻觉 + 跑题的答案】
  faithfulness     : 0.00  ← 应该很低（有幻觉）
  answerRelevancy  : 0.72  ← 应该中等（部分跑题）
  contextPrecision : 1.00
```

案例 2 的答案编造了"内置 GraphQL 支持"这种上下文里没有的信息，faithfulness 准确降到了 0。这就是可自动化、可回归的评估。

---

## 评估流水线：把两件事串起来

`evaluation-runner.ts` 把观测和评估串成了完整流水线。核心是 `evaluateCase` 函数：

```typescript
// evaluation-runner.ts 节选

async function evaluateCase(testCase: EvalCase, tracer: Tracer): Promise<EvalResult> {
  const trace = tracer.trace('eval-case', { caseId: testCase.id })

  // 检索 + 计算 Recall
  const retrieved = retrieve(testCase.question, 3)
  const retrievedIds = retrieved.map(d => d.id)
  const hitCount = testCase.relevantDocIds.filter(id => retrievedIds.includes(id)).length
  const contextRecall = hitCount / testCase.relevantDocIds.length

  // 生成答案
  const answer = await generateAnswer(testCase.question, context)

  // 并行跑三个 LLM-as-Judge 指标
  const [f, r, p] = await Promise.all([
    faithfulness(answer, context),
    answerRelevancy(testCase.question, answer),
    contextPrecision(testCase.question, retrieved.map(d => d.text)),
  ])

  const overallScore = (f.score + r.score + p.score + contextRecall) / 4
  trace.end({ overallScore })
  return { /* ... */ }
}
```

三个指标并行跑，因为它们互相独立。整个评估过程本身也在 Trace 里，所以你可以用同一套观测工具看"评估流水线"自己的性能。

跑完一轮数据集会得到一个报告：

```
Aggregate Report
  avg faithfulness     : 1.000
  avg answerRelevancy  : 0.987
  avg contextPrecision : 1.000
  avg contextRecall    : 1.000
  avg overallScore     : 0.997
  pass rate            : 100.0% (3/3)

Report saved to ./reports/eval-2026-05-08T03-34-03-468Z.json
```

真实项目里，这个报告会落到 CI：每次 PR 改动 Prompt 或者换模型，自动跑一次评估，指标下降超过阈值就阻断合并。这就是 **LLMOps** 的核心实践：**把模型效果纳入软件工程的常规回归测试流程**。

---

## 踩坑与最佳实践

### 1. 观测数据要在边界采集，不要在代码里手动打点

如果每个业务函数都要手动调 `tracer.span()`，代码很快会被污染。更好的做法是在 LLM Client、向量库 Client 这些基础设施层做拦截，业务代码只关心业务逻辑。LangFuse 官方 SDK 就是走 decorator 或者 callback 方式自动埋点。

### 2. 裁判模型要比被评估模型"更强"或者"持平"

用 gpt-3.5 当裁判去评 gpt-4 的输出，结果不可信。至少用同级别的模型做 Judge，条件允许用更强的。本章为了示例简单，Judge 和被评估模型都是 gpt-5.4，生产环境建议区分开。

### 3. 离线评估不能完全替代线上抽查

LLM-as-Judge 是概率性的，单次结果有噪音。一般做法是：离线跑小数据集（20~200 条）做快速回归，线上按用户反馈做长期抽查，两套系统互相验证。

### 4. 裁判要求输出 JSON 一定要重试

LLM 返回非结构化 JSON 是常态，尤其是经过中转站的时候。本章的 `judgeWithJson` 做了三次重试 + 多种 JSON 片段抽取，实测能把失败率从 5% 左右降到 0.1% 以下。更激进的方案是使用 `response_format: { type: 'json_schema' }`，但中转站对这个支持不稳定。

### 5. Trace 的 JSONL 文件要定期归档

每次调用都追加写，一天几万条之后文件会变很大。生产环境里，Tracer 应该写入对象存储（S3、OSS）或者直接上 ClickHouse，按天分区做生命周期管理。本章的 Demo 用本地 JSONL 主要是为了理解原理。

---

## 小结

- **AI 应用的可观测性不是普通日志**，需要 Trace / Span / Generation 这套嵌套模型，才能还原完整调用链和成本归因
- **LLM-as-Judge 把"效果评估"从人肉抽查变成可自动化的流水线**，RAGAS 的 faithfulness / answer_relevancy / context_precision 是 RAG 场景的三个基线指标
- **LLMOps 的核心是把观测和评估接入 CI**，每次 Prompt 或模型改动都要跑回归，指标下降就阻断合并

到这里你就有了"线上到底发生了什么"和"效果好不好"两个维度的量化能力。下一篇我们看另一个生产级必备能力：Guardrails，给 AI 的输入输出装上安全护栏。

---

**下一篇**：Guardrails：给 AI 装上安全护栏

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 18 篇*

---

**搭这套观测评估系统的时候，我一边用 Claude Code 帮我扫 LangFuse 和 RAGAS 的源码，一边让 GPT-5 评审我的数据模型设计，两个 AI 工具互相校对一起出的方案。如果你也在用 AI 编码助手，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
