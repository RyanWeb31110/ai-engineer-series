# AI 工程师实战系列 — 配套代码仓库

> 配套微信公众号「AI 工程师实战系列」每篇文章的可运行代码示例

---

## 仓库结构

```
ai-engineer-series/
├── shared/              # 公共 LLM 客户端 & 类型定义（所有章节共用）
├── 01-llm-basics/       # Token、Attention、采样
├── 02-prompt-engineering/
├── 03-structured-output/
├── 04-function-calling/
├── 05-embedding-vectordb/
├── 06-rag-basic/
├── 07-rag-advanced/
├── 08-react-agent/
├── 09-langgraph-agent/
├── 10-mcp-intro/
├── 11-mcp-server/
├── 12-a2a/
├── 13-context-engineering/
├── 14-fullstack-app/    # 完整 AI 应用（Next.js 16 + Vercel AI SDK）
├── 15-llmops/
├── 16-guardrails/
├── 17-cost-control/
└── 18-ai-saas/          # 完��� AI SaaS 架构
```

---

## 快速开始

**环境要求**：Node.js 22+，pnpm 9+

```bash
# 1. 安装所有依赖
pnpm install

# 2. 进入某章节，复制并填写 API Key
cd 01-llm-basics
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY / OPENAI_API_KEY

# 3. 运行示例
pnpm tokenizer   # Token 可视化
pnpm sampling    # 采样参数对比
```

---

## 章节列表

| # | 文章 | 示例脚本 | 状态 |
|---|------|---------|------|
| 01 | [LLM 是怎么工作的：Token、Attention、采样](#) | `tokenizer.ts` / `sampling.ts` | ✅ |
| 02 | Prompt Engineering：和 LLM 说话的艺术 | — | 📝 |
| 03 | 结构化输出：让 AI 的回答变成程序能读的数据 | — | 📝 |
| 04 | Function Calling：给 AI 插上执行的翅膀 | — | 📝 |
| 05 | Embedding 与向量数据库：AI 的长期记忆 | — | 📝 |
| 06 | RAG 实战：给 AI 接上你的私有知识库 | — | 📝 |
| 07 | RAG 进阶：Chunking、Hybrid Search、Reranking | — | 📝 |
| 08 | ReAct：让 AI 学会边想边做 | — | 📝 |
| 09 | Agent 实战：用 LangGraph / Mastra 搭任务执行器 | — | 📝 |
| 10 | MCP 协议：工具集成的统一标准 | — | 📝 |
| 11 | 动手写一个 MCP Server | — | 📝 |
| 12 | A2A：让多个 Agent 组成团队 | — | 📝 |
| 13 | Context Engineering：在有限空间里装最多价值 | — | 📝 |
| 14 | 用 Next.js 16 + Vercel AI SDK 搭一个 AI 应用 | — | 📝 |
| 15 | AI 应用的监控与评估：LangFuse + RAGAS | — | 📝 |
| 16 | Guardrails：给 AI 装上安全护栏 | — | 📝 |
| 17 | 成本控制：Prompt Caching 和模型路由 | — | 📝 |
| 18 | 从 0 到 1：一个完整 AI SaaS 的架构拆解 | — | 📝 |

---

## shared 层

所有章节共用的基础设施，无需在每章重复安装：

- `shared/src/types/index.ts` — 统一消息格式、LLMConfig、LLMResponse
- `shared/src/llm/client.ts` — 统一调用入口，自动识别 Anthropic / OpenAI

```typescript
import { chat, MODELS } from '@ai-series/shared'

const res = await chat(
  [{ role: 'user', content: 'Hello' }],
  { model: MODELS.CLAUDE_SONNET, maxTokens: 256 }
)
console.log(res.content)
```

---

## 技术栈

- **运行时**：Node.js 22 LTS
- **语言**：TypeScript 5.7（strict 模式）
- **包管理**：pnpm 9 monorepo
- **LLM SDK**：`@anthropic-ai/sdk` / `openai`
- **执行器**：tsx（开发期直接运行 .ts）
