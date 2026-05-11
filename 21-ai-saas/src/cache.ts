// 应用层响应缓存
// 基于 sha256(messages + model + tenant) 做 key，相同输入直接返回历史结果
// 生产环境建议换成 Redis 等共享缓存，并加 TTL 与容量上限

import { createHash } from 'node:crypto'
import type { LLMResponse, Message } from '@ai-series/shared'

interface CacheEntry {
  response: LLMResponse
  cachedAt: number
}

const store = new Map<string, CacheEntry>()

export function cacheKey(tenantId: string, messages: Message[], model: string): string {
  const payload = JSON.stringify({ tenantId, messages, model })
  return createHash('sha256').update(payload).digest('hex')
}

export function cacheGet(key: string): LLMResponse | null {
  const entry = store.get(key)
  return entry ? entry.response : null
}

export function cacheSet(key: string, response: LLMResponse): void {
  store.set(key, { response, cachedAt: Date.now() })
}

export function cacheStats(): { size: number } {
  return { size: store.size }
}
