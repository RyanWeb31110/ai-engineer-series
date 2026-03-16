# ReAct：让 AI 学会边想边做

> 从"调工具"到"先想再调"，一个 Prompt 的变化让 Agent 的行为可解释、可调试

---

上一章把 RAG 的检索质量优化到位了，现在我们回到 Agent 这条线。

第 04 章我们讲了 Function Calling 和 Agentic Loop：模型识别意图，调用工具，拿到结果，循环直到任务完成。

这套机制能跑，但你可能已经遇到了一个问题：**模型为什么调这个工具？模型为什么传了这些参数？模型为什么连续调了三次还没给出答案？**

你不知道。因为模型的推理过程是个黑盒，你只能看到最终的工具调用和结果。

**ReAct（Reasoning + Acting）** 解决的就是这个问题。它让模型在每一步都先把思考过程写出来，再决定行动。这不是一个新的 API，而是一种 **Prompt 设计模式**，通过在 System Prompt 中约定格式，让模型的推理过程变得可观察、可调试。

---

## 基础 Agentic Loop 的问题

先回顾第 04 章的基础 Agentic Loop：

```
用户: "专业版套餐年付多少钱？"

[第 1 轮] → 模型调用 search_knowledge({"query": "套餐价格"})
[第 1 轮] → 结果: "专业版 299 元/月，年付 85 折"
[第 2 轮] → 模型调用 calculate({"expression": "299 * 12 * 0.85"})
[第 2 轮] → 结果: 3049.8
[第 3 轮] → 模型回答: "专业版年付价格为 3049.8 元"
```

结果是对的，但过程你看不到：

- 模型是怎么知道要先查价格再算折扣的？
- 如果第一步查到的信息不够，它会怎么处理？
- 如果计算结果不合理，它会不会自我修正？

在基础模式下，这些推理完全在模型内部完成，你只能看到 Action 和 Result。一旦出了问题（比如模型传了错误参数，或者反复调同一个工具），调试就变成了猜谜。

---

## ReAct：把推理过程暴露出来

ReAct 是 2022 年由 Yao et al. 在论文《ReAct: Synergizing Reasoning and Acting in Language Models》中提出的。核心思想非常简单：**让模型在每一步都先输出一段推理文本（Thought），然后再决定行动（Action），拿到结果后继续推理**。

三个角色一目了然：

- **Thought**：模型的推理过程，分析当前信息、判断下一步该做什么
- **Action**：调用工具，执行具体操作
- **Observation**：工具返回的结果

同一个问题，ReAct 模式下的执行过程：

```
用户: "专业版套餐年付多少钱？"

[Step 1]
  Thought: 用户问的是专业版套餐年付的价格。我需要先查到专业版的月付价格和年付折扣，
           然后再计算总价。先去知识库查一下套餐信息。
  Action:  search_knowledge({"query": "套餐价格"})
  Observation: {"content": "专业版 299 元/月，年付享 85 折"}

[Step 2]
  Thought: 知识库返回了关键信息：专业版月费 299 元，年付 85 折。
           年付总价 = 299 × 12 × 0.85。我需要用计算器确认一下结果。
  Action:  calculate({"expression": "299 * 12 * 0.85"})
  Observation: {"result": 3049.8}

[Step 3]
  Thought: 计算结果是 3049.8 元。信息已经齐全了，可以回答用户的问题。
  Answer:  专业版套餐年付价格为 3049.8 元（月费 299 元 × 12 个月 × 85 折）。
```

区别一目了然：每一步都有 Thought，你能看到模型**为什么**做出这个决定。这在调试和优化 Agent 时价值巨大。

---

## 实现 ReAct 只需要改 System Prompt

ReAct 不需要特殊的 API 或框架，它的实现完全依赖 System Prompt 的约束。核心改动只有一处：在 System Prompt 中告诉模型遵循 Thought → Action → Observation 的格式。

```typescript
// react-loop.ts 节选

const REACT_SYSTEM_PROMPT = `你是一个善于推理的智能助手。

你在回答问题时，遵循 ReAct 思维模式：先思考，再行动，然后根据观察结果继续推理。

规则：
1. 在每一轮回复中，先在开头写下你的思考过程（以"Thought:"开头）
2. 如果你需要查询外部信息，调用对应的工具
3. 拿到工具返回的结果后，在下一轮继续思考，看看是否需要更多信息
4. 直到你有足够的信息来回答问题，才给出最终答案（以"Answer:"开头）

思考过程中要：
- 分析用户问题的关键要素
- 判断当前已有的信息是否足够
- 如果不够，决定需要调用哪个工具来获取缺失的信息
- 拿到信息后，判断是否可以组合出完整答案`
```

循环结构和第 04 章的 Agentic Loop 完全一样，唯一的区别是模型在每轮回复时，会先输出一段 Thought 文本，然后才决定是否调用工具：

```typescript
// react-loop.ts 节选

while (step < MAX_STEPS) {
  step++

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    tools,
    messages,
  })

  const choice = response.choices[0]
  const toolCalls = choice.message.tool_calls ?? []

  // 打印模型的文本输出（包含 Thought）
  if (choice.message.content) {
    console.log(`\n[Model]\n${choice.message.content}`)
  }

  // 有工具调用 → Action 阶段
  if (toolCalls.length > 0) {
    messages.push(choice.message)

    for (const toolCall of toolCalls) {
      const { name, arguments: args } = toolCall.function
      console.log(`\n[Action] ${name}(${args})`)

      const result = dispatchTool(name, args)
      console.log(`[Observation] ${result}`)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }
    continue
  }

  // 无工具调用 → 最终答案
  console.log(choice.message.content)
  break
}
```

注意：在 OpenAI 的 Chat Completions API 中，模型可以在同一轮回复里**同时**输出文本（Thought）和工具调用（Action）。`choice.message.content` 包含思考文本，`choice.message.tool_calls` 包含工具调用请求，两者可以并存。这正是 ReAct 能够工作的基础。

---

## ReAct 的真正价值：可调试性

ReAct 的核心价值不是"让模型更聪明"，而是**让你能看见模型在想什么**。

这在以下场景特别有用：

**场景一：定位工具调用错误**

```
Thought: 用户问的是北京的天气，我需要调用天气查询工具。
Action:  get_weather({"city": "Beijing"})  ← 传了英文名
Observation: {"city": "Beijing", "temperature": "N/A"}
```

看到 Thought 后你立刻知道：模型理解了意图，但传参时用了英文。修复方式很明确：在工具的 description 里强调"请使用中文城市名"。

如果没有 Thought，你只会看到 `get_weather({"city": "Beijing"})` 返回了空数据，不知道是意图理解错了，还是参数格式错了，还是工具本身有问题。

**场景二：发现推理链断裂**

```
Thought: 用户问年付价格。我查到月费 299 元。直接乘以 12 就行了。
Action:  calculate({"expression": "299 * 12"})
```

Thought 暴露了问题：模型忘了 85 折优惠。你可以在 System Prompt 里加一句"计算价格时注意检查是否有折扣"来修复。

**场景三：诊断循环调用**

```
Step 3 - Thought: 上一步的结果不太对，我再查一次。
Step 4 - Thought: 还是没找到，换个关键词试试。
Step 5 - Thought: 还是不行，再试一次...
```

Thought 让你看到模型在"挣扎"，知道是检索质量问题还是 Prompt 引导问题，而不是盲目等它循环到上限。

---

## 代码实战

`08-react-agent/src/` 目录下有两个文件：

**`react-loop.ts`：完整的 ReAct 循环**

配置了三个工具（天气查询、知识库搜索、计算器），跑三个递进的场景：

```bash
cd 08-react-agent && pnpm react
```

- 场景一：简单问题，一步就能解决（查天气）
- 场景二：需要多步推理的问题（先查价格，再算折扣）
- 场景三：需要组合多个工具结果的复杂问题（查天气 + 查知识库 + 综合建议）

每个场景都会打印完整的 Thought → Action → Observation 链路。

**`react-vs-basic.ts`：两种模式对比**

```bash
pnpm compare
```

用同一个问题分别跑基础 Agentic Loop 和 ReAct Loop，直观对比输出差异：基础模式只有 Action 和 Result，ReAct 模式每一步都有 Thought。

---

## 踩坑与最佳实践

### 1. ReAct 的 Thought 会增加 Token 消耗

模型输出 Thought 文本也是要花 Token 的。一个 3 步的 ReAct 循环，Thought 大约多出 200~500 个 Token（取决于模型的"话多程度"）。对于简单任务，这个额外成本不值当。

实践：对简单的查询类任务（查天气、查汇率），用基础 Agentic Loop 就够了；对需要多步推理、多工具协作的复杂任务，ReAct 的可调试性值回票价。

### 2. 不要在 System Prompt 里强行规定格式细节

有人会在 System Prompt 里写死格式要求，比如"必须先写 `Thought:` 再写 `Action:` 再写 `Observation:`"。这对早期的纯文本补全模型有用，但对现在的 Chat 模型来说，模型已经通过 `tool_calls` 来表达 Action，不需要再用文本格式表示。

过度约束格式反而会导致模型"两头不靠"：既输出了格式化的文本，又发起了 tool_calls，解析起来更麻烦。

推荐做法：只约束 Thought 的输出（要求模型在文本里写出推理过程），Action 和 Observation 交给 Function Calling 机制处理。

### 3. Thought 是调试利器，但生产环境要考虑是否暴露

ReAct 的 Thought 包含模型的内部推理，开发和调试时非常有用。但在面向用户的产品里，直接把 Thought 展示出来可能会：

- 暴露系统的工具名称和内部逻辑
- 让用户看到模型"犹豫不决"的过程，降低信任感
- 增加 UI 的信息密度

实践：开发环境打开 Thought 输出便于调试，生产环境只返回最终答案，Thought 只写入日志。

### 4. ReAct 是框架的基础，不是终点

LangChain、LangGraph、Mastra 等 Agent 框架，底层的 Agent 执行模式大多基于 ReAct 或其变体。理解了 ReAct 的 Thought → Action → Observation 循环，你再去看这些框架的源码，会发现它们做的事情本质一样，只是加了状态管理、错误恢复、并行执行等工程化的能力。

下一篇就会用框架来搭建更复杂的 Agent，但手写一遍 ReAct 循环，是理解 Agent 执行逻辑的最好方式。

---

## 小结

- **ReAct = Reasoning + Acting**，核心是让模型在每一步先输出思考过程（Thought），再决定行动（Action），根据结果（Observation）继续推理
- **实现成本极低**：和基础 Agentic Loop 相比，只需要改 System Prompt，循环结构完全不变
- **最大价值是可调试性**：Thought 让你能看到模型的推理链路，快速定位工具选择错误、参数填写错误、推理链断裂等问题

理解了 ReAct 之后，你就掌握了 AI Agent 最核心的执行模式。下一步是用现成的框架来处理更复杂的场景：状态管理、条件分支、循环重试、多 Agent 协作。

---

**下一篇**：Agent 实战：用 LangGraph / Mastra 搭任务执行器

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 08 篇*
