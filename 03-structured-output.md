# 结构化输出：让 AI 的回答变成程序能读的数据

> 从「能跑」到「可靠」，一行 JSON 背后的工程问题

---

你让 LLM 提取一段文本里的信息，在 Prompt 里写了「请输出 JSON」，模型也确实给了一段 JSON。但下一秒 `JSON.parse` 抛出异常，你去看输出，发现模型把 JSON 包在了 ` ```json ``` ` 代码块里。

修掉这个问题，下次又发现评分字段从数字 `4` 变成了字符串 `"4 分"`，类型检查又挂了。

再修，下次模型心情好，多输出了一段解释性文字在 JSON 前面，又挂了。

这不是偶发问题，是「朴素提示法」的结构性缺陷。本篇文章讲清楚问题所在，以及工程上真正可靠的解法。

---

## 朴素提示法的问题

在 Prompt 里加一句「请以 JSON 格式输出」，是大多数人第一次接触结构化输出时的做法。

```typescript
// naive-json.ts 节选

const messages = [
  {
    role: 'user',
    content: `请从以下商品评价中提取信息，以 JSON 格式输出，包含字段：
product、rating（1-5）、sentiment（positive/negative/neutral）、
summary、pros（优点数组）、cons（缺点数组）。

评价内容：${REVIEW_TEXT}

直接输出 JSON，不要加任何解释。`,
  },
]
```

运行 `pnpm naive`，你会看到模型给出了看起来合理的 JSON。但在生产环境里，这个做法至少有四个不可控的点：

**格式包裹问题**：模型经常把 JSON 放在 ` ```json ``` ` 代码块里，`JSON.parse` 直接报错。你需要用正则手动清洗，但正则不能覆盖所有情况。

**类型不保证**：`rating` 字段你期望是 `number`，模型可能给 `"4"`、`"4分"`、`4.0`，甚至 `"四星"`。每种情况都需要单独处理。

**字段名不稳定**：你写了 `rating`，模型可能输出 `score`、`stars`、`grade`。下一次调用，字段名可能又变了。

**字段缺失**：schema 越复杂，模型漏掉某个字段的概率越高。特别是嵌套结构里的可选字段。

这四个问题合在一起，意味着你的解析代码需要处理大量的防御性逻辑，而且永远无法做到 100% 可靠。

---

## Tool Use：用工具参数约束输出格式

解决这个问题的标准做法，是利用 **Tool Use**（工具调用）机制。

Tool Use 本来是用来让 LLM 调用外部工具的，比如查天气、执行代码。但它有一个副产品：模型调用工具时，必须按照工具定义的参数 **schema** 填写参数，这个过程是强约束的。

换句话说，我们可以定义一个「工具」，不真正执行它，只是借用这个机制让模型按 schema 填数据。这就是提取结构化输出的可靠方式。

### 定义工具 schema

```typescript
// tool-use.ts 节选

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_review',
  description: '从商品评价文本中提取结构化信息',
  input_schema: {
    type: 'object',
    properties: {
      product: {
        type: 'string',
        description: '商品名称，从评价中推断',
      },
      rating: {
        type: 'number',
        description: '评分，1-5 的整数',
        minimum: 1,
        maximum: 5,
      },
      sentiment: {
        type: 'string',
        enum: ['positive', 'negative', 'neutral'],
        description: '整体情感倾向',
      },
      pros: {
        type: 'array',
        items: { type: 'string' },
        description: '优点列表，每项一句话',
      },
      cons: {
        type: 'array',
        items: { type: 'string' },
        description: '缺点列表，每项一句话',
      },
    },
    required: ['product', 'rating', 'sentiment', 'summary', 'pros', 'cons'],
  },
}
```

schema 的写法和 JSON Schema 标准一致。`type` 约束字段类型，`enum` 约束枚举值，`required` 约束必填字段，`minimum`/`maximum` 约束数值范围。

### 强制调用工具

关键一步是设置 `tool_choice`，强制模型必须调用这个工具，不允许它自由回答：

```typescript
const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  tools: [EXTRACT_TOOL],
  // 强制调用指定工具，模型不能回答文字
  tool_choice: { type: 'tool', name: 'extract_review' },
  messages: [
    {
      role: 'user',
      content: `请从以下商品评价中提取结构化信息：\n\n${REVIEW_TEXT}`,
    },
  ],
})
```

### 直接取结果，不需要 parse

响应里的工具调用参数，就是符合 schema 的结构化数据：

```typescript
const toolUseBlock = response.content.find((b) => b.type === 'tool_use')
// 直接类型断言，schema 已经保证字段完整
const result = toolUseBlock.input as ProductReview

// rating 一定是 number
console.log(typeof result.rating)   // "number"
// sentiment 一定是枚举值
console.log(result.sentiment)       // "positive" | "negative" | "neutral"
// pros 一定是数组
console.log(Array.isArray(result.pros))  // true
```

运行 `pnpm tool-use`，对比 `pnpm naive` 的输出，你会看到 Tool Use 法每次给出的字段名、类型、结构完全一致。

---

## 设计一个好的 Schema

Schema 写好了，提取质量才能高。几个实践经验：

### description 比字段名更重要

模型填字段时，依赖的是 `description` 里的说明，不只是字段名。

```typescript
// 不好：模型不知道「从哪里推断」
product: { type: 'string' }

// 好：给明确的提取依据
product: {
  type: 'string',
  description: '商品名称，如果评价中没有明确提及，根据上下文推断品类即可'
}
```

### 用枚举代替自由文本

只要字段的可能取值是有限集合，就用 `enum` 而不是 `string`。

```typescript
// 不好：模型可能输出 "mostly positive"、"quite good" 等各种表达
sentiment: { type: 'string' }

// 好：强制枚举
sentiment: {
  type: 'string',
  enum: ['positive', 'negative', 'neutral']
}
```

### required 字段要慎重

`required` 里的字段，模型必须填写，无法跳过。如果某个字段在文本里根本不存在（比如评价里没提到价格），强制要求会让模型「编造」内容。

原则：只把业务逻辑真正需要的字段放进 `required`，可选信息用非必填字段。

---

## 踩坑与最佳实践

### 1. tool_choice 不设置就不可靠

如果不设置 `tool_choice: { type: 'tool', name: '...' }`，模型可以选择不调用工具，直接用文字回答。生产代码里必须强制指定，否则解析逻辑会出现空指针。

### 2. schema 嵌套不要超过两层

嵌套越深，模型填错的概率越高，调试也越麻烦。需要复杂数据结构时，优化拆成多次调用，每次提取一个简单结构，比一次提取一个大而复杂的 schema 更可靠。

### 3. 数组字段要在 description 里说清楚粒度

```typescript
// 模糊：模型可能输出整段话，也可能输出单个词
pros: { type: 'array', items: { type: 'string' } }

// 清晰：限定每一项的粒度
pros: {
  type: 'array',
  items: { type: 'string' },
  description: '优点列表，每项用一句话描述一个具体优点，3-5 项'
}
```

### 4. 先验证 schema 本身是否合法

写完 schema 后，可以用 [JSON Schema Validator](https://www.jsonschemavalidator.net/) 验证一下 schema 本身的语法是否正确，避免 API 调用时因为 schema 格式问题报错。

### 5. OpenAI 的等价写法

OpenAI 的 API 支持 `response_format: { type: 'json_schema', json_schema: { ... } }`，效果和 Tool Use 法类似，都是通过 schema 约束输出。但 Tool Use 法兼容性更好，Anthropic 和 OpenAI 都支持，迁移成本低。

---

## 小结

- **朴素提示法**（在 Prompt 里要求 JSON）无法保证格式、类型、字段完整性，生产环境不可靠
- **Tool Use 法**通过把目标 schema 定义为工具参数，让模型强制填写，从根本上解决格式问题
- Schema 设计上：用 `enum` 约束枚举值，`required` 只填业务必需字段，`description` 写清楚提取依据

掌握结构化输出之后，LLM 就从「聊天对象」变成了「可编程组件」，你可以把它的输出直接接入业务逻辑，而不是每次都写一堆防御性解析代码。

---

**下一篇**：Function Calling：给 AI 插上执行的翅膀

---

*「AI 工程师实战」系列第 03 篇*
