// OpenAPI 规范定义 — 书店 API
// 演示如何用 OpenAPI 3.1 描述一个 REST API，让 LLM 能自动发现和调用

/**
 * OpenAPI 规范的 TypeScript 类型定义
 * 完整规范参考：https://spec.openapis.org/oas/v3.1.0
 */
export interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    description: string
    version: string
  }
  servers: Array<{ url: string; description: string }>
  paths: Record<string, PathItem>
}

interface PathItem {
  get?: Operation
  post?: Operation
  put?: Operation
  delete?: Operation
}

interface Operation {
  operationId: string
  summary: string
  description: string
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses: Record<string, ResponseObject>
}

interface Parameter {
  name: string
  in: 'query' | 'path' | 'header'
  required: boolean
  description: string
  schema: SchemaObject
}

interface RequestBody {
  required: boolean
  content: Record<string, { schema: SchemaObject }>
}

interface ResponseObject {
  description: string
  content?: Record<string, { schema: SchemaObject }>
}

interface SchemaObject {
  type: string
  properties?: Record<string, SchemaObject & { description?: string }>
  required?: string[]
  items?: SchemaObject
  enum?: string[]
  description?: string
  example?: unknown
}

/**
 * 书店 API 的 OpenAPI 规范
 *
 * 这个 spec 描述了一个简单的书店 REST API，包含：
 * - 搜索图书（按关键词、分类）
 * - 查看图书详情
 * - 添加新图书
 * - 查看分类列表
 *
 * LLM 读到这个 spec 后，就知道有哪些 API 可用、参数是什么、返回什么
 */
export const bookstoreSpec: OpenAPISpec = {
  openapi: '3.1.0',
  info: {
    title: 'Bookstore API',
    description:
      'A simple bookstore API for searching, browsing, and managing books. ' +
      'Supports search by keyword and category, viewing book details, and adding new books.',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:3100',
      description: 'Local development server',
    },
  ],
  paths: {
    '/books': {
      get: {
        operationId: 'searchBooks',
        summary: 'Search books',
        description:
          'Search for books by keyword (matches title and author) and/or category. ' +
          'Returns a list of matching books with basic information.',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: false,
            description: 'Search keyword, matches against book title and author name',
            schema: { type: 'string', example: 'JavaScript' },
          },
          {
            name: 'category',
            in: 'query',
            required: false,
            description: 'Filter by book category',
            schema: {
              type: 'string',
              enum: ['programming', 'ai', 'database', 'devops', 'design'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of matching books',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'Book ID' },
                      title: { type: 'string', description: 'Book title' },
                      author: { type: 'string', description: 'Author name' },
                      category: { type: 'string', description: 'Book category' },
                      price: { type: 'number', description: 'Price in USD' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'addBook',
        summary: 'Add a new book',
        description: 'Add a new book to the bookstore inventory.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'author', 'category', 'price'],
                properties: {
                  title: { type: 'string', description: 'Book title' },
                  author: { type: 'string', description: 'Author name' },
                  category: {
                    type: 'string',
                    description: 'Book category',
                    enum: ['programming', 'ai', 'database', 'devops', 'design'],
                  },
                  price: { type: 'number', description: 'Price in USD' },
                  description: { type: 'string', description: 'Book description (optional)' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Book created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Generated book ID' },
                    title: { type: 'string' },
                    author: { type: 'string' },
                    category: { type: 'string' },
                    price: { type: 'number' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/books/{bookId}': {
      get: {
        operationId: 'getBookDetail',
        summary: 'Get book details',
        description: 'Get detailed information about a specific book by its ID.',
        parameters: [
          {
            name: 'bookId',
            in: 'path',
            required: true,
            description: 'The unique ID of the book',
            schema: { type: 'string', example: 'book-1' },
          },
        ],
        responses: {
          '200': {
            description: 'Book details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    author: { type: 'string' },
                    category: { type: 'string' },
                    price: { type: 'number' },
                    description: { type: 'string', description: 'Detailed book description' },
                    publishedYear: { type: 'number', description: 'Year published' },
                    pages: { type: 'number', description: 'Number of pages' },
                    rating: { type: 'number', description: 'Average rating (1-5)' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Book not found',
          },
        },
      },
    },
    '/categories': {
      get: {
        operationId: 'listCategories',
        summary: 'List all categories',
        description: 'Get a list of all available book categories with book counts.',
        responses: {
          '200': {
            description: 'List of categories',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Category name' },
                      count: { type: 'number', description: 'Number of books in this category' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

// 直接运行时打印完整 spec
const isMainModule = process.argv[1]?.endsWith('openapi-spec.ts')
if (isMainModule) {
  console.log(JSON.stringify(bookstoreSpec, null, 2))
  console.log(`\n--- OpenAPI Spec Summary ---`)
  console.log(`Title: ${bookstoreSpec.info.title}`)
  console.log(`Version: ${bookstoreSpec.info.version}`)
  console.log(`Server: ${bookstoreSpec.servers[0].url}`)
  const paths = Object.entries(bookstoreSpec.paths)
  for (const [path, methods] of paths) {
    for (const [method, op] of Object.entries(methods) as [string, Operation][]) {
      console.log(`  ${method.toUpperCase()} ${path} -> ${op.operationId}: ${op.summary}`)
    }
  }
}
