/**
 * 18-llmops / tracer.ts
 *
 * 轻量版 LangFuse 风格追踪器
 *
 * 核心模型：
 *   Trace       → 一次完整的 AI 业务调用（比如一次问答、一次 RAG 查询）
 *   Span        → Trace 下的通用步骤（检索、工具调用、数据库查询等）
 *   Generation  → 专门标记 LLM 调用的 Span，会自动记录 Token 和成本
 *
 * 所有观测数据落盘到 traces/<traceId>.jsonl，便于后续分析和回放。
 */

import { mkdirSync, appendFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type ObservationType = 'trace' | 'span' | 'generation'

export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 单条观测记录（落盘到 JSONL 的一行） */
export interface Observation {
  id: string
  traceId: string
  parentId: string | null
  type: ObservationType
  name: string
  startTime: string
  endTime?: string
  durationMs?: number
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  /** 仅 generation 有：Token 消耗 */
  usage?: Usage
  /** 仅 generation 有：美元成本 */
  costUsd?: number
  /** 仅 generation 有：模型名 */
  model?: string
  error?: string
}

/** 每 1K token 的美元价格，用于成本估算 */
export interface ModelPricing {
  inputPer1k: number
  outputPer1k: number
}

// 中转站用 gpt-5.4，价格按 OpenAI gpt-5 公开 pricing 估算（仅用于示例演示）
const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5.4': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-5': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-5-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
}

function estimateCost(model: string, usage: Usage): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-5.4']
  return (usage.inputTokens / 1000) * price.inputPer1k + (usage.outputTokens / 1000) * price.outputPer1k
}

// ─── Tracer 主体 ─────────────────────────────────────────────────────────────

export interface TracerOptions {
  /** 落盘目录，默认 ./traces */
  outDir?: string
  /** 是否同时打印到控制台 */
  console?: boolean
}

/**
 * 创建一个 Tracer 实例
 *
 * @example
 * const tracer = new Tracer({ console: true })
 * const trace = tracer.trace('rag-query', { userId: 'u1' })
 * const span = trace.span('retrieve')
 * span.end({ hits: 5 })
 * const gen = trace.generation('answer', { model: 'gpt-5.4' })
 * gen.end({ output: '...', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } })
 * trace.end()
 */
export class Tracer {
  private readonly outDir: string
  private readonly logToConsole: boolean

  constructor(options: TracerOptions = {}) {
    this.outDir = options.outDir ?? './traces'
    this.logToConsole = options.console ?? false
  }

  /** 创建一个根 Trace */
  trace(name: string, metadata?: Record<string, unknown>): Trace {
    return new Trace(this, name, metadata)
  }

  /** 写一条观测记录到 JSONL（内部使用） */
  _write(observation: Observation): void {
    const file = `${this.outDir}/${observation.traceId}.jsonl`
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(observation) + '\n', 'utf-8')
    if (this.logToConsole) {
      const dur = observation.durationMs ? ` ${observation.durationMs}ms` : ''
      const cost = observation.costUsd ? ` $${observation.costUsd.toFixed(6)}` : ''
      const tokens = observation.usage ? ` ${observation.usage.totalTokens}tok` : ''
      console.log(`[${observation.type}] ${observation.name}${dur}${tokens}${cost}`)
    }
  }
}

// ─── Trace / Span / Generation ───────────────────────────────────────────────

abstract class Observable {
  readonly id: string
  readonly traceId: string
  readonly parentId: string | null
  readonly name: string
  protected readonly tracer: Tracer
  protected readonly startTime: Date
  protected metadata: Record<string, unknown>
  protected input?: unknown
  protected ended = false

  constructor(tracer: Tracer, traceId: string, parentId: string | null, name: string, metadata?: Record<string, unknown>) {
    this.id = randomUUID()
    this.tracer = tracer
    this.traceId = traceId
    this.parentId = parentId
    this.name = name
    this.startTime = new Date()
    this.metadata = metadata ?? {}
  }

  /** 在当前观测下创建子 Span */
  span(name: string, metadata?: Record<string, unknown>): Span {
    const s = new Span(this.tracer, this.traceId, this.id, name, metadata)
    return s
  }

  /** 在当前观测下创建 Generation（LLM 调用） */
  generation(name: string, options: { model: string; input?: unknown; metadata?: Record<string, unknown> }): Generation {
    return new Generation(this.tracer, this.traceId, this.id, name, options)
  }
}

export class Trace extends Observable {
  constructor(tracer: Tracer, name: string, metadata?: Record<string, unknown>) {
    const traceId = randomUUID()
    super(tracer, traceId, null, name, metadata)
    this.tracer._write({
      id: this.id,
      traceId: this.traceId,
      parentId: null,
      type: 'trace',
      name,
      startTime: this.startTime.toISOString(),
      metadata: this.metadata,
    })
  }

  end(output?: unknown): void {
    if (this.ended) return
    this.ended = true
    const endTime = new Date()
    this.tracer._write({
      id: this.id,
      traceId: this.traceId,
      parentId: null,
      type: 'trace',
      name: `${this.name} [end]`,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - this.startTime.getTime(),
      output,
      metadata: this.metadata,
    })
  }
}

export class Span extends Observable {
  constructor(tracer: Tracer, traceId: string, parentId: string, name: string, metadata?: Record<string, unknown>) {
    super(tracer, traceId, parentId, name, metadata)
  }

  end(output?: unknown, error?: Error): void {
    if (this.ended) return
    this.ended = true
    const endTime = new Date()
    this.tracer._write({
      id: this.id,
      traceId: this.traceId,
      parentId: this.parentId,
      type: 'span',
      name: this.name,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - this.startTime.getTime(),
      input: this.input,
      output,
      metadata: this.metadata,
      error: error?.message,
    })
  }
}

export class Generation extends Observable {
  private readonly model: string

  constructor(
    tracer: Tracer,
    traceId: string,
    parentId: string,
    name: string,
    options: { model: string; input?: unknown; metadata?: Record<string, unknown> },
  ) {
    super(tracer, traceId, parentId, name, options.metadata)
    this.model = options.model
    this.input = options.input
  }

  end(result: { output?: unknown; usage: Usage; error?: Error }): void {
    if (this.ended) return
    this.ended = true
    const endTime = new Date()
    const costUsd = estimateCost(this.model, result.usage)
    this.tracer._write({
      id: this.id,
      traceId: this.traceId,
      parentId: this.parentId,
      type: 'generation',
      name: this.name,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - this.startTime.getTime(),
      input: this.input,
      output: result.output,
      metadata: this.metadata,
      usage: result.usage,
      costUsd,
      model: this.model,
      error: result.error?.message,
    })
  }
}
