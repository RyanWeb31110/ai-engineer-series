# AI 工程师完整技术栈蓝图

> 面向 AI 应用层开发方向，从第一性原理出发，覆盖底层原理到上层工具链
> 更新时间：2026-03

---

## 阅读说明

- **必学**：核心竞争力，日常开发高频使用
- **推荐**：提升工程能力，进阶必备
- **了解**：知道是什么、解决什么问题即可

---

## 第一层：底层原理

### 1.1 Transformer 核心机制

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| Self-Attention / Multi-Head Attention | 必学 | 理解 Q/K/V 矩阵乘法，是读懂所有 LLM 行为的基础 |
| KV Cache | 必学 | 推理时缓存已计算的键值对，避免重复计算，推理加速的核心；衍生出 Prompt Caching（缓存固定前缀降低 90% 成本） |
| Residual Connection + Layer Norm | 了解 | 让深层网络训练稳定，是 Transformer 能叠几十层的工程基础 |
| Feed-Forward Network | 了解 | 每层 Attention 后的非线性变换模块 |
| Flash Attention 2/3 | 推荐 | IO-Aware 的注意力计算实现，显存降低 + 速度提升，主流框架已默认集成 |
| PagedAttention | 推荐 | vLLM 提出的 KV Cache 显存管理方案，类比操作系统虚拟内存，大幅提升并发吞吐 |
| GQA（Grouped Query Attention） | 推荐 | Llama 3 等采用，减少 KV Cache 显存占用同时保持性能 |
| MoE（混合专家） | 推荐 | 每次只激活部分专家网络，DeepSeek-V3、Mixtral 使用，用更少计算量实现更大参数规模 |

### 1.2 Tokenization

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| BPE（Byte Pair Encoding） | 必学 | GPT 系列默认算法，迭代合并高频字节对生成子词词表 |
| SentencePiece | 了解 | Llama / T5 等使用，不依赖预分词，多语言友好 |
| tiktoken | 推荐 | OpenAI 开源的高性能 BPE 实现，可精确计算 GPT 系列 token 数 |
| Context Window | 必学 | 模型单次能处理的最大 token 数，决定 RAG 分块策略和 Agent 设计上限 |

**Token 换算参考：**
- 英文：约 4 个字符 = 1 Token
- 中文：约 1.5 个字符 = 1 Token
- 代码：约 3-4 个字符 = 1 Token

### 1.3 位置编码

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| RoPE（旋转位置编码） | 必学 | Llama / Qwen / Mistral 等主流模型标配，通过旋转 Q/K 向量编码相对位置，支持长上下文外推 |
| ALiBi | 了解 | 通过注意力偏置编码相对位置，Bloom 等早期模型使用 |
| Sinusoidal PE | 了解 | 原始 Transformer 使用的绝对位置编码，现代模型已淘汰 |

### 1.4 采样参数

| 参数/技术 | 重要程度 | 说明 |
|----------|---------|------|
| Temperature | 必学 | 控制输出随机性。0 = 确定性强（代码/结构化任务），1+ = 创意增强（写作/头脑风暴） |
| Top-p（Nucleus Sampling） | 必学 | 只从累积概率超过 p 的 token 集合中采样，与 Temperature 配合是最常用策略 |
| Top-k | 推荐 | 只考虑概率最高的 k 个 token |
| Structured Output / JSON Mode | 必学 | 强制模型输出符合 JSON Schema 的数据，工程化 AI 的关键能力，主流 LLM 均支持 |
| reasoning_effort | 必学 | 2026 年关键新参数，控制推理模型（Claude 3.7 / o3）的思考深度，直接影响延迟和成本 |
| Speculative Decoding | 推荐 | 用小模型生成候选序列，大模型并行验证，中低 QPS 场景延迟降低 2-3× |

### 1.5 推理服务框架

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **vLLM** | 必学 | PagedAttention + 连续批处理，生产级高吞吐 LLM 推理首选，兼容 OpenAI API 格式 |
| **SGLang** | 必学 | RadixAttention + 结构化输出加速，Agentic 场景下吞吐超越 vLLM |
| **Ollama** | 必学 | 本地运行开源 LLM 的标准工具，`ollama pull llama3.3` 一行命令启动，兼容 OpenAI API |
| LM Studio | 了解 | 图形界面本地 LLM 工具，非技术用户友好，支持 GGUF 格式 |
| EAGLE3 | 推荐 | 当前 SOTA 推测解码算法，在 vLLM 上实现 2.5× 推理加速 |

### 1.6 模型微调

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| SFT（监督微调） | 推荐 | 在标注数据上做监督学习，让模型学会特定格式和风格 |
| LoRA | 必学 | 只训练低秩分解矩阵，可训练参数从百亿降到百万级，微调基础工具 |
| QLoRA | 推荐 | LoRA + 4-bit 量化，单张消费级 GPU（24GB VRAM）可微调 70B 模型 |
| RLHF | 推荐 | 通过人类偏好训练奖励模型再用 RL 对齐，是 ChatGPT 类模型的对齐核心方法 |
| DPO（直接偏好优化） | 推荐 | RLHF 的简化替代，直接在偏好对上优化，无需单独奖励模型，2025 年主流对齐方案 |
| GRPO | 了解 | DeepSeek 推广的强化推理方法，Qwen3 等已采用 |
| Hugging Face TRL | 推荐 | 统一实现 SFT / DPO / PPO / GRPO 的训练库，微调工程的事实标准 |
| PEFT | 推荐 | HuggingFace 的参数高效微调库，统一管理 LoRA / Prefix Tuning 等方法 |
| 量化（INT4/INT8） | 推荐 | 压缩模型体积和推理显存，GPTQ / AWQ 是主流量化方案，Ollama 本地运行基本依赖此技术 |

---

## 第二层：Prompt Engineering

### 2.1 基础技法

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| System Prompt 设计 | 必学 | 定义 AI 角色、能力边界、输出格式的顶层指令，决定模型整体行为模式 |
| Zero-shot Prompting | 必学 | 不给示例，直接描述任务，适合能力强的大模型 |
| Few-shot Prompting | 必学 | 给 2–8 个输入/输出示例，让模型学会目标格式，比纯描述效果好很多 |
| Chain of Thought（CoT） | 必学 | 引导模型逐步推理再给答案，复杂推理任务必用 |
| Zero-shot CoT | 必学 | 加一句 `Let's think step by step` 触发，无需示例 |
| Role Prompting | 推荐 | 赋予模型专家角色，引导特定领域风格 |
| XML 标签结构化 | 必学 | Anthropic 推荐用 XML 标签组织复杂 Prompt，比自然语言分隔符更稳定 |
| Negative Prompting | 推荐 | 明确告知"不要做什么"，比只说"要做什么"效果更好 |

### 2.2 进阶技法

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| Self-Consistency | 推荐 | 同一问题多次采样取多数投票，提升推理稳定性，适合有唯一正确答案的任务 |
| Prompt Chaining | 必学 | 复杂任务拆成多步串联 Prompt，前一步输出作为下一步输入，比单一超长 Prompt 更可控 |
| Least-to-Most Prompting | 推荐 | 先让模型分解子问题，再逐步解决，处理组合推理效果好 |
| Tree of Thoughts（ToT） | 了解 | 维护多个推理路径的树形搜索，适合需要规划和探索的复杂问题 |
| Meta Prompting | 推荐 | 让模型生成或优化 Prompt 本身 |
| Reflexion | 推荐 | Agent 通过自我反思与记忆强化改进决策，无需梯度更新 |

### 2.3 推理模型（Thinking Models）

| 模型/技术 | 重要程度 | 说明 |
|----------|---------|------|
| Claude Opus 4.6 / Sonnet 4.6 Extended Thinking | 必学 | Anthropic 当前最新模型，`thinking.budget_tokens` 控制推理预算，适合代码、逻辑、数学；Claude 3.7 Sonnet 已于 2026-02-19 退役 |
| OpenAI o3 / GPT-5 mini | 必学 | o4-mini 已被 GPT-5 mini 继任；通过 test-time compute scaling 提升推理能力，适合高难度推理任务 |
| DeepSeek-R1 | 推荐 | 开源推理模型，GRPO 训练，性能媲美闭源模型，可本地部署 |
| QwQ-32B | 推荐 | 阿里开源推理模型，32B 参数，本地部署性价比高 |

### 2.4 程序化 Prompt 优化

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **DSPy** | 推荐 | Stanford 出品，把 Prompt 当程序优化而非手动调字符串，MIPROv2 / GEPA 优化器自动生成最优提示，实测准确率达 94% |
| DSPy MIPROv2 | 推荐 | DSPy 当前最强优化器，贝叶斯优化自动搜索最佳提示配置 |
| DSPy GEPA | 了解 | 反射提示进化算法，通过 LLM 自我反思快速迭代提示 |

### 2.5 结构化输出工具

| 工具 | 语言 | 重要程度 | 说明 |
|------|------|---------|------|
| **Instructor** | Python | 必学 | 基于 Pydantic 的 LLM 结构化输出最流行库，自动验证 + 重试，支持所有主流模型 |
| **Pydantic v2** | Python | 必学 | 数据验证，与 LLM 输出完美配合 |
| **Zod** | TypeScript | 必学 | 运行时类型验证，Vercel AI SDK 深度集成 |
| Outlines | Python | 了解 | 基于语法约束的结构化生成，强制控制输出格式 |

### 2.6 Prompt 安全

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| Prompt Injection 防御 | 必学 | OWASP LLM Top 1 漏洞，通过输入净化、角色隔离、输出验证多层防护 |
| OWASP LLM Top 10 | 必学 | 生产 LLM 应用十大安全风险权威清单，持续更新 |
| OWASP Agentic AI Top 10（2025-12） | 必学 | 2025 年 12 月发布的 Agent 专项风险清单，覆盖过度自主权、多步骤攻击、工具滥用、级联失败等 Agentic 场景特有风险 |
| Jailbreak 检测 | 推荐 | 识别绕过安全限制的攻击模式 |
| PII 检测 | 推荐 | Presidio 等工具检测并脱敏个人信息，GDPR 合规；**EU AI Act 主要规则已于 2026-08-02 全面适用** |
| Instruction Hierarchy | 推荐 | OpenAI 提出的按来源优先级（System > User > Tool）处理指令，提升鲁棒性 |

---

## 第三层：数据工程（Data Pipeline）

> 企业场景最大痛点：向量数据库里的内容是**动态的**，需要一套持续同步机制——这是 RAG 能跑起来的前提。

### 3.1 数据源接入（ETL）

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Airbyte** | 推荐 | 开源 ELT 平台，400+ 预置连接器（数据库 / SaaS / API），企业知识库数据抽取首选 |
| **Fivetran** | 了解 | 全托管 ELT 服务，连接器最全，企业采购方案，成本较高 |
| **n8n** | 推荐 | 开源工作流自动化，低代码连接各类数据源，适合中小团队快速搭建数据管道 |
| **Zapier / Make** | 了解 | 无代码自动化，适合非技术人员触发简单数据同步 |

### 3.2 数据转换（Transform）

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **dbt（data build tool）** | 推荐 | SQL 为主的数据转换工具，版本控制 + 测试 + 文档，企业数仓清洗建模标准工具；与 AI 结合：清洗后的结构化数据直接作为 RAG 数据源 |
| **Pandas / Polars** | 推荐 | Python 数据处理，Polars 速度比 Pandas 快 10-100×，适合大批量文档预处理 |
| **DuckDB** | 推荐 | 嵌入式 OLAP 数据库，零依赖本地分析大文件，AI Pipeline 中间层数据处理利器 |

### 3.3 编排与调度（Orchestration）

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Airflow** | 推荐 | 最主流的 DAG 工作流调度器，定时触发文档更新 → 解析 → Embedding → 写入向量库全流程 |
| **Prefect** | 推荐 | 现代化 Python-first 工作流，比 Airflow 更易上手，适合 AI 数据管道编排 |
| **Temporal** | 了解 | 持久化工作流引擎，保证长时间 Agent 任务可靠执行，适合生产级 Agentic Pipeline |

### 3.4 AI 专用数据管道

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **LlamaIndex Ingestion Pipeline** | 必学 | 专门针对向量数据库的 ETL 管道，内置文档解析 → Chunking → Embedding → 去重 → Upsert 全流程 |
| **Vectorize（Cloudflare）** | 了解 | Edge 向量数据库 + 自动 Embedding 生成，配合 Cloudflare Workers 实现边缘 RAG |
| **Unstructured Ingest** | 推荐 | Unstructured 的批量数据摄入工具，支持 S3 / GCS / SharePoint 等企业存储源 |

### 3.5 向量数据库增量更新策略

| 策略 | 重要程度 | 说明 |
|------|---------|------|
| **Upsert（插入/更新）** | 必学 | 基于文档唯一 ID 做 Upsert，相同 ID 覆盖旧向量，是增量同步的基础操作 |
| **文档版本控制** | 推荐 | 在元数据中记录文档版本号和更新时间，支持按版本回溯和定向刷新 |
| **过期清除（TTL）** | 推荐 | 为向量条目设置过期时间，自动清除过时内容，保持知识库新鲜度 |
| **变更检测（Change Detection）** | 推荐 | 对数据源做 MD5 / hash 比对，只对变更文档重新 Embedding，节省计算成本 |
| **全量重建 vs 增量更新** | 必学 | 小规模可定期全量重建，大规模必须做增量更新；变更频繁时用 Event-Driven 触发（Webhook / CDC） |
| **CDC（变更数据捕获）** | 了解 | 监听数据库 binlog / WAL，实时捕获数据变更触发向量同步；工具：Debezium |

---

## 第四层：能力扩展（Tool Use & RAG）

### 4.0 Tool Use / Function Calling

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| Function Calling 基础 | 必学 | 用 JSON Schema 定义工具，LLM 决定何时调用哪个，你负责实际执行 |
| Tool Schema 设计 | 必学 | 工具描述的质量直接影响 LLM 调用准确率，是工程核心 |
| Parallel Tool Calls | 推荐 | 模型在一次响应中输出多个并行调用，主流 LLM 均支持 |
| Streaming Tool Calls | 推荐 | 流式输出时实时获取工具调用内容，降低感知延迟 |

### 4.1 RAG 管道各环节

#### 文档解析

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **LlamaParse** | 必学 | LlamaIndex 出品，GenAI 原生 PDF 解析，复杂文档首选，速度最快 |
| **Docling（IBM）** | 推荐 | 开源，表格提取准确率 97.9%，支持复杂布局分析 |
| **Unstructured** | 推荐 | 多格式文档 ETL，支持 20+ 格式，批量处理首选 |
| VLM-based OCR（Qwen2.5-VL） | 推荐 | 2025 年新趋势：用视觉语言模型直接理解文档图像，端到端输出结构化 JSON |
| ColPali | 了解 | 视觉 RAG 方案，直接对文档页面图像做嵌入，绕过文本提取步骤 |

#### Chunking 策略

| 策略 | 重要程度 | 说明 |
|------|---------|------|
| 固定大小分块 | 必学 | 最简单，按字符数切，可能切断语义，适合结构规整文档 |
| 递归字符分块 | 必学 | LangChain 默认，按段落/句子边界递归切，通用首选 |
| 语义分块 | 推荐 | 基于 Embedding 相似度动态确定边界，效果最好，2025 年生产推荐 |
| 父子 Chunk | 推荐 | 小块用于检索，召回时返回大块给 LLM，平衡精度与上下文 |

#### Embedding 模型

| 模型 | 重要程度 | 说明 |
|------|---------|------|
| text-embedding-3-small | 必学 | OpenAI，高性价比，日常 RAG 首选 |
| text-embedding-3-large | 推荐 | OpenAI，精度最高，MTEB 64.6 分 |
| voyage-3-large | 推荐 | Anthropic 投资，MTEB SOTA 66.8 分，代码向量能力强 |
| BGE-M3 | 推荐 | 开源最佳，支持 100+ 语言，中文场景首选，支持稠密+稀疏+多向量 |
| nomic-embed-text | 了解 | 本地可运行的高质量开源嵌入模型 |

#### 向量数据库

| 数据库 | 类型 | 重要程度 | 说明 |
|--------|------|---------|------|
| **Chroma** | 开源嵌入式 | 必学 | 极简 API，本地优先，开发调试首选 |
| **pgvector** | PG 扩展 | 必学 | PostgreSQL 原生集成，HNSW 索引，中小规模最经济方案 |
| **Qdrant** | 开源专用 | 推荐 | Rust 实现，延迟最低，支持 Hybrid Search，大规模高性能首选 |
| **Supabase Vector** | PG 云服务 | 推荐 | pgvector + Auth 一体化，全栈 AI 应用首选 |
| **Pinecone** | 托管商业 | 推荐 | 全托管，零运维，快速上线，成本偏高 |
| Weaviate | 开源/云 | 了解 | 内置 GraphQL，支持多模态 |
| Milvus | 开源分布式 | 了解 | 十亿级向量，超大规模企业场景 |
| LanceDB | 嵌入式 | 了解 | 针对 AI 应用的嵌入式向量数据库，本地友好 |

#### 检索策略

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| 密集检索（Dense Retrieval） | 必学 | 向量相似度搜索，理解语义 |
| 稀疏检索（BM25） | 必学 | 关键词精确匹配，处理专有名词、数字、代码 |
| 混合搜索（Hybrid Search） | 必学 | 密集 + 稀疏 + RRF 算法融合，**生产环境标准配置** |
| Reranking | 必学 | 粗召回 Top-20 后用 Cross-Encoder 精排，准确率提升 15-30%；工具：Cohere Reranker、BGE Reranker |
| HyDE | 推荐 | 先生成假想答案再检索，解决查询与文档向量空间不对齐问题 |
| RAG-Fusion | 推荐 | 多子查询并行检索 + RRF 合并，提升召回率 |

#### 高级 RAG

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| GraphRAG（微软） | 推荐 | 构建实体关系图，支持复杂多跳推理，适合知识密集型场景 |
| LightRAG | 推荐 | 轻量图增强 RAG，双层检索（实体 + 关系），速度快于 GraphRAG |
| Agentic RAG | 推荐 | 将 RAG 封装为 Agent 工具，AI 自主决定何时检索、检索什么 |
| Corrective RAG（CRAG） | 了解 | 评估检索质量，低质量时触发 Web 搜索补充 |
| Semantic Cache | 推荐 | 对语义相似的查询复用历史结果，Redis 实现，降低重复查询成本 |

#### RAG 评估

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **RAGAS** | 必学 | RAG 专用评估框架，忠实度 / 上下文精度 / 答案相关性三大无参考指标 |

---

## 第五层：Agent

### 5.1 核心设计模式

| 模式 | 重要程度 | 说明 |
|------|---------|------|
| ReAct（Reason + Act） | 必学 | 推理 → 行动 → 观察循环，几乎所有 Agent 框架的底层范式 |
| Plan-and-Execute | 推荐 | 先规划完整任务列表，再逐步执行，适合长时序任务，减少路径偏移 |
| Reflection | 推荐 | Agent 对自身输出批判和修正，相当于内部评审员 |
| Human-in-the-Loop | 必学 | 关键决策点暂停等待人类确认，控制 Agent 自主性边界，生产必须设计 |
| Multi-Agent 协作 | 推荐 | Orchestrator 协调多个专职 Worker Agent，适合复杂任务分解 |
| Interrupt & Resume | 推荐 | Agent 执行可被中断、检查后继续，适合长任务管理 |

### 5.2 Agent 框架

| 框架 | 语言 | 重要程度 | 说明 |
|------|------|---------|------|
| **LangGraph** | Python/TS | 必学 | 有状态图工作流，节点 + 边定义 Agent 逻辑，支持循环/条件分支/持久化，生产首选，34.5M 月下载 |
| **Mastra** | TypeScript | 推荐 | TypeScript 原生 Agent 框架，内置 workflow / memory / RAG / 可观测性，全栈 TS 团队首选 |
| **LangChain** | Python/TS | 必学 | 生态最全，100K+ Star，Chain / Agent / RAG 一体化 |
| **LlamaIndex Workflows** | Python/TS | 推荐 | 事件驱动 Agent 工作流，RAG + Agent 混合场景优化 |
| **CrewAI** | Python | 推荐 | 角色扮演多 Agent 协作，10 万认证开发者，快速原型 |
| **AutoGen 0.4** | Python | 推荐 | 微软出品，事件驱动架构，对话式多 Agent |
| **PydanticAI** | Python | 推荐 | 类型安全 Agent 框架，FastAPI 风格，与 Python 生态无缝集成 |
| **smolagents** | Python | 推荐 | HuggingFace 出品，Code Agent 范式，极简 API |
| **Google ADK** | Python/TS | 推荐 | Google 官方 Agent 开发套件，原生集成 Gemini 和 Vertex AI |
| **DSPy** | Python | 推荐 | 声明式 LLM 编程框架，Prompt 系统化管理 |

### 5.3 Memory 系统

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| 短期记忆（In-Context） | 必学 | 当前会话上下文窗口内的对话历史，最基础的记忆形式 |
| 长期记忆（外部存储） | 推荐 | 向量数据库存储历史任务/用户偏好，通过相似度检索召回，跨会话持久化 |
| **mem0** | 推荐 | 通用 AI 记忆层，自动提取和检索跨会话的用户偏好与历史，支持多级记忆类型 |
| Episodic Memory | 推荐 | 存储完整交互片段，用于个性化与历史回顾 |
| Semantic Memory | 推荐 | 存储抽象知识与事实，支持结构化查询 |
| Procedural Memory | 了解 | 存储操作步骤和技能，类比肌肉记忆，适合学习用户工作方式的场景 |
| Zep | 了解 | 企业级 LLM 记忆服务，支持多模态知识图谱存储 |

---

## 第六层：协议

### 6.1 MCP（Model Context Protocol）

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| MCP 协议规范 | 必学 | Anthropic 2024.11 开源，JSON-RPC 2.0；2025-12-09 捐赠至 Linux Foundation 下的 **AAIF（Agentic AI Foundation）**，成为行业标准 |
| MCP TypeScript SDK | 必学 | 官方 TS SDK，构建 MCP Server / Client，Node.js 全栈开发首选 |
| MCP Python SDK（FastMCP） | 必学 | 官方 Python SDK，FastMCP 接口极大简化 Server 开发 |
| MCP Server 参考实现 | 推荐 | 官方提供 GitHub / Slack / PostgreSQL 等参考 Server，可直接用或作模板 |
| MCP Apps 扩展（2026.01） | 推荐 | 工具可返回交互式 UI 组件（仪表板、表单、工作流），不只是纯文本数据，Claude / VS Code / ChatGPT 已支持 |
| stdio 传输 | 必学 | 本地进程通信，适合本地工具（文件系统、本地数据库） |
| SSE（HTTP）传输 | 必学 | 网络通信，适合远程服务（云数据库、第三方 API） |
| OAuth 2.0 鉴权 | 推荐 | 2025 年纳入规范，远程 MCP Server 的标准鉴权方式 |

**MCP Server 三种能力：**
- **Tools**：AI 可调用的函数（写文件、查数据库、发请求）
- **Resources**：AI 可读取的数据（文件内容、数据库记录）
- **Prompts**：预设的提示词模板

### 6.2 A2A（Agent to Agent）

| 技术 | 重要程度 | 说明 |
|------|---------|------|
| A2A 协议 | 推荐 | Google 2025.04 发布，定义 Agent 间标准化通信方式；2025-06-23 于 Open Source Summit 捐赠至 Linux Foundation（a2aproject 组织），50+ 合作伙伴支持 |
| Agent Card | 推荐 | Agent 的能力描述格式，类似工具的 Schema，用于 Agent 能力发现 |
| Task 委托 | 推荐 | 标准化的任务生命周期管理，一个 Agent 委托另一个 Agent 完成子任务 |
| A2A v0.3.0 | 了解 | 2025-07-30 发布，引入 gRPC 支持和安全卡签名，当前最新版本 |

**MCP vs A2A：**

```
MCP：AI ↔ 工具/数据（纵向集成）
A2A：Agent ↔ Agent（横向协作）
两者互补，实际系统中往往同时使用
```

---

## 第七层：全栈开发

### 7.1 前端

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| **Next.js 16（App Router）** | 必学 | AI 应用前端首选框架，Server Components + Streaming + Edge Functions；v16 为 Active LTS（2025-10 发布），v15 为 Maintenance LTS |
| **React 19** | 必学 | use() Hook / RSC 等新特性，与 Next.js 16 配套 |
| **Tailwind CSS v4** | 必学 | 快速构建 UI，AI 应用界面标配 |
| **shadcn/ui** | 必学 | 组件式可复用 UI 库，AI 应用界面首选组件库 |
| **Vercel AI SDK** | 必学 | 统一调用所有主流 LLM，封装 Streaming / useChat / useCompletion，SDK 6 原生支持 MCP |
| useChat | 必学 | Vercel AI SDK 核心 Hook，自动管理消息状态和 SSE 流处理 |
| streamText / streamObject | 必学 | 服务端流式响应核心函数 |
| CopilotKit | 了解 | 为应用内嵌 AI Copilot 功能提供 UI 组件 |
| Streamlit | 推荐 | Python 快速构建 AI 演示界面，适合 PoC 和内部工具 |
| Gradio | 推荐 | HuggingFace 的 ML Demo 框架，快速构建模型展示界面 |

### 7.2 后端

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| **FastAPI** | 必学 | Python 最快 Web 框架，async/await 原生支持，StreamingResponse + AsyncGenerator 是 LLM SSE 标准实现 |
| **Hono** | 推荐 | 轻量级 TypeScript Web 框架，Cloudflare Workers 首选，Edge 部署 |
| Next.js API Routes | 必学 | 直接在 Next.js 写后端，Serverless 部署，AI 全栈应用首选 |
| LiteLLM | 推荐 | 统一所有 LLM 提供商 API 为 OpenAI 兼容格式的代理层，多模型路由和成本控制 |

### 7.3 数据库

| 数据库 | 重要程度 | 说明 |
|--------|---------|------|
| **Supabase** | 必学 | PostgreSQL + pgvector + Auth + Realtime 一体化，全栈 AI 应用首选 |
| **Neon** | 推荐 | Serverless PostgreSQL + pgvector，按需伸缩，AI 初创成本控制 |
| **pgvector** | 必学 | PostgreSQL 向量扩展，HNSW 索引，中小规模 RAG 最经济方案 |
| **Upstash Redis** | 推荐 | Serverless Redis，会话缓存 / Rate Limiting / Semantic Cache |
| SQLite + libsql | 推荐 | 轻量嵌入式数据库，Turso 提供 Serverless 版本 |

### 7.4 部署

| 平台 | 重要程度 | 说明 |
|------|---------|------|
| **Vercel** | 必学 | Next.js 原生部署平台，Serverless + Edge Functions，全球 CDN |
| **Cloudflare Workers** | 推荐 | 边缘计算，全球低延迟，内置 Workers AI 推理能力 |
| Railway | 推荐 | 简单容器部署，后端服务首选，开发者体验好 |
| Fly.io | 推荐 | 全球分布式容器部署，适合需要持久连接的 AI 服务 |
| Modal | 推荐 | Python Serverless GPU 计算，推理服务部署 |
| Replicate | 了解 | 开源模型 API 托管，快速将 HuggingFace 模型服务化 |
| Docker | 必学 | AI 服务容器化，环境一致性保障 |

---

## 第八层：AI 工程化（LLMOps）

### 8.1 Observability（可观测性）

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Langfuse** | 必学 | 开源 LLM 可观测性平台，Trace / Prompt 管理 / Eval 一体化，支持自托管，多框架兼容 |
| **LangSmith** | 推荐 | LangChain 官方，与 LangGraph 深度集成，Agent 调试体验最佳 |
| Arize Phoenix | 推荐 | OpenTelemetry 原生，Agent 评估强，开源 |
| Helicone | 推荐 | 零改动接入，LLM 代理层监控，轻量 |
| Braintrust | 推荐 | Eval 到 Guardrail 全生命周期，数据集管理 + 评估 + 追踪一体化 |
| OpenTelemetry | 了解 | 分布式追踪标准，是 Phoenix 等工具的底层规范 |

### 8.2 Eval（评估体系）

| 工具/方法 | 重要程度 | 说明 |
|----------|---------|------|
| LLM-as-Judge | 必学 | 用强模型（Claude / GPT-4o）自动评判输出质量，替代人工标注，当前主流做法 |
| **RAGAS** | 必学 | RAG 专用评估，忠实度 / 上下文精度 / 答案相关性 |
| **DeepEval** | 必学 | Pytest 风格 LLM 评估框架，14+ 指标，RAG 和 Agent 均支持 |
| Promptfoo | 推荐 | CLI 工具，Prompt 对比测试 + 红队攻击 + CI/CD 集成 |
| Golden Dataset | 必学 | 人工标注的黄金数据集，为自动评估提供基准 |
| A/B Testing | 推荐 | 对比不同 Prompt / 模型在真实用户上的效果 |

### 8.3 路由与降本（Routing & Cost Management）

> 智能路由是 2026 年降本增效的核心手段：在用户感知不到差异的前提下，把 80% 的请求路由到更便宜的路径。

#### Semantic Router（语义路由）

| 技术/工具 | 重要程度 | 说明 |
|----------|---------|------|
| **Semantic Router（语义路由）** | 必学 | 基于 Embedding 相似度匹配的超低延迟路由层，<1ms 决策延迟，无需 LLM 推理 |
| 路由决策树 | 必学 | 缓存命中 → 规则匹配 → 小模型 → 大模型，按命中层级依次降低成本 |
| `semantic-router` 库 | 推荐 | Python 库，定义路由层（RouteLayer）和意图路由规则，毫秒级完成请求分发 |
| **LiteLLM Router** | 必学 | 统一 100+ 模型 API 格式 + 负载均衡 + 按策略路由（成本 / 延迟 / 模型偏好） |
| **PortKey** | 推荐 | AI 网关，支持语义缓存 + 多模型路由 + 可观测性，适合企业级路由管理 |

**典型路由策略（按成本从低到高）：**

```
请求进入
  ↓
① 语义缓存命中？→ 直接返回缓存（成本 ≈ $0）
  ↓ 未命中
② 规则路由匹配？→ 简单任务路由到 Haiku / Flash（成本 ↓ 90%）
  ↓ 未匹配
③ Embedding 相似度路由 → 中等复杂度路由到 Sonnet / GPT-4o-mini
  ↓ 不确定
④ 兜底路由 → Claude Opus / GPT-4o（最高成本，最高质量）
```

#### 成本控制工具

| 技术/工具 | 重要程度 | 节省幅度 | 说明 |
|----------|---------|---------|------|
| **Prompt Caching** | 必学 | 最高 90% | Claude / GPT 对重复前缀缓存 KV，延迟降低 85% |
| Batch API | 推荐 | 50% | OpenAI / Anthropic 批量推理，非实时任务异步处理 |
| 模型路由 | 推荐 | 47-80% | 简单任务用小模型，复杂任务路由强模型；工具：LiteLLM Router |
| Semantic Cache | 推荐 | 视场景 | 语义相似查询复用历史结果；工具：GPTCache、Upstash |
| Token 压缩 | 推荐 | 视情况 | LLMLingua 等对长 Prompt 无损压缩 |
| tiktoken | 必学 | — | 精确预测请求 token 数，成本估算必备 |

### 8.4 Guardrails（安全护栏）

> **2026 年企业落地最大阻力是合规**：数据隐私、Prompt 注入防护、AI 输出审计正从「可选项」变成「准入门槛」。能在面试中展示对 OWASP Agentic AI Top 10 的系统性防范意识，是区分初中级和高级 AI 工程师的重要信号。

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Guardrails AI** | 推荐 | 开源，运行时输入/输出验证器，检测幻觉 / PII 泄露 / 有害内容 |
| **NeMo Guardrails** | 推荐 | NVIDIA，Colang 语言定义对话限制，企业级合规场景；可落地防过度授权、工具滥用等 Agentic 风险 |
| Presidio（微软） | 推荐 | 开源 PII 检测脱敏工具，GDPR / EU AI Act 合规首选 |
| LLM Guard | 了解 | 开源输入输出扫描，轻量易集成 |
| Lakera Guard | 了解 | 企业级 Prompt 注入检测，实时 API 防护 |
| Confidential Computing | 了解 | 机密计算（Intel TDX / AMD SEV），确保模型推理在可信执行环境中完成，金融/医疗高合规场景 |

### 8.5 Context Engineering

2025–2026 年最重要的新兴工程方向，核心：**在有限 Token 预算里放入最高价值的信息。**

Anthropic 定义的四大策略：

| 策略 | 重要程度 | 说明 |
|------|---------|------|
| Write（外部写入） | 必学 | 把信息写入外部存储（文件 / 数据库 / 记忆），不占上下文窗口 |
| Select（动态选择） | 必学 | 通过 RAG / 记忆搜索按需把相关内容拉入上下文 |
| Compress（压缩） | 必学 | 对历史对话 / 工具输出做摘要，保留关键信息同时节省 token |
| Isolate（隔离） | 推荐 | 大任务拆分给多个子 Agent，每个只持有自己需要的上下文 |

#### 工程实践原则

**Context 污染**是最常见的性能杀手：System Prompt 里塞满无关背景，导致 Agent 在执行简单任务时也带着大量噪音。判断标准：当前任务不需要的信息，一个字也不要出现在 Context 里。

**研究与实现分离**：探索阶段（对比多种方案）和实现阶段必须用独立 Session。探索阶段的宽 Context 会污染实现阶段的精确执行。

#### 对抗验证模式（Adversarial Verification Pattern）

利用 Agent 的讨好性（Sycophancy）设计三角制衡，适用于代码 Review、方案评估、事实核查等高可靠性场景：

```
Bug-Finder  → 激励穷举所有问题（积分制，问题越严重分越高）
     ↓
Adversarial → 激励推翻不成立的指控（推翻成功得分，推翻错误扣 2 倍）
     ↓
Referee     → 中立裁判综合两方，给出最终结论（使用更强模型）
```

核心洞察：单 Agent 执行"找 bug"类任务时，因为想满足用户期望会制造不存在的问题；三角结构通过互相制衡让最终结论接近真相。

---

## 第九层：多模态

### 9.1 Vision（图像理解）

| 工具/模型 | 重要程度 | 说明 |
|----------|---------|------|
| GPT-4o Vision | 必学 | 原生多模态，图像理解综合最强，OCR / 图表 / 截图分析 |
| Claude 3.x Vision | 必学 | 文档理解和长 PDF 分析体验突出 |
| Gemini 2.5 Pro Vision | 推荐 | 原生多模态，200 万 Token 上下文，视频帧理解 |
| Qwen2.5-VL | 推荐 | 开源，OCR 性能领先（OmniDocBench），复杂文档结构解析 |
| Document Understanding | 必学 | PDF / 发票 / 表格结构化提取，Docling / LlamaParse 是主流工具 |

### 9.2 Audio（语音）

| 工具 | 类型 | 重要程度 | 说明 |
|------|------|---------|------|
| **Whisper** | STT | 必学 | OpenAI 开源，99 种语言，可本地部署，语音识别事实标准 |
| Deepgram | STT | 推荐 | 实时 STT API，低延迟，适合实时对话应用 |
| **ElevenLabs** | TTS | 推荐 | 顶级 TTS，声音克隆 / 情感合成，75ms 低延迟，Eleven v3 最新 |
| OpenAI TTS | TTS | 推荐 | 简单易用，6 种声音，流式输出 |
| Kokoro（开源） | TTS | 了解 | 轻量高质量本地 TTS，质量接近商业方案 |
| LiveKit | 实时框架 | 推荐 | 开源实时音视频框架，构建语音 AI Agent 的基础设施标准 |
| GPT-4o Audio / Realtime API | 实时对话 | 推荐 | 低延迟语音对话，带情感感知 |

### 9.3 图像 & 视频生成

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| DALL-E 3 / gpt-image-1 | 了解 | OpenAI，Prompt 理解最强 |
| Flux | 了解 | 开源高质量图像生成，本地部署 |
| fal.ai | 了解 | 高性能图像 / 视频生成 API，开发者体验好 |
| Sora | 了解 | OpenAI 视频生成，API 已开放 |
| Veo 3.1 | 了解 | Google 顶级视频生成，支持原生音频 |

---

## 第十层：AI 编码工具（Vibe Coding）

### 10.1 AI 代码编辑器

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Claude Code** | 必学 | Anthropic 官方 CLI，2026 年使用率调查第一（46%），理解整个代码库，SWE-bench 最高分，适合复杂架构任务 |
| **Cursor** | 必学 | AI-first IDE（基于 VSCode），多文件编辑体验最佳，日常开发首选 |
| **Windsurf** | 推荐 | Cascade Agent 强，提供免费套餐，性价比最高，已被 OpenAI 收购 |
| GitHub Copilot | 推荐 | 企业合规最佳，微软 / GitHub 生态，VSCode 深度集成 |
| Aider | 推荐 | CLI 编码助手，Git 集成，支持多种模型后端 |
| Zed AI | 了解 | 高性能编辑器内置 AI，极速响应 |

> 30 天测试结论：Claude Code 最像「AI 工程师」，Cursor 最佳编辑体验，Windsurf 最佳性价比。

### 10.2 AI 全栈构建工具

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **v0.dev** | 推荐 | Vercel，自然语言生成 Next.js + shadcn/ui 代码，前端快速原型 |
| **Lovable** | 推荐 | 全栈 AI 应用生成，内置 Supabase 后端，12 分钟 MVP |
| **Bolt.new** | 推荐 | 浏览器内全栈开发，零本地配置，快速验证想法 |
| Replit Agent | 推荐 | 云端 IDE + AI Agent，自然语言到部署全流程 |
| OpenHands | 推荐 | 开源 AI 软件工程师，本地部署，支持多模型 |
| Codex | 推荐 | OpenAI 云端编程 Agent，支持并发多任务 |
| GitHub Copilot Workspace | 了解 | 从 Issue 到 PR 的任务级 AI 开发环境 |

### 10.3 浏览器与计算机控制

| 工具 | 重要程度 | 说明 |
|------|---------|------|
| **Playwright MCP** | 推荐 | 微软 2025.03 发布，通过 MCP 让 AI Agent 直接控制浏览器 |
| **Browser Use** | 推荐 | 开源，Agent 控制浏览器完成 Web 自动化，基于 Playwright |
| Stagehand | 推荐 | AI 网页自动化 SDK，语义选择器，比传统 selector 更鲁棒 |
| Claude Computer Use | 了解 | Claude 通过截图+动作循环控制完整桌面，研究阶段 |
| E2B Sandbox | 推荐 | 为 Agent 提供安全代码执行沙箱，隔离运行环境 |
| Skyvern | 了解 | 基于 VLM 的浏览器自动化，适合 UI 经常变化的网站 |

---

## 第十一层：端侧 AI（Edge / On-Device AI）

> 2026 年隐私合规趋严、离线场景增多，端侧推理正在从「实验」进入「生产」阶段。

### 11.1 轻量模型选型（SLM）

| 模型 | 参数量 | 重要程度 | 说明 |
|------|-------|---------|------|
| **Phi-4** | 14B | 推荐 | 微软，数学 / 推理能力超越同量级模型，本地部署性价比最高 |
| **Gemma 3** | 1B–27B | 推荐 | Google 开源，多模态版本支持图像，1B 可在手机运行 |
| **Qwen3 0.6B–7B** | 0.6B–7B | 推荐 | 阿里，中文最强轻量模型，支持离线部署 |
| SmolLM2 | 135M–1.7B | 了解 | HuggingFace，极小内存占用，IoT / 嵌入式场景 |

### 11.2 端侧推理运行时

| 工具/框架 | 平台 | 重要程度 | 说明 |
|----------|------|---------|------|
| **ONNX Runtime** | 跨平台 | 推荐 | 微软，模型格式标准 + 跨平台运行时，Android / iOS / PC 通用，大量框架导出 ONNX |
| **Apple CoreML** | iOS / macOS | 推荐 | Apple 原生，充分利用 Neural Engine（ANE），比 GPU 省电 5-10× |
| **MediaPipe** | 移动端 | 了解 | Google，专用于计算机视觉任务，手势 / 人脸 / 姿态识别，毫秒级延迟 |
| **llama.cpp** | 跨平台 | 推荐 | C++ 高性能推理，GGUF 格式，CPU 可运行 7B 模型，Ollama 底层即此 |

### 11.3 浏览器内推理

| 工具/框架 | 重要程度 | 说明 |
|----------|---------|------|
| **WebGPU** | 推荐 | 2024 年浏览器 GPU 计算标准，Chrome / Firefox 已正式支持，端侧 AI 基础设施 |
| **Transformers.js** | 推荐 | HuggingFace，JavaScript 推理库，WebGPU/WASM 后端，浏览器内运行 Whisper / Embedding 等任务 |
| **WebLLM** | 推荐 | 基于 WebGPU 的浏览器内 LLM 推理，支持 Llama / Phi / Gemma，无需服务器 |
| Chrome AI（Gemini Nano） | 了解 | Chrome 131 内置 Gemini Nano，`window.ai` API，零延迟本地推理 |

### 11.4 端侧 AI 典型场景

| 场景 | 重要程度 | 说明 |
|------|---------|------|
| 隐私敏感数据处理 | 必学 | 医疗 / 法律 / 金融数据不离设备，本地 LLM 推理 |
| 离线可用性 | 推荐 | 无网络环境下 AI 功能正常工作（如飞机上的语音助手） |
| 低延迟交互 | 推荐 | 实时语音识别（Whisper on-device）、实时翻译，网络往返延迟为 0 |
| 成本归零 | 推荐 | 高频轻量任务（分类、提取）完全在端侧运行，API 调用成本为 $0 |
| 浏览器插件 AI | 了解 | WebLLM + Chrome Extension，无需后端服务 |

---

## 主流模型速查

> 更新时间：2026-03，模型迭代极快，以官方文档为准

### 闭源 / API 模型

| 模型 | 上下文 | 适用场景 |
|------|--------|---------|
| **Claude Opus 4.6** | 200K（1M beta） | 最强推理/编码，复杂 Agent，当前 Anthropic 旗舰 |
| **Claude Sonnet 4.6** | 200K（1M beta） | 速度与智能最佳平衡，日常 Agent 首选 |
| **Claude Haiku 4.5** | 200K | 最快，高并发低成本；Claude 3.7 Sonnet 已于 2026-02-19 退役 |
| **GPT-5** | — | OpenAI 2025-08 发布，当前主力模型（取代 GPT-4o 系列） |
| **GPT-5 mini** | — | o4-mini 的继任者，高性价比推理模型 |
| o3 | 200K | 高难推理：数学 / 代码 / 科学（test-time scaling） |
| Gemini 2.5 Pro | 2M | 超长上下文、视频理解 |
| Gemini 2.0 Flash | 1M | 高速低成本，实时应用 |
| DeepSeek-V3 | 128K | 高性价比（成本 1/10），中文最强 |
| DeepSeek-R1 | 128K | 开源推理模型标杆，可本地部署 |

### 开源模型

| 模型 | 参数量 | 适用场景 |
|------|-------|---------|
| Llama 3.3 70B | 70B | 通用开源首选，Ollama / vLLM 本地部署 |
| Qwen3 系列 | 0.6B–235B | 中文最强，多模态文档理解 |
| Qwen2.5-Coder-32B | 32B | 代码生成顶级 |
| QwQ-32B | 32B | 开源推理，本地部署性价比高 |
| Phi-4 | 14B | 微软轻量 SLM，端侧部署 |
| Gemma 3 | 1B–27B | Google 开源，端侧部署 |

### 实战选型

```
代码任务 / 工具调用     →  Claude Sonnet 4.6（最稳定）
中文内容生成            →  DeepSeek-V3（最便宜，约 1/10 成本）
超长上下文任务          →  Gemini 2.5 Pro（200万 Token）
高难推理任务            →  o3 / DeepSeek-R1 / QwQ-32B
高并发低成本            →  Claude Haiku 4.5 / Gemini 2.0 Flash / GPT-5 mini
本地私有部署            →  Llama 3.3 70B / Qwen3-72B（Ollama）
```

---

## 学习优先级总结

### 必学清单（按顺序）

> **2026 年分水岭**：能「调用 API」是初级，能「设计和编排 Agent 系统」才是高级 AI 工程师。LangGraph + MCP 是这道分水岭最核心的两侧。

1. Transformer 核心原理（KV Cache、Attention、Token）
2. Prompt Engineering（System Prompt / Few-shot / CoT / 结构化输出）
3. RAG 全流程（文档解析 → Chunking → Embedding → 混合检索 → Reranking）
4. Function Calling / Tool Use
5. **LangGraph Agent 开发**（分水岭①：Agent 编排能力）
6. **MCP 协议开发（写一个实际 MCP Server）**（分水岭②：工具集成标准）
7. Vercel AI SDK + Next.js 全栈
8. Langfuse 可观测性
9. RAGAS + DeepEval 评估体系
10. Prompt Caching + Semantic Router 成本控制

### 推荐掌握（进阶）

- A2A 协议、Mastra、GraphRAG、Agentic RAG
- DSPy 程序化 Prompt 优化
- Context Engineering 四策略
- 数据工程：Airflow / Prefect + LlamaIndex Ingestion Pipeline + CDC 增量更新
- Semantic Router + LiteLLM Router 智能路由
- LoRA / QLoRA 微调
- vLLM / SGLang 推理部署
- 多模态开发（Vision + Audio）
- **Guardrails 安全护栏**（企业合规落地的加分项，建议能说清 OWASP Agentic AI Top 10 的防范策略）

### 可以观望

- 全量微调（门槛高，多数场景 RAG 足够）
- 自研推理引擎（vLLM / SGLang 已成熟）
- 模型架构研究（ML Research 方向）
- 端侧 AI / WebGPU（2026 年快速成熟中，可跟进但暂非必须）
- **Rust**（AI 基础趋势：Qdrant / Turbopack 等高性能工具已采用；若未来转向底层推理代理或向量计算基建，值得中长期投入；应用层开发暂无需学）
