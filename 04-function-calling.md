# Function Calling：给 AI 插上执行的翅膀

> 从「会说」到「会做」，这一步让 LLM 从聊天工具变成执行引擎

---

你写过一个天气查询助手，Prompt 里告诉模型「你能查天气」，但每次它给的都是一段文字："根据您的需求，北京今天的天气可能是……"。

模型在猜，不是在查。

**Function Calling**（也叫 Tool Use）解决的就是这个问题：让模型在需要的时候，真正「伸手」去调用外部能力，然后把结果整合进回答里。这是 LLM 从「语言模型」走向「执行引擎」的关键一步，也是构建 AI Agent 的基础机制。

---

## 核心机制：模型不执行，模型「请求执行」

很多人第一次接触 Function Calling 时有个误解：以为是让 LLM 直接调用代码。实际上完全不是。

整个流程是这样的：

```
用户问题
    ↓
你把「工具定义」+ 用户消息 一起发给模型
    ↓
模型返回「我要调用 get_weather，参数是 {city: '北京'}」
    ↓
你的代码接收这个请求，执行真正的天气 API 调用
    ↓
你把执行结果返回给模型
    ↓
模型基于结果生成最终回答
```

模型做的事只有一件：**识别意图，生成结构化的工具调用请求**。真正的执行权始终在你手里。

这个设计有个很重要的含义：**你可以在工具执行层做任何事**。权限检查、限流、日志、错误重试，全都在你的代码里控制，模型看不到，也无法绕过。

---

## 工具定义：用 JSON Schema 描述能力

使用 Function Calling 的第一步，是用 JSON Schema 告诉模型「你有哪些工具，每个工具需要什么参数」。

以一个天气查询工具为例：

```typescript
// basic-tool.ts 节选

const WEATHER_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市的当前天气，包括温度、天气状况和体感温度',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称，如"北京"、"Shanghai"',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度单位，默认 celsius（摄氏度）',
        },
      },
      required: ['city'],
    },
  },
}
```

三个核心字段：

- `name`：工具的唯一标识，模型调用时用这个名字
- `description`：告诉模型这个工具能干什么，也是模型判断「要不要调这个工具」的依据
- `parameters`：参数的 JSON Schema，模型必须按这个格式填参数

这个结构和上一篇讲的结构化输出非常像，实际上底层机制也相同：都是借用工具调用的强约束能力，让模型输出符合 schema 的结构化数据。

---

## Agentic Loop：循环直到任务完成

有了工具定义，接下来是把它集成进对话流。核心是一个**循环结构**，通常叫做 **Agentic Loop**：

```typescript
// basic-tool.ts 节选 —— 完整的 Agentic Loop

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: userMessage },
]

let round = 0
const MAX_ROUNDS = 10

while (round < MAX_ROUNDS) {
  round++

  const response = await client.chat.completions.create({
    model: 'gpt-5.2-codex',
    max_tokens: 1024,
    tools: [WEATHER_TOOL, EXCHANGE_RATE_TOOL],
    messages,
  })

  const choice = response.choices[0]
  const toolCalls = choice.message.tool_calls ?? []

  // 有工具调用请求（注意：部分服务 finish_reason 不一定是 'tool_calls'，
  // 更可靠的判断方式是直接检查 tool_calls 数组是否有内容）
  if (toolCalls.length > 0) {
    // 第一步：把模型的回复（含 tool_calls）追加进历史
    messages.push(choice.message)

    // 第二步：遍历所有工具调用，逐一执行
    for (const toolCall of toolCalls) {
      const { name, arguments: args } = toolCall.function
      const result = dispatchTool(name, args)

      // 第三步：把工具结果追加，tool_call_id 必须和请求对应
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }
    continue
  }

  // 无工具调用，模型给出最终答案
  console.log(choice.message.content)
  break
}
```

几个细节值得注意：

**用 `tool_calls.length > 0` 而不是 `finish_reason` 来判断**。标准规范里 `finish_reason === 'tool_calls'` 代表有工具调用，但不同服务实现有差异，直接检查 `tool_calls` 数组是否非空更可靠。

**历史要完整保留**。每一轮的模型回复和工具执行结果都要追加进 `messages`。模型靠这个上下文知道「上一步做了什么、结果是什么」。

**`tool_call_id` 必须匹配**。工具结果里的 `tool_call_id` 要和对应请求的 `id` 一致，模型用这个 id 来关联请求和结果。

---

## 并行工具调用：一次提问，批量执行

当用户的问题需要多个工具时，模型可以在一次回复里同时发起多个工具调用，不用串行等待。

比如「查一下上海的天气和从北京到上海的机票」，模型可能在一轮回复里同时返回多个工具调用请求：

```
tool_calls: [search_flights(...), get_weather_forecast(...), search_hotels(...)]
```

代码处理起来结构完全一样，遍历 `tool_calls` 数组即可：

```typescript
// multi-tool.ts 节选

const toolCalls = choice.message.tool_calls ?? []
console.log(`本轮并行工具调用数: ${toolCalls.length}`)

// 把模型回复追加进历史
messages.push(choice.message)

// 遍历处理所有工具调用
for (const toolCall of toolCalls) {
  const { name, arguments: args } = toolCall.function
  const result = dispatchToolSafe(name, args)

  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  })
}
```

真实项目中，如果多个工具调用之间相互独立（比如查不同城市的天气），可以用 `Promise.all` 并行发起，减少等待时间。

---

## 工具函数怎么设计

Agentic Loop 负责「什么时候调工具」，工具函数本身负责「调了以后做什么、返回什么」。这两件事是分开的，工具函数的设计质量直接影响整个系统的可靠性。

### 单一职责：一个工具只做一件事

工具的 `description` 越清晰，模型选错工具的概率越低。而 description 能写清晰的前提，是工具本身职责单一。

```typescript
// 不好：一个工具做了两件事，description 很难写清楚
name: 'get_weather_and_suggestions'

// 好：拆成两个独立工具，各自职责清晰
name: 'get_weather'        // 只查天气数据
name: 'get_travel_tips'    // 只给出行建议
```

拆分的另一个好处是可复用：`get_weather` 在天气助手、出行助手、穿衣助手里都能用，而 `get_weather_and_suggestions` 只能用在特定场景。

### 输入：只要模型能填的参数

工具参数里只放「模型有能力从对话里推断出来的信息」。不要把内部系统参数、鉴权信息、数据库连接之类的东西放进 schema。

```typescript
// 不好：api_key 模型填不了，放这里没有意义
parameters: {
  city: { type: 'string' },
  api_key: { type: 'string' },  // 模型不知道这是什么
}

// 好：鉴权信息在工具函数内部处理，对模型不可见
function executeGetWeather(input: { city: string }): string {
  const apiKey = process.env.WEATHER_API_KEY  // 从环境变量取，模型看不到
  // ...
}
```

### 输出：裁剪到模型真正需要的字段

工具返回的内容会被放进 Context，直接影响费用和速度。真实 API 返回的数据往往很冗余，工具函数要在这里做裁剪，只保留对模型回答有用的字段。

```typescript
// basic-tool.ts 中的天气工具执行函数

function executeGetWeather(input: WeatherInput): string {
  const raw = callWeatherAPI(input.city)  // 假设返回几十个字段

  // 只提取模型需要的核心字段，其余丢弃
  return JSON.stringify({
    city: input.city,
    temperature: raw.temp_c + '°C',
    condition: raw.weather_desc,
    feels_like: raw.feelslike_c + '°C',
    humidity: raw.humidity + '%',
    // 不返回：经纬度、气压、UV 指数、云量等模型用不上的数据
  })
}
```

裁剪比例视情况而定。一般来说，给模型的信息应该「够用就好」，不是越多越好。

### 工具要幂等，写操作要谨慎

查询类工具（读数据库、调外部 API 获取信息）天然幂等，模型多次调用没有副作用，放心用。

写操作（发邮件、下单、修改数据）就需要谨慎了：

```typescript
// 写操作工具，需要在执行前做确认或记录
async function executeSendEmail(input: { to: string; subject: string; body: string }): Promise<string> {
  // 记录操作日志，方便追溯
  console.log(`[TOOL] send_email to=${input.to} subject="${input.subject}"`)

  // 真实场景可以加「人工确认」机制，或者先 dry-run
  await emailService.send(input)

  return JSON.stringify({ success: true, message_id: 'xxx' })
}
```

更进一步，如果系统里有破坏性较强的工具（删除、扣款），建议把它们单独列出来，在调度器里加二次确认逻辑，而不是让模型直接触发。

### 调度器：工具执行的统一入口

`basic-tool.ts` 里的 `dispatchTool` 函数，是所有工具调用的集中入口。这个位置很重要，适合做横切关注点：

```typescript
// basic-tool.ts 节选

function dispatchTool(name: string, args: string): string {
  const input = JSON.parse(args) as Record<string, unknown>

  // 这里可以统一加：日志、耗时统计、权限检查、限流...
  console.log(`  -> 调用工具: ${name}`)
  console.log(`     输入: ${args}`)

  switch (name) {
    case 'get_weather':
      return executeGetWeather(input as WeatherInput)
    case 'get_exchange_rate':
      return executeGetExchangeRate(input as ExchangeRateInput)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
```

所有工具的执行权都在调度器里，模型只能请求，不能绕过。这是 Function Calling 架构里最重要的安全边界。

---

## 代码实战

运行这一章的配套代码，能直观看到整个流程：

**场景一：基础单工具调用**

```bash
cd 04-function-calling && pnpm basic
```

终端会打印出每一轮 LLM 调用、工具调用入参、工具返回结果，以及最终回答。比如：

```
用户: 北京今天天气怎么样？

[第 1 轮 LLM 调用]
finish_reason: stop
  -> 调用工具: get_weather
     输入: {"city":"北京","unit":"celsius"}
     结果: {"city":"北京","temperature":"12°C","condition":"晴","feels_like":"9°C","humidity":"65%",...}

[第 2 轮 LLM 调用]
finish_reason: stop

助手: 北京目前晴，气温 12°C，体感 9°C，湿度 65%。
```

**场景二：多工具并行调用**

```bash
pnpm multi
```

用户问出行计划时，模型会在第一轮同时发起机票、酒店、天气三个工具调用，然后一次性整合结果给出建议。

---

## 踩坑与最佳实践

### 1. description 决定工具被调用的准确性

模型判断「要不要调这个工具、什么时候调」，最主要的依据是 `description`，不是 `name`。

```typescript
// 不好：太模糊，模型不清楚什么情况该调
description: '获取天气'

// 好：说清楚能返回什么，以及适用场景
description: '查询指定城市的当前天气，包括温度、天气状况和体感温度。用户问"天气怎么样"、"要不要带伞"等问题时调用。'
```

如果工具总是被错误触发，或者该调的时候没调，先检查 description 的描述是否足够清晰。

### 2. 工具执行失败不要直接抛异常

工具可能因为网络、权限、数据不存在等原因失败。直接抛异常会让整个对话崩掉，更好的做法是返回结构化的错误信息给模型：

```typescript
// multi-tool.ts 节选

function dispatchToolSafe(name: string, input: Record<string, unknown>): string {
  try {
    return executeRealTool(name, input)
  } catch (err) {
    // 告诉模型这个工具失败了，让它在回答里体现
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      tool: name,
    })
  }
}
```

模型收到错误信息后，会在最终回答里告知用户「该功能暂时无法使用」，而不是直接报错。

### 3. 工具数量不要超过 10 个

工具定义本身会占用 Token。工具越多，占用越多，也越容易让模型选错工具。

实践建议：如果工具超过 10 个，按场景分组，不同场景只传对应的工具子集，而不是每次都把所有工具都传给模型。

### 4. 避免无限循环

理论上模型可能无限次请求工具调用。生产代码里要给 Agentic Loop 加一个最大轮次限制：

```typescript
const MAX_ROUNDS = 10
let round = 0

while (round < MAX_ROUNDS) {
  round++
  // ... 正常循环逻辑
}

if (round >= MAX_ROUNDS) {
  console.error('达到最大轮次限制，任务可能未完成')
}
```

### 5. 工具结果不要太大

工具返回的内容会被放进 Context。如果工具返回了几千行数据（比如数据库查询结果），模型处理会变慢，费用也高。

实践：工具层做数据裁剪，只返回模型真正需要的字段。比如查酒店只返回前 5 条，每条只留关键字段。

---

## 小结

- **Function Calling 的本质**：模型识别意图，生成工具调用请求；你的代码执行请求，把结果返回给模型；模型整合结果生成回答，执行权始终在你手里
- **Agentic Loop** 是标准实现模式：发请求、检查 tool_calls 是否非空、执行工具、追加结果、循环，直到模型不再发起工具调用
- **工程重点**：description 写清楚、工具失败要优雅处理、生产环境加轮次上限和工具数量控制

掌握 Function Calling 之后，LLM 就有了"手"。下一步要解决的问题是：给它"记忆"——让它能查询和理解大规模私有知识库。这就是 Embedding 和 RAG 要做的事。

---

**下一篇**：Embedding 与向量数据库：AI 的长期记忆

---

*「AI 工程师实战」系列第 04 篇*
