/**
 * RAG 知识库文档
 *
 * 模拟一份"公司内部技术手册"，包含多个主题的文档片段。
 * 真实场景下，这些内容可能来自 Confluence、Notion、PDF、Markdown 文件等。
 *
 * 每条文档已经是合适大小的 chunk（200-500 字），方便直接 embed。
 */

export interface KnowledgeDoc {
  id: string
  /** 所属模块 / 文件来源 */
  category: string
  /** 文档标题（可选，用于展示） */
  title: string
  /** 文本内容 */
  content: string
}

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  // ─── 部署相关 ───────────────────────────────────────────────────────────────
  {
    id: 'deploy-001',
    category: '部署手册',
    title: '系统最低配置要求',
    content:
      '生产环境最低配置：4 核 CPU、16GB 内存、100GB SSD 存储。' +
      '推荐配置：8 核 CPU、32GB 内存、500GB SSD。' +
      '操作系统支持 Ubuntu 22.04 LTS 或 CentOS 8+。' +
      '需要预装 Docker 24.0+ 和 Docker Compose v2。',
  },
  {
    id: 'deploy-002',
    category: '部署手册',
    title: '环境变量配置',
    content:
      '必须配置的环境变量：OPENAI_API_KEY（AI 接口密钥）、DATABASE_URL��PostgreSQL 连接串）、' +
      'REDIS_URL（缓存连接串）、SECRET_KEY（JWT 签名密钥，建议 64 位随机字符串）。' +
      '可选配置：LOG_LEVEL（默认 info）、MAX_WORKERS（默认 4）、RATE_LIMIT_RPM（每分钟请求限制，默认 60）。',
  },
  {
    id: 'deploy-003',
    category: '部署手册',
    title: '首次部署步骤',
    content:
      '1. 克隆仓库：git clone https://github.com/example/platform.git\n' +
      '2. 复制配置文件：cp .env.example .env，并填写所有必填环境变量\n' +
      '3. 启动服务：docker compose up -d\n' +
      '4. 初始化数据库：docker compose exec api pnpm db:migrate\n' +
      '5. 创建管理员账号：docker compose exec api pnpm admin:create\n' +
      '首次启动约需 3-5 分钟，期间服务会自动拉取依赖镜像。',
  },
  // ─── API 文档 ───────────────────────────────────────────────────────────────
  {
    id: 'api-001',
    category: 'API 文档',
    title: '认证方式',
    content:
      '所有 API 请求需要在 Header 中携带 Authorization 字段，格式：Bearer <token>。' +
      'Token 通过 POST /auth/login 获取，有效期 24 小时。' +
      '过期后调用任意接口会返回 401 状态码，需要重新登录获取新 token。' +
      '建议在客户端实现自动刷新逻辑：在 token 过期前 5 分钟调用 POST /auth/refresh。',
  },
  {
    id: 'api-002',
    category: 'API 文档',
    title: '限流规则',
    content:
      '默认限流：每个 API Key 每分钟最多 60 次请求（RPM）。' +
      '超出限流返回 429 状态码，响应头中包含 Retry-After 字段（单位：秒）。' +
      '企业版用户可申请提高限流上限，最高支持 1000 RPM。' +
      '批量处理场景建议使用异步队列接口（POST /jobs/batch），不受 RPM 限制。',
  },
  {
    id: 'api-003',
    category: 'API 文档',
    title: '错误码说明',
    content:
      '常见错误码：400（请求参数格式错误）、401（未认证或 token 过期）、' +
      '403（权限不足）、404（资源不存在）、429（触发限流）、500（服务内部错误）。' +
      '所有错误响应统一格式：{ "error": { "code": "ERROR_CODE", "message": "描述" } }。' +
      '遇到 500 错误建议保存 requestId（响应头中的 X-Request-Id）并联系技术支持。',
  },
  // ─── 故障排查 ───────────────────────────────────────────────────────────────
  {
    id: 'trouble-001',
    category: '故障排查',
    title: '服务无法启动',
    content:
      '服务无法启动时，优先检查以下几点：' +
      '1. 查看日志：docker compose logs api --tail 50\n' +
      '2. 检查环境变量是否全部配置（特别是 DATABASE_URL 和 OPENAI_API_KEY）\n' +
      '3. 确认端口未被占用：lsof -i :3000\n' +
      '4. 数据库是否正常运行：docker compose ps\n' +
      '如果日志显示"connection refused"，通常是数据库还没完全启动，等待 30 秒后重试。',
  },
  {
    id: 'trouble-002',
    category: '故障排查',
    title: 'AI 响应速度慢',
    content:
      'AI 响应慢的常见原因：' +
      '1. Context 过长：检查是否把完整的历史对话都传给了 LLM，建议只保留最近 10 轮\n' +
      '2. 向量检索慢：检查 Qdrant 是否启用了 HNSW 索引（默认开启，但集合数量多时会变慢）\n' +
      '3. 网络延迟：如果使用第三方 API 中转，检查中转站到 OpenAI 的延迟\n' +
      '建议在代码中打点计时，分别统计 embedding、向量检索、LLM 调用三个阶段的耗时。',
  },
  {
    id: 'trouble-003',
    category: '故障排查',
    title: '回答质量差或胡说',
    content:
      'RAG 回答质量差的几种情况及解法：' +
      '1. 检索结果不相关：相似度门槛设得太低（< 0.5），可以调高到 0.65\n' +
      '2. 知识库覆盖不全：用户问题不在知识库范围内，需要补充文档或加人工兜底\n' +
      '3. Chunk 太小导致缺乏上下文：把 chunk 大小从 100 字调整到 300-400 字\n' +
      '4. System prompt 写得太模糊：明确告诉模型"只能根据提供的知识库内容回答，不能凭空推断"',
  },
  // ─── 计费说明 ───────────────────────────────────────────────────────────────
  {
    id: 'billing-001',
    category: '计费说明',
    title: '套餐对比',
    content:
      '基础版：每月 ¥299，包含 10,000 次 AI 对话，5GB 向量存储，社区支持。' +
      '专业版：每月 ¥999，包含 50,000 次 AI 对话，50GB 向量存储，邮件支持，自定义 System Prompt。' +
      '企业版：面议，支持私有化部署、SSO、专属客服、SLA 保障。' +
      '所有套餐超出包含量后按量计费：对话 ¥0.03/次，存储 ¥0.5/GB/月。',
  },
  {
    id: 'billing-002',
    category: '计费说明',
    title: '发票与退款',
    content:
      '发票：支持开具增值税普通发票和专用发票，在控制台"账户-发票管理"申请，' +
      '3 个工作日内开具并发送到注册邮箱。' +
      '退款：年付套餐在购买后 7 天内可申请全额退款；超过 7 天按已使用天数扣除费用后退款。' +
      '月付套餐不支持退款，建议先试用基础版或申请 14 天免费试用。',
  },
]
