import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Chat — Vercel AI SDK Demo',
  description: 'AI chat app built with Next.js 15 and Vercel AI SDK',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-white antialiased">{children}</body>
    </html>
  )
}
