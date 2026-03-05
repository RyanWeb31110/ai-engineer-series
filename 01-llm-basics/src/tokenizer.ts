/**
 * 01-llm-basics / tokenizer.ts
 *
 * 演示 Token 切分，对应文章：
 * 《LLM 是怎么工作的：Token、Attention、采样》
 *
 * 运行：pnpm tokenizer
 */

import { encoding_for_model } from 'js-tiktoken'

// ─── 示例文本 ─────────────────────────────────────────────────────────────────

const SAMPLES = [
  // 英文：单词级别切分
  'Hello, world! This is a test.',
  // 中文：字/词级别切分，每个汉字通常 1-2 个 token
  '你好世界！这是一个测试。',
  // 代码：关键字、缩进都会影响 token 数
  'function add(a, b) { return a + b; }',
  // 混合：中英文混排
  'OpenAI 的 GPT-4 模型支持 128k context window',
  // 常见"token 陷阱"：数字、颜色词、罕见词
  '9.11 vs 9.9 — which is larger?',
]

// ─── 核心函数 ─────────────────────────────────────────────────────────────────

/**
 * 可视化 token 切分结果
 * 每个 token 用 [] 包裹，方便肉眼观察
 */
function visualizeTokens(text: string, modelName: 'gpt-4o' | 'gpt-3.5-turbo' = 'gpt-4o'): void {
  const enc = encoding_for_model(modelName)

  const tokenIds = enc.encode(text)
  const tokens: string[] = []

  for (const id of tokenIds) {
    const bytes = enc.decode(new Uint32Array([id]))
    const str = new TextDecoder().decode(bytes)
    tokens.push(str)
  }

  enc.free() // 释放 WASM 内存

  const count = tokenIds.length
  // 每个 token 用方括号标注，特殊字符用 · 替代
  const visual = tokens.map((t) => `[${t.replace(/\n/g, '↵').replace(/\t/g, '→')}]`).join('')

  console.log(`\n原文 (${text.length} 字符 → ${count} tokens):`)
  console.log(`  ${text}`)
  console.log(`Token 切分:`)
  console.log(`  ${visual}`)
  console.log(`压缩比: ${(text.length / count).toFixed(2)} 字符/token`)
}

/**
 * 对比同一段文本在不同场景下的 token 消耗
 * 用于说明"成本估算"的思维方式
 */
function costEstimate(text: string, pricePerMToken: number = 0.15): void {
  const enc = encoding_for_model('gpt-4o')
  const tokenCount = enc.encode(text).length
  enc.free()

  const cost = (tokenCount / 1_000_000) * pricePerMToken
  console.log(`\n成本估算 (${tokenCount} tokens @ $${pricePerMToken}/MTok):`)
  console.log(`  ≈ $${cost.toFixed(8)} / 次`)
  console.log(`  1 万次调用 ≈ $${(cost * 10000).toFixed(4)}`)
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

console.log('='.repeat(60))
console.log('Token 可视化工具 — 基于 tiktoken (GPT-4o 编码器)')
console.log('='.repeat(60))

for (const sample of SAMPLES) {
  visualizeTokens(sample)
}

// 演示成本估算（以 GPT-4o 输入价格为例）
const longText = '请帮我分析这段代码的时间复杂度，并给出优化建议。'.repeat(10)
costEstimate(longText, 0.15)

console.log('\n' + '='.repeat(60))
console.log('关键结论：')
console.log('  1. 英文约 0.75 词/token；中文约 1.5 字/token')
console.log('  2. 代码、JSON 的 token 效率通常低于自然语言')
console.log('  3. 同样内容用 Claude 的 token 计数会略有差异（不同分词器）')
console.log('='.repeat(60))
