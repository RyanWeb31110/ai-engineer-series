# LLM 是怎么工作的：Token、Attention、采样

> 搞懂这三件事，你对 LLM 的理解就超过了大多数「用户」

---

很多人调 ChatGPT / Claude 的 API 调了很久，但一直有个困惑：**为什么换个措辞，结果差那么多？为什么 Context 越长，回答越差？为什么 Temperature 调高了就开始胡说八道？**

这些问题背后，都指向同一个答案：**你需要了解 LLM 内部在干什么。**

不是要你去读论文、实现 Transformer。而是掌握三个关键概念：Token、Attention、采样，就够了。

---

## Token：LLM 看到的世界

LLM 不读"字"，也不读"词"，它读的是 **Token**。

Token 是 LLM 处理文本的基本单位。你输入一段话，LLM 第一步做的事，是把它切成一串 Token ID，然后才开始"思考"。

### Token 长什么样

来看一个具体例子。把 `Hello, world! This is a test.` 用 GPT-4o 的分词器切一下：

```
[Hello][,][ world][!][ This][ is][ a][ test][.]
```

9 个 Token。注意几个细节：
- 逗号 `,` 是独立的 Token
- `world` 前面有空格，和 `world` 合成了一个 Token：`[ world]`
- 句号 `.` 也是独立的

再来看中文：

```
原文：你好世界！这是一个测试。
Token：[你好][世界][！][这是][一个][测试][。]
```

7 个 Token。中文约 **1.5 个字 = 1 Token**，英文约 **0.75 词 = 1 Token**（也就是 1 Token ≈ 4 个英文字符）。

这个比例很重要，因为：**Token 数直接决定 API 费用和速度**。

### 代码里验证一下

项目里的 `01-llm-basics/src/tokenizer.ts` 就是用来跑这个实验的：

```typescript
import { encoding_for_model } from 'js-tiktoken'

function visualizeTokens(text: string): void {
  const enc = encoding_for_model('gpt-4o')
  const tokenIds = enc.encode(text)
  const tokens: string[] = []

  for (const id of tokenIds) {
    const bytes = enc.decode(new Uint32Array([id]))
    tokens.push(new TextDecoder().decode(bytes))
  }

  enc.free()

  // 每个 token 用方括号标注，方便肉眼观察
  const visual = tokens.map(t => `[${t.replace(/\n/g, '↵')}]`).join('')
  console.log(`${text.length} 字符 → ${tokenIds.length} tokens`)
  console.log(visual)
}
```

运行 `pnpm tokenizer`，你会看到每段文字被切成什么样，以及一个经典的「token 陷阱」演示：

```
9.11 vs 9.9 — which is larger?
```

这个问题在 2023 年难倒了很多人：早期 LLM 会回答「9.11 比 9.9 大」。模型并没有在做数值计算，它处理的是 Token 序列，`9`、`.`、`11` 是三个独立的 Token，比较的是字符串而不是数字。这是 Token 机制的典型副作用。

### Context Window：Token 的硬上限

**Context Window** 是 LLM 一次能处理的最大 Token 数。这是一个硬限制：

| 模型 | Context Window |
|------|---------------|
| Claude Sonnet 4.6 | 200K Token |
| Gemini 2.5 Pro | 200 万 Token |
| GPT-5 | 未公开（约 128K+）|
| DeepSeek-V3 | 128K Token |

200K Token 大约是一本 400 页的书。听起来很多，但在做 RAG、长对话或者大文件分析时，Token 预算是你第一个需要管理的资源。

---

## Attention：LLM 怎么"理解"语义

Token 是输入格式，但理解语义靠的是 **Attention（注意力机制）**。

### 自注意力：看整句话，而不是逐词推

在 Transformer 出现之前，语言模型（RNN/LSTM）是逐词推进的：看了第一个词，再看第二个词，记忆会随着距离衰减。长句子里，前面的信息会被"遗忘"。

Transformer 引入了 **Self-Attention（自注意力）**，做了一件不一样的事：**生成每个 Token 时，直接看整个序列，计算它和所有其他 Token 的相关性权重**。

举个例子：

```
"苹果发布了它的新产品"
```

当模型生成"它"之后的内容时，Self-Attention 会自动识别「它」和「苹果」的强关联，而不是仅仅看相邻的词。这就是为什么 LLM 能理解代词、长句子里的指代关系。

### Q/K/V：三个矩阵干一件事

Self-Attention 的数学实现用到三个矩阵：**Q（Query）、K（Key）、V（Value）**。

用一个不严格但直觉上准确的类比理解它：

- **Query**：你在搜什么（"我想找和『它』相关的信息"）
- **Key**：每个词的标签（"苹果"有一个 Key，"产品"有一个 Key）
- **Value**：实际携带的信息

计算过程是：用 Query 和所有 Key 点积算出相似度，归一化成权重，再用这个权重对所有 Value 加权求和。结果就是这个 Token 在当前上下文中的"理解"。

不需要记住数学细节。重要的结论是：**模型是并行看所有 Token 的，而不是逐个处理的。** 这也是为什么长 Context 慢、贵，计算量和 Context 长度的平方成正比。

### Multi-Head Attention：同时从多个角度理解

但单组 Q/K/V 只能从一个角度理解关系，就像只用一种标准去评判文章质量。实际模型会同时跑多组独立的注意力计算，每组叫一个 attention head，最后把所有结果拼接合并。这样模型就能同时从多个维度理解语义，而不是只有一种视角。

比如 GPT-4 大约有 96 个 attention head，每个 head 学习捕捉不同的关系：

- 有的 head 专注语法关系（主语-谓语-宾语）
- 有的 head 专注语义相似性（同义词、近义词）
- 有的 head 专注长距离指代（代词解析）

### KV Cache：加速推理的关键

推理时，模型是逐个生成 Token 的。生成每个新 Token 时，都需要拿它的 Q 去和前面所有 Token 的 K、V 做一次 Attention 计算。如果每步都从头算，代价极高。**KV Cache** 的做法是把前面 Token 的 K、V 计算结果缓存下来，生成下一个 Token 时直接复用。

这也衍生出了一个对工程师很实用的能力：**Prompt Caching**。

如果你的 System Prompt 很长（比如一个法律助手的背景知识），每次对话都重新处理这段 Prompt 代价很高。Claude 和 OpenAI 都支持对重复的 Prompt 前缀做持久化缓存，**最高可降低 90% 成本**。后面讲成本控制的章节会详细说这个。

---

## 采样：LLM 怎么决定输出什么

理解了 Token 和 Attention 之后，还有最后一个问题：LLM 每一步具体输出哪个词？

答案是：**通过采样决定**。

### LLM 的输出是概率分布

LLM 每次生成一个 Token，实际上是输出一个**概率分布**：词汇表里每个 Token 都有一个概率。比如：

```
"今天天气" → 下一个 token 的概率分布：
  "很好"   45%
  "不好"   20%
  "晴朗"   15%
  "阴沉"   10%
  其他      10%
```

从这个分布里选一个，就是采样。选法不同，结果就不同。这就是 **Temperature** 和 **Top-p** 的作用所在。

### Temperature：控制"随机"的程度

**Temperature** 是对概率分布做缩放的一个参数：

- **Temperature = 0**：几乎总是选最高概率的那个 Token（贪心解码），每次结果相同
- **Temperature = 0.7**：分布稍微平坦，有合理的多样性，推荐默认值
- **Temperature > 1**：分布更平坦，随机性增加，偶尔出现意想不到的输出

**选型建议：**

| 场景 | Temperature 推荐值 |
|------|-------------------|
| 结构化提取、代码生成、分类 | 0 ~ 0.2 |
| 通用对话、问答 | 0.5 ~ 0.7 |
| 创意写作、头脑风暴 | 0.8 ~ 1.2 |

### Top-p：另一种控制方式

**Top-p（Nucleus Sampling）** 的逻辑不同：只从**累积概率超过 p 的最小 Token 集**中采样。

比如 Top-p = 0.9，就是把概率从高到低排列，直到加起来超过 90%，只从这个集合里采样。

效果是：在概率集中时（只有几个词合适），自动缩小候选范围；在概率分散时（很多词都行），允许更多可能性。

**Temperature 和 Top-p 的关系：**
- 通常两者一起用，Temperature 先缩放分布，Top-p 再限定范围
- 不建议同时大幅调高两个，容易输出质量很差的内容
- 生产环境大多数情况只调 Temperature 就够了

### 代码里看实际效果

`01-llm-basics/src/sampling.ts` 用相同的问题跑四组配置，每组跑 3 次：

```typescript
const EXPERIMENTS = [
  {
    label: 'Greedy (temperature=0)',
    config: { model: MODELS.CLAUDE_HAIKU, temperature: 0 },
  },
  {
    label: 'Balanced (temperature=0.7)',
    config: { model: MODELS.CLAUDE_HAIKU, temperature: 0.7 },
  },
  {
    label: 'Creative (temperature=1.2)',
    config: { model: MODELS.CLAUDE_HAIKU, temperature: 1.2 },
  },
  {
    label: 'Top-p only (temperature=1, top_p=0.1)',
    config: { model: MODELS.CLAUDE_HAIKU, temperature: 1, topP: 0.1 },
  },
]

// 每组问同一个问题：「用一句话描述量子纠缠」
// 跑 3 次，观察结果的一致性 / 多样性
```

运行 `pnpm sampling`，你会直观看到：`temperature=0` 的三次输出几乎一样，`temperature=1.2` 则每次都有明显差异，偶尔出现奇怪但有创意的表达。

---

## 踩坑与最佳实践

### 1. 中文 Token 效率低，要主动控制

中文约 1.5 字 / Token，但很多人按"字数"估算 Token 数，会严重低估。实际上：

- 一篇 1000 字的中文文章，大约是 700~800 个 Token
- 中英文混排的文章，需要分段估算

工程上，调用 API 前先用 tokenizer 估算 Token 数，超出 Context Window 会直接报错。

### 2. Context 越长，注意力越"稀释"

Context Window 大，不等于能无限堆信息。实验发现，当 Context 很长时，模型对开头和结尾的内容注意力强，中间部分容易被忽略，这就是 **「Lost in the Middle」问题**。

实践：重要信息放开头或结尾，中间塞太多背景会降低回答质量。Context Engineering 章节会专门讲怎么处理这个问题。

### 3. temperature=0 不是魔法

很多人认为 temperature=0 就能得到"正确答案"。不对。temperature=0 给的是**模型认为最可能的答案**，不是"最正确的答案"。这两件事有时候一样，有时候差很远。

对于逻辑推理、数学计算等任务，用低 temperature + CoT（Chain of Thought，让模型把推理过程一步步写出来）组合，比单靠 temperature=0 可靠得多。CoT 会在下一篇 Prompt Engineering 里详细介绍。

### 4. 不同模型的分词器不一样

tiktoken 是 OpenAI 的分词器，Claude 用的是自己的分词器。同一段文字，两者的 Token 数会略有差异（通常在 5~15% 之内）。跨模型迁移时，成本估算需要重新计算。

### 5. reasoning_effort：2026 年新增的关键参数

对 Claude Opus/Sonnet 4.6 的 Extended Thinking，以及 OpenAI o3 这类推理模型，有一个新参数 `reasoning_effort`（或类似名称），控制模型在给出答案之前花多少"思考预算"。

高 reasoning_effort = 质量更好，但更慢更贵。选型经验：复杂推理任务值得拉高，简单问答任务保持默认就好。

---

## 小结

- **Token** 是 LLM 的基本处理单位，中文约 1.5 字/Token，英文约 4 字符/Token，直接影响费用和速度
- **Attention** 让模型能并行理解整个序列的语义关系，KV Cache 是推理加速和 Prompt Caching 的底层基础
- **采样参数**（Temperature / Top-p）控制输出的随机性；代码任务用低值，创意任务用高值，生产环境别轻易调太高

理解这三件事之后，你再遇到「为什么模型这样输出」的困惑，基本都能找到原因。

---

**下一篇**：Prompt Engineering：和 LLM 说话的艺术

---

*配套代码：[github.com/RyanWeb31110/ai-engineer-series](https://github.com/RyanWeb31110/ai-engineer-series)*

*「AI 工程师实战」系列第 01 篇*
