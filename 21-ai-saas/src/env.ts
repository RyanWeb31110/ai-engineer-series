// 手动加载章节根目录的 .env
// 如果当前章节的 .env 缺失，回落到 20-cost-control/.env，保证默认跑通
// 项目规范不引入 dotenv 包，始终用 readFileSync 自行解析

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

function parseEnv(text: string): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

function loadEnv(): void {
  const candidates = [
    resolve(currentDir, '../.env'),
    resolve(currentDir, '../../20-cost-control/.env'),
  ]
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8')
      parseEnv(text)
      // 有一个能读到就结束，确保相同 key 不被后续覆盖
      return
    } catch {
      // 当前候选不存在时继续下一个
    }
  }
  // 全部缺失时静默跳过，由 SDK 自行抛错
}

loadEnv()
