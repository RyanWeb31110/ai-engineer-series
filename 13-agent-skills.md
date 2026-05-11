# Agent Skills：用自然语言给 Agent 注入专业能力

> 一段精心编写的提示词，就是 Agent 的一项可插拔技能

---

前两篇我们分别用 MCP 和 Plugin 给 Agent 接入了外部工具。但你有没有想过一个问题：不是所有能力都需要调 API。比如"帮我 Review 这段代码"、"设计一套 REST API"、"把这个需求拆成测试用例"，这些任务不需要任何外部工具，只需要 Agent 具备对应领域的专业知识和思维方式。

怎么给 Agent "装"上这些能力？答案是 **Agent Skills**：用自然语言编写的、结构化的提示词模块，每个模块封装一个领域的专业能力。注入到 system prompt 里，Agent 就立刻变成了这个领域的专家。

---

## 什么是 Agent Skill

**Skill** 不是新技术，它本质上就是一段精心设计的提示词。但和随手写的 prompt 不同，Skill 有明确的结构：

```typescript
// basic-skill.ts 节选

interface Skill {
  /** 技能名称 */
  name: string
  /** 技能描述，一句话说明用途 */
  description: string
  /** 注入到 system prompt 的指令文本 */
  instruction: string
  /** 输出格式约束（可选） */
  outputFormat?: string
  /** 示例对话（可选，用于 few-shot） */
  examples?: Array<{ user: string; assistant: string }>
}
```

五个字段，每个都有明确职责：

- **`name`**：技能的标识符，路由时用它来匹配
- **`description`**：一句话描述用途，让路由器（或人类）快速判断适用场景
- **`instruction`**：核心指令，告诉 LLM "你是谁、你怎么做、你遵循什么规则"
- **`outputFormat`**：约束输出格式，确保结果结构一致、程序可解析
- **`examples`**：few-shot 示例，用具体的输入输出对告诉 LLM 你期望的质量标准

这个结构看着简单，但它解决了一个关键问题：**可复用性**。同一个 Skill 可以注入到不同的 Agent、不同的对话中，效果一致。

---

## 写一个 SQL 专家技能

光看定义太抽象，来写一个具体的例子。假设我们需要一个"SQL 查询专家"，用户用自然语言描述数据需求，Agent 生成优化过的 SQL：

```typescript
// basic-skill.ts 节选

const sqlExpertSkill: Skill = {
  name: 'SQL Expert',
  description: 'Generates optimized SQL queries from natural language descriptions',
  instruction: `You are an expert SQL developer. When users describe data requirements in natural language, you:

1. Analyze the requirement and identify the tables, columns, and relationships involved
2. Generate a correct, optimized SQL query (PostgreSQL dialect)
3. Explain the query logic step by step
4. Point out potential performance issues and suggest indexes if needed

Rules:
- Always use explicit JOIN syntax (never implicit joins in WHERE clause)
- Use table aliases for readability (e.g., u for users, o for orders)
- Add comments in the SQL for complex logic
- Prefer CTEs over subqueries for readability
- Always consider NULL handling`,
  outputFormat: `Return the result in this format:
\`\`\`sql
-- Your SQL query here
\`\`\`

**Explanation**: Step-by-step explanation of the query logic.

**Performance Notes**: Any indexing or optimization suggestions.`,
  examples: [
    {
      user: 'Find the top 5 customers who spent the most in the last 30 days',
      assistant: `\`\`\`sql
-- Top 5 customers by total spending in last 30 days
SELECT u.id, u.name, u.email, SUM(o.total_amount) AS total_spent
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND o.status = 'completed'
GROUP BY u.id, u.name, u.email
ORDER BY total_spent DESC
LIMIT 5;
\`\`\`

**Explanation**: Join users with orders, filter completed orders in last 30 days, aggregate and rank.

**Performance Notes**: Index on orders(user_id, created_at, status).`,
    },
  ],
}
```

注意 `instruction` 的写法：先定义角色（"You are an expert SQL developer"），再列出行为步骤（1、2、3、4），最后给出约束规则（Rules）。这个"角色 → 步骤 → 规则"的三段式结构，是写 Skill 指令的通用模式。

### 编译与注入

有了 Skill 定义，下一步是把它编译成 system prompt 并注入到 LLM 调用中：

```typescript
// basic-skill.ts 节选

function compileSkill(skill: Skill): string {
  const parts: string[] = []

  // 角色与指令
  parts.push(`## Skill: ${skill.name}`)
  parts.push('')
  parts.push(skill.instruction)

  // 输出格式约束
  if (skill.outputFormat) {
    parts.push('')
    parts.push('## Output Format')
    parts.push('')
    parts.push(skill.outputFormat)
  }

  // Few-shot 示例
  if (skill.examples && skill.examples.length > 0) {
    parts.push('')
    parts.push('## Examples')
    for (const ex of skill.examples) {
      parts.push('')
      parts.push(`**User**: ${ex.user}`)
      parts.push('')
      parts.push(`**Assistant**: ${ex.assistant}`)
    }
  }

  return parts.join('\n')
}
```

`compileSkill` 把结构化的 Skill 对象拼接成一段连贯的 system prompt。调用时只需要一行：

```typescript
const response = await openai.chat.completions.create({
  model: MODELS.GPT5_CODEX,
  temperature: 0.2,
  messages: [
    { role: 'system', content: compileSkill(sqlExpertSkill) },
    { role: 'user', content: userQuery },
  ],
})
```

运行 `pnpm basic`，同一个问题分别用"有技能"和"无技能"两种方式调用，你会看到明显差异：有技能注入时，Agent 输出格式规范、包含 CTE、有性能建议；没有技能时，Agent 给出的 SQL 虽然正确但缺少优化和解释。

---

## 技能路由：让 Agent 自动选技能

一个 Agent 只有一个技能太浪费了。实际场景中，Agent 往往需要具备多种能力：Review 代码、设计 API、写测试用例。但同一时刻只需要激活一个技能。问题来了：**怎么根据用户的请求，自动选择最合适的技能？**

这就是**技能路由（Skill Router）**要解决的问题。

### 路由策略

技能路由有两种常见策略：

**策略一：关键词匹配**。扫描用户输入中的关键词，比如出现"review"就选 Code Reviewer，出现"test"就选 Test Writer。优点是零成本、零延迟；缺点是容易误判，"review the test results"该选哪个？

**策略二：LLM 意图分类**。让 LLM 分析用户请求的意图，通过 Function Calling 选出最合适的技能。准确率高，但多一次 LLM 调用。

我们用策略二来实现，因为它更通用：

```typescript
// skill-router.ts 节选

// 技能注册表
const SKILL_REGISTRY: Record<string, Skill> = {
  code_reviewer: {
    name: 'Code Reviewer',
    description: 'Reviews code for bugs, security issues, and best practices',
    instruction: `You are a senior code reviewer. When given code to review, you:
1. Check for bugs and logical errors
2. Identify security vulnerabilities (injection, XSS, etc.)
3. Evaluate code style and readability
4. Suggest concrete improvements with code examples

Severity levels: CRITICAL (must fix), WARNING (should fix), INFO (nice to have).`,
    // ...
  },
  api_designer: {
    name: 'API Designer',
    description: 'Designs RESTful API endpoints following best practices',
    // ...
  },
  test_writer: {
    name: 'Test Writer',
    description: 'Writes comprehensive test cases for given code or requirements',
    // ...
  },
}
```

路由器的核心是一个 Function Calling 工具，它的参数里包含所有可选技能：

```typescript
// skill-router.ts 节选

function buildRouterTool(): ChatCompletionTool {
  const skillNames = Object.keys(SKILL_REGISTRY)
  return {
    type: 'function',
    function: {
      name: 'select_skill',
      description:
        'Analyze the user request and select the most appropriate skill to handle it.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            enum: skillNames,
            description: `Available skills: ${skillNames.map(k =>
              `${k} (${SKILL_REGISTRY[k].description})`
            ).join('; ')}`,
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why this skill is the best match',
          },
        },
        required: ['skill_name', 'reason'],
      },
    },
  }
}
```

整个流程是两步调用：

1. **路由调用**：把用户消息 + 路由工具发给 LLM，`tool_choice: 'required'` 强制 LLM 必须选一个技能
2. **执行调用**：用选中的技能编译 system prompt，再次调用 LLM 处理用户请求

```typescript
// skill-router.ts 节选

async function routeToSkill(userMessage: string): Promise<{ skill: Skill; reason: string }> {
  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_CODEX,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are a task router. Analyze the user request and select the most appropriate skill.' },
      { role: 'user', content: userMessage },
    ],
    tools: [buildRouterTool()],
    tool_choice: 'required',
  })

  const toolCalls = response.choices[0]?.message.tool_calls ?? []
  const args = JSON.parse(toolCalls[0].function.arguments)
  return { skill: SKILL_REGISTRY[args.skill_name], reason: args.reason }
}
```

运行 `pnpm router`，三个不同类型的请求会被自动路由到对应技能：

```
[User] Please check this Python function for bugs: ...
[Router] Selected skill: Code Reviewer
[Router] Reason: User asks to check Python function for bugs

[User] I need to build a blog platform. Design the API endpoints...
[Router] Selected skill: API Designer
[Router] Reason: The user asks to design API endpoints

[User] Write test cases for a function called calculateDiscount...
[Router] Selected skill: Test Writer
[Router] Reason: User asks to write test cases for a function
```

路由准确率取决于两个因素：技能的 `description` 写得够不够清晰，以及路由 prompt 里有没有给 LLM 足够的上下文来做判断。

---

## 技能组合：Pipeline 模式

单个技能处理单个任务已经很有用了，但真正强大的是**技能组合**：让多个技能像流水线一样协作，前一个技能的输出作为后一个技能的输入。

举个场景：产品经理给了一句模糊需求"我们需要一个收藏功能"。你想一步到位地得到：需求文档 → API 设计 → 测试用例。手动做需要三轮对话，但用技能管道（Pipeline）可以一次搞定。

```typescript
// skill-compose.ts 节选

interface PipelineStep {
  skill: Skill
  /** 传给该技能的消息模板，{{prevOutput}} 会被替换为上一步输出 */
  promptTemplate: string
}

async function runPipeline(
  steps: PipelineStep[],
  initialInput: string,
): Promise<string[]> {
  const outputs: string[] = []
  let prevOutput = ''

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const systemPrompt = compileSkill(step.skill)

    // 把模板中的变量替换为实际值
    const userMessage = step.promptTemplate
      .replace('{{input}}', initialInput)
      .replace('{{prevOutput}}', prevOutput)

    const response = await openai.chat.completions.create({
      model: MODELS.GPT5_CODEX,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const output = response.choices[0]?.message.content ?? ''
    outputs.push(output)
    prevOutput = output
  }

  return outputs
}
```

定义管道：

```typescript
// skill-compose.ts 节选

const pipeline: PipelineStep[] = [
  {
    skill: requirementAnalyst,
    promptTemplate: '{{input}}',
  },
  {
    skill: apiDesigner,
    promptTemplate: 'Based on the following requirements, design the REST API:\n\n{{prevOutput}}',
  },
  {
    skill: testGenerator,
    promptTemplate: 'Generate integration test cases for the following API design:\n\n{{prevOutput}}',
  },
]
```

运行 `pnpm compose`，你会看到三个技能依次执行：

```
[Feature Request] We need a bookmark feature. Users should be able to save
articles they like and organize them into collections.

--- Pipeline Step 1: Requirement Analyst ---
[Output] Core Need: Users want to save articles for later and organize
saved items into named collections...

--- Pipeline Step 2: API Designer ---
[Output] POST /api/v1/bookmarks
Request: { "articleId": "art_123" }
Response 201: { "id": "bm_456", ... }
...

--- Pipeline Step 3: Test Generator ---
[Output] describe("Bookmarks API", () => {
  it("should create a bookmark (happy path)", () => { ... })
  it("should return 409 when bookmark already exists", () => { ... })
  ...
})
```

一句模糊需求，经过三个技能的流水线处理，输出了完整的需求文档、API 设计和测试用例。每个技能专注自己的领域，组合起来就是一个强大的自动化工作流。

---

## 踩坑与最佳实践

### 1. instruction 的三段式结构

写 Skill 指令时，遵循"角色 → 步骤 → 规则"的结构：先用一句话定义角色（"You are a senior code reviewer"），再列出执行步骤（1、2、3），最后给出约束规则（Rules）。这个结构让 LLM 明确知道"我是谁、我该做什么、我不能做什么"。

### 2. outputFormat 是质量的保障

没有 `outputFormat`，LLM 的输出格式每次都可能不同，下游程序很难解析。加了 `outputFormat`，输出结构一致，方便 Pipeline 的下一步接收。如果你的 Skill 输出需要被程序处理（而不是直接给人看），`outputFormat` 是必须的。

### 3. 路由调用用低 temperature

路由是一个分类任务，不需要创意。把路由调用的 `temperature` 设为 0，让 LLM 稳定地选出最匹配的技能。执行调用的 `temperature` 可以稍高一些（0.2~0.5），取决于任务性质。

### 4. Pipeline 的上下文膨胀问题

Pipeline 模式中，每一步都把上一步的完整输出传给下一步。如果中间某一步输出很长（比如完整的 API 设计文档），后续步骤的 token 消耗会急剧增加。解决办法是在 `promptTemplate` 中加一层摘要指令，或者只传关键信息而不是全部输出。

### 5. Skill 和 Function Calling 的区别

**Skill 改变的是 Agent "怎么想"**，Function Calling 改变的是 Agent "能做什么"。Skill 通过 system prompt 注入知识和行为模式，不需要外部工具；Function Calling 通过工具定义让 Agent 调用外部 API。两者可以组合使用：一个 Agent 可以同时拥有 Skill（专业知识）和 Tool（执行能力）。

---

## 小结

- **Skill 是结构化的提示词模块**：用 name、instruction、outputFormat、examples 四个字段封装一个领域的专业能力，注入 system prompt 即可生效，零代码改造
- **技能路由让 Agent 自动匹配能力**：通过 Function Calling 做意图分类，根据用户请求动态加载最合适的技能，一个 Agent 可以胜任多种角色
- **Pipeline 模式实现技能协作**：多个技能串联成流水线，前一步输出作为后一步输入，从一句模糊需求到完整的技术方案，一次调用搞定

下一篇我们把 MCP、Plugin、Skills 三种集成方式放在一起对比，帮你理清什么场景该用哪个。

---

**下一篇**：MCP、Plugin、Skills：三种集成方式怎么选

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 13 篇*

---

**另外，这篇讲的 Skill 本质上就是在给 AI 写"岗位说明书"。我平时也在用 Claude、GPT、Gemini 折腾各种类似的玩法，比如用 Skill 组合搭工作流、用 Agent 自动化日常开发任务。如果你也在用 AI 编码助手，不管主力是哪家的，欢迎加我聊聊，能交流到一块去就行。**

**加我微信，备注「AI编程」，拉你进交流群：**

`[你的微信号]`
