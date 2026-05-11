import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText, tool, UIMessage } from 'ai'
import { z } from 'zod'

// 使用自定义 baseURL 的 OpenAI 提供商（中转站）
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.OPENAI_BASE_URL,
})

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: openai('gpt-5.4'),
    system:
      'You are a helpful assistant. When asked to calculate something, use the calculate tool.',
    messages: await convertToModelMessages(messages),
    tools: {
      calculate: tool({
        description: 'Evaluate a mathematical expression and return the result',
        inputSchema: z.object({
          expression: z
            .string()
            .describe('The math expression to evaluate, e.g. "2 + 2" or "10 * 5"'),
        }),
        execute: async ({ expression }) => {
          try {
            // 安全地计算数学表达式（仅允许数字和运算符）
            const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '')
            const result = Function(`'use strict'; return (${sanitized})`)()
            return { result: String(result), expression }
          } catch {
            return { error: 'Invalid expression', expression }
          }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
