// 手动加载章节根目录下的 .env 文件
// 项目规范不引入 dotenv 包，自己用 readFileSync 解析

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

function loadEnv(): void {
  const envPath = resolve(currentDir, '../.env')
  let text: string
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    // .env 不存在时静默跳过，由后续 SDK 校验抛错
    return
  }

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

loadEnv()
