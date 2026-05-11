'use client'

import { useChat } from '@ai-sdk/react'
import { isTextUIPart, isToolUIPart } from 'ai'
import { useState, useRef, useEffect } from 'react'

// 计算工具的输入/输出类型
type CalculateInput = { expression: string }
type CalculateOutput = { result?: string; error?: string; expression: string }

export function Chat() {
  const { messages, sendMessage, status } = useChat()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新消息到来时自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isStreaming = status === 'streaming'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    await sendMessage({ text })
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* 标题栏 */}
      <div className="border-b px-6 py-4 bg-white">
        <h1 className="text-xl font-semibold text-gray-900">AI Chat</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Powered by Next.js 15 + Vercel AI SDK
        </p>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-16">
            <p className="text-lg">Start a conversation</p>
            <p className="text-sm mt-2">
              Try asking: &quot;What is 123 * 456?&quot;
            </p>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-900 shadow-sm border border-gray-100'
              }`}
            >
              {message.parts.map((part, i) => {
                // 文本内容
                if (isTextUIPart(part)) {
                  return (
                    <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap">
                      {part.text}
                    </p>
                  )
                }

                // 工具调用结果
                if (isToolUIPart(part) && part.type === 'tool-calculate') {
                  const input = part.state !== 'input-streaming'
                    ? (part.input as CalculateInput)
                    : null
                  const output = part.state === 'output-available'
                    ? (part.output as CalculateOutput)
                    : null

                  return (
                    <div
                      key={i}
                      className={`mt-2 px-3 py-2 rounded-lg text-xs font-mono ${
                        message.role === 'user' ? 'bg-blue-400/30' : 'bg-gray-100'
                      }`}
                    >
                      {output ? (
                        <span>
                          {input?.expression} ={' '}
                          <strong>{output.result ?? output.error}</strong>
                        </span>
                      ) : (
                        <span className="opacity-60">
                          Calculating {input?.expression ?? '...'}
                        </span>
                      )}
                    </div>
                  )
                }

                return null
              })}
            </div>
          </div>
        ))}

        {/* 流式输出中的加载动画 */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
              <div className="flex gap-1 items-center h-4">
                {[0, 150, 300].map(delay => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t px-6 py-4 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask me anything..."
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="bg-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-600 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
