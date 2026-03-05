# 第 01 章：LLM 是怎么工作的

> Token、Attention、采样 — 搞懂这三件事，你对 LLM 的理解就超过了大多数"用户"

配套文章：[公众号链接待更新](#)

---

## 本章示例

| 脚本 | 说明 |
|------|------|
| `src/tokenizer.ts` | 用 tiktoken 可视化 token 切分，理解 token 是什么 |
| `src/sampling.ts` | 调用真实 API，对比不同 temperature / top-p 的输出差异 |

---

## 快速开始

```bash
# 在仓库根目录先安装依赖
pnpm install

# 进入本章
cd 01-llm-basics

# 配置 API Key
cp .env.example .env
# 编辑 .env 填入 ANTHROPIC_API_KEY

# 运行 tokenizer（无需 API Key）
pnpm tokenizer

# 运行采样对比（需要 API Key）
pnpm sampling
```

---

## 代码说明

### tokenizer.ts

使用 `js-tiktoken`（GPT-4o 的 BPE 分词器）对多种文本进行 token 切分可视化。

核心结论：
- 英文约 **0.75 词 / token**（4 个字母 ≈ 1 token）
- 中文约 **1.5 字 / token**（1 个汉字通常需要 1-2 个 token）
- 代码 / JSON 的 token 效率通常**低于**自然语言

### sampling.ts

��相同 prompt 调用 Claude Haiku，对比 4 种采样配置：

| 配置 | 特点 | 适合场景 |
|------|------|---------|
| `temperature=0` | 确定性，每次相同 | 结构化提取、分类 |
| `temperature=0.7` | 平衡，推荐默认 | 通用对话 |
| `temperature=1.2` | 高创意，偶有奇怪输出 | 头脑风暴、创意写作 |
| `top_p=0.1` | 只从最高概率 token 采样 | 专业领域精确输出 |

---

## 关键概念

- **BPE（Byte Pair Encoding）**：主流 tokenizer 算法，将文本切成"子��"而非整词
- **Context Window**：一次调用能处理的最大 token 数（Claude Sonnet 4.6 = 200k）
- **Temperature**：控制 softmax 后概率分布的"平坦度"，越高越随机
- **Top-p（nucleus sampling）**：从累积概率达到 p 的最小 token 集中采样
