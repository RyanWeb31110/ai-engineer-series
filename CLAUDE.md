# AI 工程师实战系列 — 开发规范

## SDK 使用规范

- **统一使用 OpenAI SDK**，所有章节配套代码一律用 `openai` 包 + 中转站，禁止使用 `@anthropic-ai/sdk`
- `.env` 固定格式：`OPENAI_API_KEY` + `OPENAI_BASE_URL`，用 `readFileSync` 手动加载，不引入 dotenv 包
- 模型统一用 `'gpt-5.4'`，或引用 `shared/src/types/index.ts` 中的 `MODELS.GPT5_CODEX`

## 中转站已知行为

- `tool_choice` 不支持 `{ type: 'function', function: { name } }` 精确指定，需用 `'required'`
- `finish_reason` 在有工具调用时返回 `'stop'` 而非标准的 `'tool_calls'`，判断是否有工具调用必须检查 `tool_calls.length > 0`，不能依赖 `finish_reason === 'tool_calls'`
