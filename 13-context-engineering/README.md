# 第 13 章：Context Engineering

> 在有限 Token 预算里装最多价值 — AI 工程师最核心的工程能力

配套文章：[公众号链接待更新](#)

---

## 本章示例

| 脚本 | 说明 |
|------|------|
| `src/context-demo.ts` | Context 污染 vs 精确 Context 对比；研究与实现分离演示 |
| `src/adversarial-verify.ts` | 对抗验证模式：Bug-Finder + Adversarial + Referee 三角制衡 |

---

## 快速开始

```bash
# 在仓库根目录先安装依赖
pnpm install

cd 13-context-engineering
cp .env.example .env
# 填入 ANTHROPIC_API_KEY

# Context 对比演示
pnpm context-demo

# 对抗验证模式（会调用 Claude Sonnet，消耗稍多）
pnpm adversarial-verify
```

---

## 核心概念

### Anthropic 定义的四策略

| 策略 | 说明 | 典型场景 |
|------|------|---------|
| **Write** | 把信息写入外部存储，不占窗口 | 长期记忆、文件系统、数据库 |
| **Select** | 按需把相关内容拉入 Context | RAG、记忆搜索 |
| **Compress** | 对历史做摘要，保��要点 | 长对话压缩、工具输出精简 |
| **Isolate** | 子任务分给独立 Agent，各自最小 Context | 多 Agent 并行、任务分解 |

### Context 污染的反模式

**症状**：Agent 在回答简单问题时，输出中夹带了不相关的历史背景内容。

**根因**：System Prompt 或对话历史中存在与当前任务无关的信息。

**修复**：任务切换时用新 Session，System Prompt 只写当前角色所需的信息。

### 研究与实现分离

```
❌ 错误：直接说"帮我实现一个 auth 系统"
         → Agent 要先研究所有方案，Context 被选型��比细节填满
         → 实现时容易被干扰，产出质量下降

✅ 正确：
  Session A（探索）→ 研究 3 种方案，给出选型建议
  确认方案后
  Session B（实现）→ 全新 Context，直接说"用 NextAuth.js v5 实现 Google OAuth"
```

### 对抗验证模式（Adversarial Verification Pattern）

利用 Agent 的"讨好性"（Sycophancy）设计三角制衡结构：

```
Bug-Finder  → 激励穷举所有问题（偏向"有问题"）
     ↓
Adversarial → 激励推翻不成立的指控（偏向"没问题"，但有惩罚）
     ↓
Referee     → 中立裁判，综合两方给出最终结论（用更强模型）
```

**核心洞察**：单个 Agent 在"找 bug"这类任务上容易制造不存在的问题（因为它想满足你的请求）。三角结构通过互相制衡，让最终结论接近真相。

**适用场景**：
- 代码安全审查
- 方案可行性评估
- 事实核查 / 防幻觉

---

## 关键结论

1. **Context 质量 > Context 数量**：给 Agent 100 个相关 Token，远好过给 10000 个混杂 Token
2. **研究和实现永远分 Session**：探索阶段的宽 Context 会污染实现阶段的精确执行
3. **Sycophancy 可以被设计**：不只是缺陷，正确引导下它是强大的工具
