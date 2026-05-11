# Context Engineering：在有限空间里装最多价值

> 给 Agent 的上下文精心策划，而不是随手堆砌

---

你可能有过这样的经历：让 AI 编码助手帮你做一个功能，聊了十几轮之后，它突然开始"犯傻"，忘了之前商量好的方案，甚至重复问你已经回答过的问题。

或者你做了一个 RAG 系统，检索结果塞了一大堆文档，模型反而给出了更差的回答。

这些问题背后有一个共同的根因：**上下文窗口里装了太多没用的信息，稀释了真正重要的内容**。解决这个问题的方法论，就是 Context Engineering。

---

## 什么是 Context Engineering

2025 年中，Shopify CEO Tobi Lutke 发了一条推文："我开始觉得 Prompt Engineering 这个叫法不太对了，更准确的说法应该是 **Context Engineering**。"随后 Andrej Karpathy 也表达了类似的观点。

**Prompt Engineering** 关注的是"怎么写好一条指令"。**Context Engineering** 关注的是整个上下文窗口的管理：System Prompt、对话历史、检索到的文档、工具调用结果、之前的思考链路……所有这些加在一起，构成了 LLM 做决策时看到的"全部世界"。

一个比喻：如果 Prompt Engineering 是"写好一封邮件"，Context Engineering 就是"策划好整个项目会议的议程和材料"。你不只是要写好一条消息，而是要精心安排模型在每次推理时能看到什么、看不到什么。

---

## 上下文窗口的真相

现在的模型动辄 128K、200K 甚至百万级别的 Context Window，看起来空间很大。但**大 ≠ 好用**。

在第 01 篇我们提过一个现象：**Lost in the Middle**。研究发现，当 Context 很长时，模型对开头和结尾的内容注意力强，中间部分容易被忽略。换句话说，你塞进去的信息越多，模型对每条信息的"注意力"就越稀薄。

这带来一个关键工程原则：**Context 窗口不是硬盘，不能什么都往里塞。它更像工作记忆，只应该放当前任务真正需要的东西。**

---

## 四策略框架

Anthropic 在他们的 Agent 工程博客中总结了四个管理上下文的策略：**Write、Select、Compress、Isolate**。这四个策略不是互斥的，而是互补的，通常组合使用。

### Write：信息外置

最直觉的策略：**不是所有信息都要放在 Context 里，能存到外部就存到外部**。

Agent 在执行任务时产生的中间结果、调研笔记、代码草稿，都可以写到文件、数据库、或者 scratchpad 里。需要的时候再读回来，不需要的时候不占窗口空间。

典型场景：
- Agent 完成的研究报告 → 写到文件，只在后续步骤需要时读回
- 长对话中已经确认的决策 → 写到 memory 系统
- 工具调用的原始返回 → 提取关键字段，丢弃原始 JSON

### Select：精准检索

**只把当前步骤需要的信息拉进来**，而不是把所有"可能相关"的都塞进去。

这在 RAG 场景尤为关键。很多人做 RAG 时的第一反应是"多检索几条，总比少了好"。但实际上，如果你检索了 20 条文档，其中只有 3 条真正相关，那 17 条噪音会严重干扰模型的判断。

配套代码里的 `context-demo.ts` 用一个极端例子演示了这个问题：同一个"给 `add` 函数写单测"的任务，一个版本在 System Prompt 里塞满了不相关的历史（PostgreSQL 连接池、Redis 缓存穿透、K8s HPA 配置等），另一个版本只告诉模型"你是一个 TypeScript 工程师，擅长写 Vitest 单元测试"。

```typescript
// context-demo.ts 节选

// 污染版：一堆不相关的历史
const POLLUTED_MESSAGES: Message[] = [
  {
    role: 'system',
    content: `你是一个 AI 助手。
用户之前在做数据库迁移，遇到了 PostgreSQL 连接池耗尽的问题。
用户之前还在研究 Redis 缓存穿透的方案。
用户之前讨论过 Kubernetes HPA 的配置。
用户之前问过 Stripe Webhook 签名验证的问题。
用户之前在分析 AWS S3 存储成本优化方案。
现在用户需要写代码。`,
  },
  { role: 'user', content: '帮我给这个函数写单测：...' },
]

// 精确版：只给当前任务需要的信息
const CLEAN_MESSAGES: Message[] = [
  {
    role: 'system',
    content: '你是一个 TypeScript 工程师，擅长写单元测试。使用 Vitest 框架，测试要覆盖正常情况和边界情况。',
  },
  { role: 'user', content: '帮我给这个函数写单测：...' },
]
```

运行 `pnpm context-demo` 可以看到：精确 Context 版本的输出更聚焦（直接用 Vitest 写测试），污染版本则多了很多无关的铺垫和解释。

### Compress：历史压缩

对话越长，历史 Token 越多。到了一定长度，要么超出窗口，要么中间信息被"遗忘"。**Compress 策略是用 LLM 自己把冗长的历史压缩成摘要**，保留要点，丢弃细节。

`compress-history.ts` 演示了这个技巧。模拟一段电商系统设计的多轮对话（11 条消息，讨论了技术选型、表设计、库存方案、搜索方案等），然后用 LLM 压缩：

```typescript
// compress-history.ts 节选

async function compressHistory(history: Message[]) {
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
```

压缩后的摘要保留了所有关键决策（Next.js + PostgreSQL、预扣库存方案、ES 搜索、推荐系统三层架构），但字符数减少了约 40%。最重要的是，压缩后用摘要继续对话，模型仍然能准确回忆之前的决策。

实际应用中，推荐的做法是**滑动窗口压缩**：保留最近 2~3 轮的完整对话，把更早的历史压缩成摘要，放在 System Prompt 里。

### Isolate：任务隔离

复杂任务不要让一个 Agent 一口气做完，而是**拆成多个子任务，每个子任务用独立的 Context**。

`context-demo.ts` 的第三个实验演示了"研究与实现分离"的模式：

```typescript
// context-demo.ts 节选

// Step 1：研究阶段（宽 Context，探索用）
const researchMessages: Message[] = [
  {
    role: 'user',
    content: `我需要在 Next.js 16 应用里实现用户认证。
请简要对比以下方案的适用场景（每项 2-3 句话即可）：
1. NextAuth.js (Auth.js)
2. Clerk
3. 手写 JWT + bcrypt
不需要写代码，只需要给出选型建议。`,
  },
]

// Step 2：确认选型后，用全新 Context 实现
const implementMessages: Message[] = [
  {
    role: 'system',
    content: '你是一个 Next.js 16 工程师，使用 App Router。',
  },
  {
    role: 'user',
    content: `实现 NextAuth.js v5 的 Google OAuth 登录。
只需要给出 auth.ts 配置文件的核心代码，不超过 30 行。`,
  },
]
```

研究阶段和实现阶段用完全独立的 Context。研究阶段的"对比三个方案的探索性讨论"不会污染实现阶段的 Context。实现阶段只看到它需要知道的："你是 Next.js 工程师，用 Auth.js v5 实现 Google OAuth"。

这个模式在上一篇 A2A 中也有体现：Orchestrator 把任务拆分给不同 Agent，每个 Agent 持有自己的最小 Context，互不干扰。

---

## 对抗验证：高级 Context Engineering 技巧

前面四个策略解决的是"怎么管理 Context 的大小"。还有一个经常被忽视的问题：**Context 的设计方式会影响输出的可靠性**。

LLM 有一个著名的弱点叫 **Sycophancy（讨好性）**：模型倾向于顺着用户的意思说话，而不是给出客观判断。如果你让一个 Agent 审查代码，它可能倾向于少报问题（怕用户觉得它事多），也可能倾向于多报问题（怕漏报显得不专业）。

`adversarial-verify.ts` 演示了一种解决方案：**对抗验证模式（Adversarial Verification）**。核心思路是利用三个有对立激励的角色互相制衡：

```typescript
// adversarial-verify.ts 节选

// Agent 1：Bug-Finder — 激励尽可能多地找问题
// 评分标准设计成"找到的问题越多分越高"
const SCORING_GUIDE = `
问题严重程度评分标准：
- 低危（+1分）：代码规范问题，不影响安全性
- 中危（+5分）：可能导致 bug 或性能问题
- 高危（+10分）：安全漏洞，可能被攻击者利用
`

// Agent 2：Adversarial — 激励推翻不成立的指控
// "成功推翻一个假问题得分，推翻错了扣 2 倍分"
// 这个惩罚机制让它不会盲目推翻所有问题

// Agent 3：Referee — 中立裁判，做最终判断
// 给出"确认问题"和"误报问题"的分类列表
```

三个 Agent 串行执行：Bug-Finder 先产出"问题超集"，Adversarial 挑战其中不成立的，Referee 综合两方意见做最终裁定。

运行 `pnpm adversarial-verify`，你会看到：Bug-Finder 找出了 12 个问题，Adversarial 推翻了其中 7 个，Referee 最终确认了 5 个真正严重的安全漏洞（MD5 密码哈希、Token 未签名、SQL 注入等），过滤掉了误报。

这个模式的本质是 **Context Engineering**：通过精心设计每个 Agent 的 System Prompt 和激励机制，让它们在各自的 Context 中发挥最大价值，再通过组合产出更可靠的结果。

---

## 踩坑与最佳实践

### 1. 不要把 Context Window 当"越大越好"的优势

Context Window 从 4K 到 128K 到 200K，很多人觉得"窗口够大就不用管 Context 了"。但大窗口只解决了"能装得下"的问题，没解决"装什么"和"怎么装"的问题。实测中，即使窗口够大，把 10 万 Token 的无关信息塞进去，模型质量依然会下降。

### 2. System Prompt 是最值钱的 Context

System Prompt 位于 Context 的开头，注意力权重最高。把最关键的约束、角色定义、行为规则放在 System Prompt 里，其余信息通过工具调用、检索、压缩等方式动态注入。

### 3. 长对话要主动管理历史

不要让对话历史无限增长。根据任务性质选择策略：
- 简单问答：保留最近 3~5 轮即可
- 复杂项目：每 10 轮做一次压缩
- 多步骤任务：完成一步后清理该步骤的中间产物

### 4. 检索要宁缺毋滥

RAG 系统中，检索到 5 条高相关文档，比检索到 20 条半相关文档效果好得多。设置相似度阈值，低于阈值的结果宁可不返回。

### 5. 信息要做"预处理"再塞入 Context

不要把工具调用的原始 JSON 直接塞进 Context。提取关键字段，格式化成简洁的文本。一个 API 返回 500 行 JSON，可能只有 3 个字段是 LLM 需要的。

---

## 小结

- **Context Engineering 是 AI 工程的核心竞争力**：不是写好一条 Prompt 就够了，而是要管理模型每次推理时看到的全部上下文
- **四策略框架（Write / Select / Compress / Isolate）提供了系统化的管理方法**：信息外置、精准检索、历史压缩、任务隔离，按场景组合使用
- **Context 的设计方式直接影响输出质量**：对抗验证模式展示了通过激励设计来提升可靠性的高级技巧

Context Engineering 贯穿 AI 应用开发的方方面面。从这篇开始，我们正式进入工程化阶段，下一篇会用 Next.js + Vercel AI SDK 搭建一个完整的 AI 应用。

---

**下一篇**：用 Next.js + Vercel AI SDK 搭一个 AI 应用

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 16 篇*

---

**Context Engineering 这个概念，其实我每天用 Claude Code、Cursor 这些 AI 编码助手的时候都在践行。怎么给 Agent 提供最有效的上下文、怎么避免信息过载，直接决定了 AI 工具的实际效果。如果你也在折腾 AI 编码助手，欢迎加我交流，不管主力是哪家的，能聊到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
