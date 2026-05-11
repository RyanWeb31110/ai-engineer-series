// 书店 REST API 服务 — Express 实现
// 提供标准的 REST 接口 + OpenAPI spec 端点，供 Plugin Agent 调用

import express from 'express'
import type { Request, Response } from 'express'
import { bookstoreSpec } from './openapi-spec.js'

// ─── 数据层 ─────────────────────────────────────────────────────────────────

interface Book {
  id: string
  title: string
  author: string
  category: string
  price: number
  description: string
  publishedYear: number
  pages: number
  rating: number
}

// 预置一些示例数据
const books = new Map<string, Book>()
let nextId = 1

function seedData(): void {
  const sampleBooks: Omit<Book, 'id'>[] = [
    {
      title: 'JavaScript: The Good Parts',
      author: 'Douglas Crockford',
      category: 'programming',
      price: 29.99,
      description: 'Most programming languages contain good and bad parts, but JavaScript has more than its share of the bad, having been developed and released in a hurry before it could be refined.',
      publishedYear: 2008,
      pages: 176,
      rating: 4.3,
    },
    {
      title: 'Deep Learning',
      author: 'Ian Goodfellow',
      category: 'ai',
      price: 72.0,
      description: 'An introduction to a broad range of topics in deep learning, covering mathematical and conceptual background, deep learning techniques used in industry, and research perspectives.',
      publishedYear: 2016,
      pages: 800,
      rating: 4.6,
    },
    {
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      category: 'database',
      price: 45.99,
      description: 'Data is at the center of many challenges in system design today. This book helps you navigate the diverse landscape of technologies for processing and storing data.',
      publishedYear: 2017,
      pages: 616,
      rating: 4.8,
    },
    {
      title: 'The Pragmatic Programmer',
      author: 'David Thomas & Andrew Hunt',
      category: 'programming',
      price: 49.99,
      description: 'Your journey to mastery. Straight from the programming trenches, The Pragmatic Programmer cuts through the increasing specialization and technicalities of modern software development.',
      publishedYear: 2019,
      pages: 352,
      rating: 4.7,
    },
    {
      title: 'Hands-On Machine Learning',
      author: 'Aurelien Geron',
      category: 'ai',
      price: 59.99,
      description: 'Through a series of recent breakthroughs, deep learning has boosted the entire field of machine learning. Now, even programmers who know close to nothing about this technology can use simple, efficient tools to implement programs capable of learning from data.',
      publishedYear: 2022,
      pages: 856,
      rating: 4.7,
    },
    {
      title: 'The Design of Everyday Things',
      author: 'Don Norman',
      category: 'design',
      price: 18.99,
      description: 'The ultimate guide to human-centered design. Even the smartest among us can feel inept as we fail to figure out which light switch or door handle controls what.',
      publishedYear: 2013,
      pages: 368,
      rating: 4.5,
    },
  ]

  for (const book of sampleBooks) {
    const id = `book-${nextId++}`
    books.set(id, { id, ...book })
  }
}

// ─── Express 应用 ────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// OpenAPI spec 端点 — Plugin 系统通过这个端点发现 API 能力
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(bookstoreSpec)
})

// 搜索图书
app.get('/books', (req: Request, res: Response) => {
  const q = (req.query.q as string || '').toLowerCase()
  const category = req.query.category as string || ''

  let results = Array.from(books.values())

  if (q) {
    results = results.filter(
      b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
  }
  if (category) {
    results = results.filter(b => b.category === category)
  }

  // 返回精简信息（列表视图不需要完整详情）
  const list = results.map(({ id, title, author, category, price }) => ({
    id, title, author, category, price,
  }))
  res.json(list)
})

// 查看图书详情
app.get('/books/:bookId', (req: Request, res: Response) => {
  const bookId = Array.isArray(req.params.bookId) ? req.params.bookId[0] : req.params.bookId
  const book = books.get(bookId)
  if (!book) {
    res.status(404).json({ error: 'Book not found' })
    return
  }
  res.json(book)
})

// 添加新图书
app.post('/books', (req: Request, res: Response) => {
  const { title, author, category, price, description } = req.body
  if (!title || !author || !category || price == null) {
    res.status(400).json({ error: 'Missing required fields: title, author, category, price' })
    return
  }

  const id = `book-${nextId++}`
  const book: Book = {
    id,
    title,
    author,
    category,
    price,
    description: description || '',
    publishedYear: new Date().getFullYear(),
    pages: 0,
    rating: 0,
  }
  books.set(id, book)
  res.status(201).json(book)
})

// 查看分类列表
app.get('/categories', (_req: Request, res: Response) => {
  const countMap = new Map<string, number>()
  for (const book of books.values()) {
    countMap.set(book.category, (countMap.get(book.category) || 0) + 1)
  }
  const categories = Array.from(countMap.entries()).map(([name, count]) => ({ name, count }))
  res.json(categories)
})

// ─── 启动服务 ────────────────────────────────────────────────────────────────

const PORT = 3100

seedData()
app.listen(PORT, () => {
  console.log(`[Bookstore API] Server running at http://localhost:${PORT}`)
  console.log(`[Bookstore API] OpenAPI spec: http://localhost:${PORT}/openapi.json`)
  console.log(`[Bookstore API] Loaded ${books.size} sample books`)
})
