# 系列导读：AI 工程师的完整知识地图

> 从第一性原理出发，系统梳理 AI 应用层开发需要掌握的全部知识体系

---

### 前言

最近两年，「AI 工程师」这个岗位突然火了。

但很多开发者面对这个方向时，都有同一个困惑：**我知道可以调 ChatGPT 的 API，然后呢？**

Prompt、RAG、Agent、MCP、A2A、ReAct、Embedding、向量数据库、Function Calling、Context Engineering、Guardrails、LangGraph、Mastra、DSPy……这些词铺天盖地，但彼此关系是什么，该先学哪个，每个东西能解决什么问题——始终没人讲清楚。

这个系列就是为了解决这个问题。本篇从第一性原理出发，把 AI 应用层开发的完整知识体系梳理成一张地图。

---

## 一、先搞清楚：AI 工程师 vs ML 工程师

很多人混淆了这两个岗位，先说清楚：

| | AI 工程师 | ML 工程师 |
|--|-----------|-----------|
| 核心工作 | 用预训练模型构建应用 | 研究和训练模型本身 |
| 技能重点 | 集成、编排、部署、产品化 | 数学、统计、模型架构 |
| 日常 | 写 Prompt、搭 RAG、做 Agent | 跑实验、调超参、写论文 |
| 门槛 | 软件工程基础 + AI 知识 | 深度学习理论 + 数学基础 |

2026 年市场更需要 AI 工程师——大多数公司不需要从头训练模型，而是需要有人把现有 LLM 能力转化为可用产品。

**本系列聚焦 AI 工程师方向。**

---

## 二、知识体系全貌

整个知识体系分七层，从下往上依次建立：

```
┌────────────────────────────────────────────────────────────┐
│               产品层 · Full-Stack                           │
│   Next.js 16 / Vercel AI SDK / Streaming UI                │
│   Eval 评估 / Observability 监控 / 成本控制 / Guardrails    │
├────────────────────────────────────────────────────────────┤
│               协议层 · Protocols                            │
│   MCP（AI ↔ 工具/数据，AAIF 标准）/ A2A（Agent ↔ Agent）  │
├────────────────────────────────────────────────────────────┤
│               Agent 层 · Agentic AI                         │
│   ReAct / Plan-Execute / Reflection / Multi-Agent          │
│   LangGraph / Mastra / CrewAI / AutoGen                    │
├────────────────────────────────────────────────────────────┤
│               能力扩展层 · Capabilities                      │
│   Tool Use / Function Calling                              │
│   RAG / Embedding / 向量数据库 / Reranking / GraphRAG       │
├────────────────────────────────────────────────────────────┤
│               数据工程层 · Data Pipeline                     │
│   ETL（Airbyte / n8n）/ 转换（dbt / DuckDB）               │
│   编排（Airflow / Prefect）/ 向量增量更新（CDC / Upsert）   │
├────────────────────────────────────────────────────────────┤
│               Prompt 层 · Prompt Engineering               │
│   System Prompt / Few-shot / CoT / ToT / Self-Consistency  │
│   Prompt Chaining / DSPy / 结构化输出 / 注入防御            │
├────────────────────────────────────────────────────────────┤
│               底层原理 · LLM Foundation                     │
│   Transformer / Self-Attention / Multi-Head Attention      │
│   Token / Context Window / KV Cache / Positional Encoding  │
│   Temperature / Top-p / MoE / 量化 / LoRA / RLHF          │
└────────────────────────────────────────────────────────────┘
```

---

## 三、底层原理：你必须理解的 LLM 内部机制

很多人跳过这一层，直接上手调 API。这没问题，但你会发现很多现象解释不了——为什么换个措辞结果差很多？为什么 Context 太长会变蠢？为什么 Temperature 设高了胡说八道？

理解底层，才能真正驾驭上层。

### Transformer 架构核心组件

**Self-Attention（自注意力机制）**：模型生成每个 Token 时，通过 Q/K/V 矩阵计算它与序列中所有其他 Token 的相关性权重，从而聚合全局上下文。这是 LLM 理解语义的核心机制。

**Multi-Head Attention（多头注意力）**：并行运行多组注意力头，让模型同时从不同维度理解语义（比如一个头关注语法关系，另一个关注语义相似性）。

**Positional Encoding（位置编码）**：Transformer 本身不感知顺序，需要给每个 Token 注入位置信息。现代 LLM 普遍使用 RoPE（旋转位置编码），支持更长上下文的外推。

**残差连接 + 层归一化**：让深层网络训练稳定，是 Transformer 能叠到 100 层以上的工程基础。

**KV Cache**：推理时缓存键值对避免重复计算，是自回归生成的核心加速技术。衍生出 **Prompt Caching**——对重复的长 System Prompt 做持久化缓存，Claude / GPT 都支持，可降低 90% 成本。

**MoE（Mixture of Experts，混合专家）**：每次推理只激活部分专家网络，用更少计算量实现更大参数规模。DeepSeek-V3、Mixtral 都用这个架构。

### Token 与 Context Window

**Token** 是 LLM 处理文本的基本单位，由 BPE/SentencePiece 等算法切分。英文约 4 个字符 = 1 Token，中文约 1.5 个字符 = 1 Token。Token 数直接决定费用和速度。

**Context Window** 是 LLM 一次能"看到"的最大 Token 数。Claude Opus/Sonnet 4.6 是 200K（1M beta），Gemini 2.5 Pro 达到 200 万。这个数字决定了 RAG、Agent、对话历史的设计上限。

### 采样参数（必须掌握）

**Temperature**：控制输出随机性。0 = 确定性强，1+ = 创意增强但不稳定。生产环境一般用 0.1–0.7，代码任务用低值，创作任务用高值。

**Top-p（Nucleus Sampling）**：只从累积概率超过 p 的最小 Token 集中采样，平衡多样性与质量。通常和 Temperature 联合使用。

**Structured Output / JSON Mode**：通过约束解码强制模型输出合法 JSON，是工程化 AI 的关键能力。主流 LLM 都支持。

**reasoning_effort**：2026 年关键参数，控制推理模型（o3、Claude Opus/Sonnet 4.6 Extended Thinking）的思考深度，直接影响延迟和成本。

### 模型训练与优化（了解级别）

作为应用层工程师，一般不需要亲自训练，但要理解这些概念：

**RLHF（人类反馈强化学习）**：通过人类偏好数据训练奖励模型，再用 RL 对齐模型行为，是 ChatGPT 类模型背后的关键技术。

**DPO（直接偏好优化）**：RLHF 的简化替代，直接在偏好对上优化，不需要单独训练奖励模型，2025 年主流微调方案之一。

**LoRA（低秩适配）**：冻结原始权重，只训练低秩分解矩阵，把可训练参数从百亿降到百万级。微调的基础工具。

**QLoRA**：LoRA + 4-bit 量化，可在单块消费级 GPU（24GB VRAM）上微调 70B 级模型，是目前最流行的微调方案。

**量化（Quantization）**：INT8/INT4 精度压缩，减少模型体积和推理显存。Ollama 本地运行的模型基本都是量化版本。

> **推荐入门资料**：Jay Alammar 的 [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/) 是目前讲得最清楚的可视化教程。

---

## 四、Prompt 层：Prompt Engineering

这是一切的起点，也是最容易被低估的部分。

### 基础技法（必学）

**System Prompt**：在对话开始前设定 AI 角色、能力边界、输出格式的持久化指令层。是最重要的 Prompt 技巧，决定了 AI 的整体行为模式。

**Few-shot**：在 Prompt 里给 2–8 个输入/输出示例，让模型学会你想要的格式和风格。比单纯描述需求效果好很多。

**Chain of Thought（CoT）**：让模型在给出最终答案前，先把推理过程写出来。加一句「请一步一步思考」就能触发，对复杂推理任务提升显著。

**Zero-shot CoT**：不给示例，只加 `Let's think step by step`，模型会自动展开推理。

**结构化输出**：要求模型输出 JSON / XML / Markdown 表格等格式，方便程序解析。

**XML 标签结构化**：Anthropic 特别推荐用 XML 标签组织复杂 Prompt，比自然语言分隔符更稳定：

```xml
<context>
  用户是一名前端工程师，正在学习 AI 开发
</context>
<task>
  解释 RAG 的工作原理，用代码示例说明
</task>
<format>
  使用 Markdown，代码块用 TypeScript
</format>
```

### 进阶技法

**Self-Consistency**：对同一问题多次采样，取多数投票结果，提升推理稳定性。适合有唯一正确答案的推理任务。

**Prompt Chaining**：把复杂任务拆成多个串联 Prompt，前一步输出作为后一步输入。比单一超长 Prompt 更可控、可调试。

**ToT（思维树）**：维护多个推理路径的树形搜索，适合需要规划和探索的复杂问题。

**Least-to-Most Prompting**：先让模型分解子问题，再逐步解决，处理组合推理效果好。

**Negative Prompting**：明确告知模型「不要做什么」，比光说「要做什么」效果更好。

**Extended Thinking / Reasoning Models**：Claude Opus/Sonnet 4.6 的 Extended Thinking（Claude 3.7 Sonnet 已于 2026-02-19 退役）、OpenAI o3、DeepSeek-R1 等推理模型的深度思考模式，预算可控，适合数学、代码、逻辑推理等高难任务。

### DSPy：程序化提示优化

传统 Prompt Engineering 是「手动调字符串」，**DSPy** 把它变成了「编程问题」。

核心思想：用声明式签名描述任务的输入/输出，让框架自动找到最优提示，支持 MIPROv2 等优化算法：

```python
# 传统方式：手动写提示字符串，反复调整措辞
prompt = "请分析以下文本的情感..."

# DSPy 方式：声明签名，自动优化
class SentimentAnalysis(dspy.Signature):
    text: str = dspy.InputField()
    sentiment: Literal["正面", "负面", "中性"] = dspy.OutputField()

analyzer = dspy.Predict(SentimentAnalysis)
# DSPy 自动找到最优提示，实测准确率达 94%
```

DSPy 适合有大量 Prompt 需要系统化管理、且有评估数据集的场景。

### Prompt 安全

**Prompt Injection 防御**：识别并防御恶意用户通过输入覆盖系统指令的攻击，生产环境必须考虑。OWASP LLM Top 1 漏洞。

**OWASP Agentic AI Top 10（2025-12）**：2025 年 12 月专为 Agentic AI 场景发布的独立安全清单，覆盖过度授权、工具滥用、多步骤攻击、目标劫持等 Agent 特有风险，与通用 LLM Top 10 互补。

**Jailbreak 检测**：识别绕过安全限制的攻击模式。

---

## 五、能力扩展层：Tool Use & RAG

光靠 Prompt，LLM 有两个根本局限：**知识有截止日期**、**不能执行操作**。Tool Use 和 RAG 分别解决这两个问题。

### Tool Use / Function Calling

让 LLM 能够调用外部函数，是 AI 从「会说话」变成「会干活」的关键一步。

工作流程：
1. 用 JSON Schema 定义工具（名称、用途、参数）
2. 用户提问，LLM 判断是否需要工具、调用哪个、传什么参数
3. 你的代码实际执行函数，把结果返回给 LLM
4. LLM 基于执行结果给出最终回答

```typescript
const tools = [{
  name: "get_stock_price",
  description: "查询指定股票的实时价格",
  input_schema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "股票代码，如 AAPL" }
    },
    required: ["symbol"]
  }
}];
// 用户问「苹果股价多少」
// → LLM 输出 tool_use: get_stock_price("AAPL")
// → 你调真实 API → 把结果返给 LLM → LLM 给出最终回答
```

**Parallel Tool Calls**：模型在一次响应中输出多个并行工具调用，主流 LLM 都支持，比串行快很多。

### RAG（检索增强生成）

RAG 已经从 2023 年的「简单向量检索 + LLM」进化为更复杂的系统：

```
传统 RAG（2023-2024）：
文档 → 分块 → Embedding → 向量数据库 → 语义检索 → LLM

现代 RAG（2025-2026）：
├── 混合检索（向量 + BM25 关键词）
├── GraphRAG（知识图谱 + 多跳推理）
├── 语义缓存（Redis 加速重复查询）
├── Agentic RAG（AI 自主决定何时检索）
└── 多模态 RAG（文本 + 图像 + 表格联合检索）
```

**RAG Pipeline 各环节技术选型：**

**① 文档解析**：解析质量直接影响 RAG 效果。

| 工具 | 特点 |
|------|------|
| Docling | 开源，处理 PDF/表格/图片 |
| LlamaParse | 付费，效果最好，复杂文档首选 |
| Unstructured | 开源，支持 20+ 格式 |

**② Chunking 策略**：

| 策略 | 特点 | 适用 |
|------|------|------|
| 固定大小 | 简单，可能切断语义 | 结构规整文档 |
| 递归字符 | LangChain 默认，按语义边界切 | 通用首选 |
| 语义切割 | 基于 Embedding 相似度动态切 | 效果最好 |
| 父子 Chunk | 小块检索，大块送给 LLM | 平衡精度与上下文 |

**③ Embedding 模型**：

| 模型 | 特点 | 推荐场景 |
|------|------|---------|
| text-embedding-3-small | OpenAI，高性价比 | 日常 RAG |
| text-embedding-3-large | OpenAI，精度最高 | 对精度要求高 |
| BGE-M3 | 开源，中文强，支持多语言 | 中文场景 |
| Voyage AI | Anthropic 投资，代码向量强 | 代码库 RAG |

**④ 向量数据库**：

| 数据库 | 类型 | 特点 | 选型建议 |
|--------|------|------|---------|
| Chroma | 开源嵌入式 | 极简 API，本地优先 | 本地开发 / 原型 |
| pgvector | PG 扩展 | 与 Postgres 原生集成 | 已有 PG 数据库 |
| Supabase Vector | PG 云服务 | pgvector + Auth 一体化 | 全栈 AI 应用 |
| Qdrant | 开源专用 | Rust 实现，延迟最低 | 大规模高性能 |
| Pinecone | 托管商业 | 最易上手，Serverless | 快速上线 |
| Milvus | 开源分布式 | 十亿级向量 | 超大规模企业 |

**⑤ 检索策略**：

- **密集检索（Dense）**：向量相似度搜索，理解语义
- **稀疏检索（Sparse / BM25）**：关键词精确匹配，处理专有名词、数字
- **混合搜索（Hybrid Search）**：两者结合 + RRF 算法融合排名，**生产环境首选**

**⑥ Reranking**：初检召回 Top-20，再用 Reranker（Cohere / BGE）精排，只把最相关的 3–5 条送给 LLM，显著提升回答质量。

### 高级 RAG 技术

**HyDE（假设性文档嵌入）**：先让模型生成假想答案，再用该答案的向量检索真实文档，解决查询与文档向量空间不对齐的问题。

**RAG-Fusion**：生成多个子查询并行检索，用 RRF 算法融合结果，提升召回质量。

**GraphRAG**（微软提出）：构建实体关系图，支持复杂多跳推理查询，适合知识密集型场景。

**Agentic RAG**：把 RAG 包装成 Agent 工具，AI 自主决定何时检索、检索什么，支持多轮迭代。

---

## 六、Agent 层：让 AI 自主干活

单次问答解决不了复杂任务。Agent 让 AI 从「回答问题」变成「完成任务」。

### 核心设计模式

**ReAct（Reason + Act）**：推理和行动交替循环，是最主流的 Agent 范式：

```
目标: "帮我分析竞品，写一份报告"

Thought:  需要先搜集各家竞品信息
Action:   search_web("竞品A 功能特性 2026")
Observation: [搜索结果...]

Thought:  还需要定价信息
Action:   search_web("竞品A 定价 对比")
Observation: [搜索结果...]

Thought:  信息足够，开始写报告
Action:   write_file("report.md", "# 竞品分析...")
Observation: 文件已创建

Final Answer: 报告已生成，见 report.md
```

**Plan-and-Execute**：先制定完整计划再逐步执行，适合步骤可预见的任务，比纯 ReAct 更稳定。

**Reflection（自我反思）**：Agent 检查自己的输出质量，自我纠错，不需要梯度更新，Reflexion 论文提出的方法。

**Human-in-the-Loop**：在关键决策点暂停等待人类确认，控制 Agent 自主性边界，生产环境必须设计。

### Agent 组成要素

**Planning（规划）**：把大目标拆成子任务，决定执行顺序。

**Memory（记忆）**：
- **短期记忆**：当前对话上下文（Context Window）
- **长期记忆**：向量数据库存储历史任务、用户偏好（mem0 是专门的记忆管理库）
- **工作记忆**：任务执行中的中间状态（草稿、进度）

**Tools（工具）**：Agent 能调用的函数集合，工具质量决定 Agent 能力上限。

### 主流 Agent 框架

| 框架 | 语言 | Star | 特点 | 适用场景 |
|------|------|------|------|---------|
| **LangGraph** | Python/TS | 15K+ | 状态图建模，精确控制流程，34.5M 月下载 | 复杂多步骤工作流 |
| **Mastra** | TypeScript | 21K+ | Gatsby 团队，原生 TS，OpenTelemetry 监控 | JS/TS 全栈团队 |
| **LangChain** | Python/TS | 100K+ | 生态最全，RAG + Agent 一体化 | 通用首选 |
| **LlamaIndex** | Python/TS | 40K+ | RAG 最强，工作流持续增强 | 知识密集型 Agent |
| **CrewAI** | Python | 30K+ | 角色扮演多 Agent，10 万认证开发者 | 模拟团队协作 |
| **AutoGen 0.4** | Python | 40K+ | 微软，事件驱动，对话式多 Agent | 研究探索性任务 |
| **PydanticAI** | Python | 9K+ | 类型安全，与 FastAPI 同源 | Python 强类型场景 |
| **smolagents** | Python | 15K+ | HuggingFace，Code Agent 范式，极简 | 快速原型 |
| **Google ADK** | Python/TS | — | Google 官方，原生集成 Gemini | Google Cloud 生态 |
| **DSPy** | Python | 22K+ | 程序化 Prompt 优化，声明式架构 | Prompt 系统化管理 |

---

## 七、协议层：MCP 和 A2A

### MCP（Model Context Protocol）

**Anthropic 2024 年底推出，2025-12-09 捐赠至 Linux Foundation 下的 AAIF（Agentic AI Foundation），已成为行业开放标准，创始成员包括 Anthropic、Block、OpenAI。**

解决问题：以前每个 AI 应用都要自己实现工具接入，重复劳动。MCP 统一接口，工具实现一次，所有支持 MCP 的 AI 应用都能复用。

**MCP 架构：**

```
[Claude / Cursor / 你的应用]   ← MCP Host
         ↕ MCP Protocol
    [MCP Client]
         ↕
    [MCP Server 1: 文件系统]
    [MCP Server 2: PostgreSQL]
    [MCP Server 3: GitHub]
    [MCP Server 4: 你的业务系统]
```

**MCP Server 三种能力：**
- **Tools**：AI 可调用的函数（写文件、查数据库、发请求）
- **Resources**：AI 可读取的数据（文件内容、数据库记录）
- **Prompts**：预设的提示词模板

**传输方式：**
- **Stdio**：本地进程通信，适合本地工具
- **SSE（HTTP）**：网络通信，适合远程服务
- **OAuth 2.0**：2025 年纳入规范，远程 MCP Server 的鉴权标准

**2026 年新扩展——MCP Apps**：工具可以返回交互式 UI 组件（仪表板、表单、多步工作流），不只是纯文本数据，Claude / VS Code / ChatGPT 已支持。

**现有生态**：文件系统、PostgreSQL、MySQL、GitHub、Slack、Notion、Figma、Puppeteer 等主流工具都有现成 MCP Server。

**自己开发 MCP Server 的价值**：把公司内部系统（ERP、CRM、私有 API）封装成 MCP Server，让 AI 直接访问，是当下很有市场价值的工程能力。

### A2A（Agent to Agent）

**Google 2025.04 发布，2025-06-23 于 Open Source Summit 捐赠至 Linux Foundation（a2aproject 组织），50+ 合作伙伴支持，与 MCP 互补，最新版本 v0.3.0（2025-07-30）。**

```
用户请求
    ↓
Orchestrator Agent（协调者）
    ↓         ↓          ↓
Search     Coding     Writing
Agent      Agent       Agent
（并行执行，通过 A2A 通信）
    ↓         ↓          ↓
          汇总结果 → 最终输出
```

**A2A 核心机制：**
- **Agent Card**：Agent 的能力描述格式（类似工具的 Schema）
- **Task 委托**：标准化的任务生命周期管理
- **OAuth 2.0 安全授权**：Agent 间通信的鉴权标准

**MCP vs A2A 本质区别：**

| | MCP | A2A |
|--|-----|-----|
| 连接对象 | AI ↔ 工具/数据 | Agent ↔ Agent |
| 解决问题 | 工具集成标准化 | 多 Agent 协作标准化 |
| 类比 | 给人配一套工具 | 给人配一个团队 |

两者互补，实际架构中往往同时使用。

---

## 八、产品层：全栈 AI 应用开发

### 核心技术栈

**前端：**
- **Next.js 16 + React 19**：AI 应用的首选全栈框架，v16 为 Active LTS（2025-10 发布），Server Components + 流式渲染与 AI 输出天然契合
- **Tailwind CSS v4 + shadcn/ui**：快速构建高质量 UI，AI 应用界面首选组合

**AI 集成：**
- **Vercel AI SDK**（已到 6.x）：统一调用 OpenAI / Anthropic / Google 等所有主流模型，封装 Streaming、`useChat` / `useCompletion` Hook，**SDK 6 原生支持 MCP**，是目前前端接入 AI 最快的方式

```typescript
// 几行代码实现流式对话 UI
const { messages, input, handleSubmit } = useChat({
  api: '/api/chat'
});
```

**后端：**
- **Next.js API Routes / Server Actions**：直接在 Next.js 里写后端，Serverless 部署
- **Hono**：轻量级 TypeScript Web 框架，Cloudflare Workers 首选
- **FastAPI**：Python AI API 框架，异步支持，自动 OpenAPI 文档

**数据库：**

| 数据库 | 特点 | 推荐场景 |
|--------|------|---------|
| Supabase | PostgreSQL + Auth + Vector 一体化 | **全栈 AI 应用首选** |
| Neon | Serverless PostgreSQL | Serverless 全栈 |
| pgvector | PostgreSQL 向量扩展 | 已有 PG 基础设施 |
| Upstash Redis | Serverless Redis | 缓存 / 会话 / 限流 |

**部署：**

| 平台 | 特点 | 适用 |
|------|------|------|
| Vercel | Next.js 原生，全球 CDN | 前端 + Serverless API |
| Cloudflare Workers | 边缘计算，内置 Workers AI | 全球低延迟 |
| Railway | 简单容器部署 | 后端服务 |
| Modal | Python Serverless GPU | 推理服务 |
| Ollama | 本地运行开源 LLM | 本地开发 / 私有部署 |
| vLLM | 高性能 LLM 推理服务 | 生产 GPU 部署 |

**结构化输出工具：**

| 工具 | 语言 | 说明 |
|------|------|------|
| Instructor | Python | 基于 Pydantic，自动重试验证 |
| Pydantic v2 | Python | 数据验证，与 LLM 输出完美配合 |
| Zod | TypeScript | 运行时类型验证，Vercel AI SDK 集成 |

---

## 九、AI 工程化：让应用跑得稳

### Observability（可观测性）

监控 Token 消耗、延迟、错误率、幻觉率、成本，是 AI 应用上生产的必备能力。

| 工具 | 类型 | 特点 | 推荐 |
|------|------|------|------|
| **LangFuse** | 开源 + 商业 | Trace + Prompt 管理 + Eval 一体化，支持多框架 | ★★★★★ |
| **LangSmith** | 商业 | LangChain / LangGraph 深度集成，调试体验最佳 | ★★★★ |
| **Arize Phoenix** | 开源 | OpenTelemetry 原生，Agent 评估强 | ★★★★ |
| **Helicone** | 商业 | 零改动接入，LLM 代理层监控 | ★★★ |
| **Braintrust** | 商业 | Eval 到 Guardrail 全生命周期 | ★★★ |

### Eval（评估体系）

AI 输出是概率性的，不能只靠肉眼判断质量。

**LLM-as-Judge**：用强模型（Claude / GPT-4o）自动评判输出质量，替代人工标注，是目前主流做法。

**RAGAS**：RAG 专用评估框架，提供「忠实度 / 答案相关性 / 上下文精度」等核心指标。

**Promptfoo**：CLI 工具，Prompt 对比测试 + 红队攻击 + CI/CD 集成。

**DeepEval**：Python 测试框架，14+ LLM 评估指标，可集成单元测试流程。

### 成本控制

| 技术 | 说明 | 节省幅度 |
|------|------|---------|
| Prompt Caching | Claude/GPT 对重复前缀缓存 KV | 最高 90% |
| Batch API | OpenAI/Anthropic 批量推理 | 50% |
| Semantic Router | Embedding 相似度路由，<1ms 决策，简单请求走缓存/小模型 | 47-80% |
| 模型路由 | 简单查询用小模型，复杂查询路由强模型 | 视情况 |
| LiteLLM Gateway | 统一 API 网关 + 成本追踪 + 预算管理 | 管理用 |

### Guardrails（安全护栏）

> **2026 年企业落地最大阻力是合规**：数据隐私、Prompt 注入防护、AI 输出审计正从「可选项」变成「准入门槛」。能在面试中展示对 OWASP Agentic AI Top 10 的系统性防范意识，是区分初中级和高级 AI 工程师的重要信号。

| 能力 | 工具 | 说明 |
|------|------|------|
| 输入/输出验证 | Guardrails AI | 开源，声明式验证器，检测幻觉/PII/有害内容 |
| 对话限制 | NeMo Guardrails | NVIDIA，Colang 语言定义规则，防过度授权/工具滥用 |
| PII 检测脱敏 | Presidio | 微软开源，GDPR / EU AI Act 合规（主要规则 2026-08-02 全面适用） |
| Prompt 注入防御 | 自定义 + Lakera Guard | 检测并阻断覆盖系统指令的攻击 |
| 机密计算 | Intel TDX / AMD SEV | 高合规场景（金融/医疗），确保推理在可信执行环境中完成 |

### Context Engineering

在有限 Token 预算里放入最高价值信息的工程学，是 2025–2026 年最重要的新兴方向。

常见策略：
- **对话历史压缩**：超过一定长度就摘要，释放 Token 空间
- **动态 System Prompt**：根据当前任务动态注入相关指令，不是一成不变
- **RAG 结果精排**：不全量塞，用 Reranker 只选最相关的片段
- **Tool 定义精简**：Agent 每次只传当前任务需要的工具，不全量传入

---

## 十、多模态 AI

### Vision（图像理解）

**GPT-5 / GPT-4o Vision**：图像理解综合能力最强，OCR、图表分析、界面截图都很好。

**Claude Opus/Sonnet 4.6 Vision**：文档理解和长 PDF 分析体验突出（Claude 3.7 已退役）。

**Gemini 2.5 Pro Vision**：原生多模态，200 万 Token 上下文，超长文档和视频帧处理。

**Document Understanding**：从 PDF / 发票 / 表格提取结构化信息，Docling 和 LlamaParse 是主流工具，直接影响 RAG 系统质量。

### Audio（语音）

| 工具 | 类型 | 说明 |
|------|------|------|
| Whisper | STT（开源） | OpenAI，多语言，可本地部署，语音识别基础设施 |
| Deepgram | STT（商业） | 实时 API，低延迟，适合实时对话应用 |
| OpenAI TTS | TTS（商业） | 简单易用，6 种声音，流式输出 |
| ElevenLabs | TTS（商业） | 声音克隆，情感合成，质量最高 |
| LiveKit | 实时音视频 | 开源，构建语音 AI Agent 的基础设施标准 |
| GPT-4o Audio | 实时对话 | OpenAI，低延迟语音对话，带情感感知 |

### Image & Video Generation

| 工具 | 说明 |
|------|------|
| DALL-E 3 / gpt-image-1 | OpenAI，Prompt 理解最强 |
| Flux | 开源，高质量图像生成，本地部署 |
| fal.ai | 高性能图像/视频生成 API，开发者体验好 |
| Sora / Veo 3.1 | OpenAI / Google，顶级视频生成 |

---

## 十一、AI 编码工具生态（Vibe Coding）

### AI 代码编辑器

2026 年已形成三强格局：

| 工具 | 形态 | 特点 | 最佳场景 |
|------|------|------|---------|
| **Cursor** | VS Code Fork | Tab 补全极强，多文件重构，速度最快 | 日常编码，市占率最高 |
| **Claude Code** | CLI 终端 | 理解整个代码库，独立完成复杂任务 | 架构重构，深度代码分析 |
| **Windsurf** | VS Code Fork | Cascade Agent 强，性价比最高（已被 OpenAI 收购） | 性价比优先 |
| **GitHub Copilot** | VS Code 插件 | 企业合规最佳，微软生态 | 企业环境 |
| **Aider** | CLI 终端 | Git 集成，支持多种模型后端 | 命令行偏好者 |

> 30 天真实测试结论：Cursor 最佳编辑器体验，Claude Code 最像「AI 工程师」，Windsurf 最佳性价比。

### AI 全栈构建工具

| 工具 | 说明 |
|------|------|
| **v0.dev** | Vercel，自然语言生成 Next.js + shadcn/ui 代码 |
| **Bolt.new** | 浏览器内全栈 AI 应用生成，一键部署 |
| **Lovable** | 对话式全栈生成，集成 Supabase 后端 |
| **Replit Agent** | 云端 IDE + AI Agent，自然语言到部署全流程 |
| **OpenHands** | 开源 AI 软件工程师，本地部署 |
| **Codex** | OpenAI 云端编程 Agent，支持并发多任务 |

### 浏览器与计算机控制

| 工具 | 说明 |
|------|------|
| Browser Use | 开源，Agent 控制浏览器完成 Web 任务 |
| Stagehand | AI 网页自动化 SDK，语义选择器 |
| Claude Computer Use | Claude 直接操控计算机界面 |
| E2B Sandbox | 为 Agent 提供安全代码执行沙箱 |

---

## 十二、主流 LLM 全景

### 闭源 / API 模型

> 更新时间：2026-03，模型迭代极快，以官方文档为准

| 模型 | 厂商 | 上下文 | 特点 |
|------|------|--------|------|
| Claude Opus 4.6 | Anthropic | 200K（1M beta） | 最强推理/编码，复杂 Agent 首选，当前旗舰 |
| Claude Sonnet 4.6 | Anthropic | 200K（1M beta） | 速度与智能最佳平衡，日常 Agent 首选 |
| Claude Haiku 4.5 | Anthropic | 200K | 最快，高并发低成本；Claude 3.7 已于 2026-02-19 退役 |
| GPT-5 | OpenAI | — | 2025-08 发布，已取代 GPT-4o/4.1 成为主力 |
| GPT-5 mini | OpenAI | — | o4-mini 继任者，高性价比推理 |
| o3 | OpenAI | 200K | 最强推理模型，数学/代码/科学 |
| Gemini 2.5 Pro | Google | 2M | 超长上下文，多模态顶级 |
| Gemini 2.0 Flash | Google | 1M | 高速低成本，实时应用首选 |
| DeepSeek-V3 | DeepSeek | 128K | 性能接近 GPT-5，成本极低，中文最强 |
| DeepSeek-R1 | DeepSeek | 128K | 开源推理模型标杆，可本地部署 |

### 开源模型

| 模型 | 参数量 | 特点 |
|------|-------|------|
| Llama 3.3 70B | 70B | Meta 最强开源，Ollama 本地部署首选 |
| Qwen3 系列 | 0.6B–235B | 阿里，中文最强，多模态文档理解 |
| Qwen2.5-Coder-32B | 32B | 代码生成顶级 |
| QwQ-32B | 32B | 阿里开源推理模型，本地部署性价比高 |
| Phi-4 | 14B | 微软轻量 SLM，端侧部署 |
| Gemma 3 | 1B–27B | Google 开源，端侧部署 |

### 实战选型

```
代码任务 / 工具调用    →  Claude Sonnet 4.6（最稳定）
中文内容生成          →  DeepSeek-V3（最便宜）
超长上下文任务        →  Gemini 2.5 Pro（200万 Token）
高难推理任务          →  o3 / DeepSeek-R1 / QwQ-32B
高并发低成本          →  Claude Haiku 4.5 / Gemini 2.0 Flash / GPT-5 mini
本地私有部署          →  Llama 3.3 70B / Qwen3-72B（Ollama）
```

---

## 十三、学习优先级

> **2026 年分水岭**：能「调用 API」是初级，能「设计和编排 Agent 系统」才是高级 AI 工程师。LangGraph + MCP 是这道分水岭最核心的两侧。

### 必学（核心竞争力）

| 技术 | 理由 |
|------|------|
| Transformer 架构原理 | 理解所有 LLM 行为的基础 |
| Prompt Engineering（CoT、Few-shot、结构化输出） | 每天都在用 |
| RAG 全流程 | 90% 企业 AI 应用的核心组件 |
| **LangGraph / LangChain**（分水岭①） | Agent 编排主流标准，区分初级/高级的核心能力 |
| **MCP 协议开发**（分水岭②） | 已成工具集成行业标准，实际工程价值极高 |
| Vercel AI SDK + Next.js 16 | 全栈 AI 应用开发标准 |
| 向量数据库（pgvector / Qdrant） | RAG 必需组件 |
| LLMOps（LangFuse / LangSmith） | 生产环境必须 |
| AI 编码工具（Cursor / Claude Code） | 提升自身开发效率 |

### 新兴（值得投资）

| 技术 | 理由 |
|------|------|
| A2A 协议 | 多 Agent 协作的开放标准（已入 Linux Foundation） |
| DSPy | 取代手动 Prompt Engineering 的方向 |
| Mastra | TypeScript 生态的 LangGraph 挑战者 |
| 多模态开发（Vision + Audio） | 模型能力已成熟，应用场景爆发 |
| Context Engineering | 2025–2026 最重要的新兴工程方向 |
| GraphRAG | 结构化知识增强 RAG 的重要演进 |
| **Guardrails 安全护栏** | 2026 企业合规落地加分项，能讲清 OWASP Agentic AI Top 10 防范策略极具说服力 |
| Semantic Router + LiteLLM Router | 智能路由降本，生产架构必备 |

### 可以观望

| 技术 | 说明 |
|------|------|
| 全量微调 | 需要大量 GPU 资源，多数场景 RAG 足够 |
| 模型架构研究 | ML Research 方向，非 AI Engineer 必须 |
| 自研推理引擎 | vLLM / SGLang 已足够成熟 |
| 端侧 AI / WebGPU | 2026 年快速成熟中，可跟进但暂非必须 |
| **Rust** | AI 基建趋势（Qdrant/Turbopack 已采用）；转向底层推理代理或向量基建时中长期投入，应用层开发暂无需学 |

---

## 十四、学习路径规划

```
Phase 1（第 1-2 周）：基础就绪
├── Transformer 原理（Illustrated Transformer）
├── OpenAI / Anthropic API 调用
├── System Prompt + Few-shot + CoT
└── 结构化输出（Instructor / Zod）

Phase 2（第 3-4 周）：Tool Use + RAG
├── Function Calling 实现
├── Embedding + 向量数据库（Chroma 入门）
├── RAG Pipeline 全流程（LangChain/LlamaIndex）
└── Hybrid Search + Reranking

Phase 3（第 5-7 周）：Agent + 协议
├── ReAct Agent 实现（LangGraph / Mastra）
├── MCP Server 开发（写 1 个实际项目）
├── A2A 协议理解
└── Memory 系统设计

Phase 4（第 8 周起）：生产 + 全栈
├── Next.js 16 + Vercel AI SDK（Streaming UI）
├── LangFuse 接入（监控 + 评估）
├── Guardrails 实现
├── 成本控制（Prompt Caching + 模型路由）
└── 完整 AI 应用上线
```

---

## 十五、本系列文章规划

| # | 标题 | 对应知识点 |
|---|------|-----------|
| 00 | 系列导读：AI 工程师的完整知识地图（本篇）| 全局概览 |
| 01 | LLM 是怎么工作的：Token、Attention、采样 | 底层原理 |
| 02 | Prompt Engineering：和 LLM 说话的艺术 | System Prompt / Few-shot / CoT |
| 03 | 结构化输出：让 AI 的回答变成程序能读的数据 | JSON Mode / Instructor / Zod |
| 04 | Function Calling：给 AI 插上执行的翅膀 | Tool Use |
| 05 | Embedding 与向量数据库：AI 的长期记忆 | Embedding / 向量数据库选型 |
| 06 | RAG 实战：给 AI 接上你的私有知识库 | RAG Pipeline 全流程 |
| 07 | RAG 进阶：Chunking、Hybrid Search、Reranking | 高级 RAG |
| 08 | ReAct：让 AI 学会边想边做 | ReAct Pattern / Agent Loop |
| 09 | Agent 实战：用 LangGraph / Mastra 搭任务执行器 | Agent 框架 |
| 10 | MCP 协议：工具集成的统一标准 | MCP 原理与生态 |
| 11 | 动手写一个 MCP Server | MCP 开发实战 |
| 12 | Plugin（GPT Actions）：用 OpenAPI 把服务接入 AI | Plugin 开发 / OpenAPI Schema |
| 13 | Agent Skills：用自然语言给 Agent 注入专业能力 | Skills 设计 / 行为指令包 |
| 14 | MCP、Plugin、Skills：三种集成方式怎么选 | 集成方案对比 / 选型决策 |
| 15 | A2A：让多个 Agent 组成团队 | A2A 协议 / Multi-Agent |
| 16 | Context Engineering：在有限空间里装最多价值 | Context 管理 |
| 17 | 用 Next.js + Vercel AI SDK 搭一个 AI 应用 | 全栈集成 |
| 18 | AI 应用的监控与评估：LangFuse + RAGAS | Observability + Eval |
| 19 | Guardrails：给 AI 装上安全护栏 | 安全工程 |
| 20 | 成本控制：Prompt Caching 和模型路由 | 成本优化 |
| 21 | 从 0 到 1：一个完整 AI SaaS 的架构拆解 | 综合实战 |

---

### 小结

- AI 工程师 ≠ ML 工程师，核心是**把 LLM 能力接入业务**，是懂 AI 的全栈工程师
- 知识体系七层：底层原理 → Prompt → 数据工程 → 能力扩展（Tool/RAG）→ Agent → 协议（MCP/A2A）→ 产品（全栈 + 工程化）
- **2026 年分水岭**：LangGraph（Agent 编排）+ MCP（工具集成）是区分初级与高级 AI 工程师的核心能力
- MCP 已于 2025-12-09 捐赠至 Linux Foundation 下的 AAIF；A2A 于 2025-06-23 捐赠至 Linux Foundation，最新 v0.3.0
- Claude 3.7 Sonnet 已于 2026-02-19 退役；当前最新为 Opus 4.6 / Sonnet 4.6 / Haiku 4.5；GPT-5 系列已成 OpenAI 主力
- 2026 年新趋势：OWASP Agentic AI Top 10 安全合规、Semantic Router 智能路由降本、MCP Apps 交互式 UI、端侧 AI
- 开发工具：Cursor / Claude Code 写代码，v0 做 UI，LangFuse 做监控，Vercel 做部署

---

**下一篇**：LLM 是怎么工作的：Token、Attention、采样

---

*「AI 工程师实战」系列第 00 篇 · 持续更新中*
