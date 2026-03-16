/**
 * RAG 进阶：Chunking 分块策略对比
 *
 * 演示三种主流分块策略：
 *   1. 固定大小 + 滑动窗口（Overlap）
 *   2. 按 Markdown 标题语义切块
 *   3. 父子 Chunk（Parent-Child Chunking）
 *
 * 运行：pnpm chunking
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface Chunk {
  index: number
  text: string
  charCount: number
}

export interface ParentChildChunk {
  parentIndex: number
  parent: string
  children: Chunk[]
}

// ─── 示例文档 ─────────────────────────────────────────────────────────────────

/**
 * 模拟���份产品文档，包含多个小节，用于演示不同分块策略的效果。
 * 注意：文档中有故意跨越字符边界的内容（退款说明），
 * 用来展示硬切导致语义割断的问题。
 */
const SAMPLE_DOCUMENT = `## 产品概述

本平台是一款基于 AI 的企业知识管理工具，帮助团队构建私有知识库并提供智能问答服务。核心功能包括文档管理、语义检索、多轮对话和权限控制。支持接入 Confluence、Notion、飞书等主流知识库平台，也可以直接上传 PDF、Word、Markdown 文件。

## 快速开始

### 注册与登录

访问 https://platform.example.com 完成注册，支持企业邮箱和 SSO 单点登录。注册后系统会自动创建一个演示工作区，内含示例文档和预设问答，方便快速体验产品功能。

### 创建知识库

点击左侧"知识库"菜单，选择"新建知识库"。填写名称和描述后，选择知识库类型：公开（团队所有成员可查看）或私有（仅授权成员可访问）。创建完成后即可开始上传文档。

### 上传文档

支持单文件上传和批量导入两种方式。单文件支持 PDF、Word、Markdown、TXT 格式，大小限制 50MB。批量导入支持通过 API 或连接器（Connector）自动同步外部知识库。文档上传后，系统会自动进行解析、分块和向量化处理，通常在 1~5 分钟内完成。

## 检索与问答

### 语义搜索

在搜索框输入自然语言问题，系统会自动检索最相关的文档片段。搜索支持中英文混合输入，也支持精确词语匹配（在搜索词前加引号，如 "ERR_QUOTA_EXCEEDED"）。

### AI 问答

问答功能基于 RAG 架构，模型会根据检索到的文档内容生成回答，并标注参考来源。如果知识库中没有相关内容，模型会明确告知用户，而不是凭空编造答案。

## 计费与退款

### 套餐说明

基础版每月 299 元，包含 10,000 次 AI 对话和 5GB 向量存储，适合小型团队。专业版每月 999 元，包含 50,000 次对话和 50GB 存储，支持自定义 System Prompt 和邮件客服。企业版支持私有化部署，价格面议。

### 退款申请

退款申请需要在购买后 7 天内提交，年付套餐符合条件的申请会在提交后 24 小时内自动审核处理。审核通过后，退款金额会在 3~5 个工作日内原路退回到付款账户。月付套餐不支持退款，建议先使用 14 天免费试用期充分评估后再购买。

## 技术规格

支持的文件格式：PDF、DOCX、PPTX、XLSX、Markdown、TXT、HTML。最大文件大小：单文件 50MB，批量导入总量 500MB/次。向量存储：基于 Qdrant，支持 1536 维和 3072 维向量。API 并发：免费版 5 QPS，付费版 50 QPS，企业版支持定制。`

// ─── 策略一：固定大小 + 滑动窗口 ──────────────────────────────────────────────

/**
 * 按字符数固定切块，相邻 chunk 之间保留 overlap 个字符的重叠。
 *
 * @param text 原始文本
 * @param chunkSize 每块的目标大小（字符数）
 * @param overlap 相邻块的重叠字符数
 */
export function chunkWithOverlap(text: string, chunkSize: number, overlap: number): Chunk[] {
  if (overlap >= chunkSize) throw new Error('overlap 必须小于 chunkSize')

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    const chunkText = text.slice(start, end)
    chunks.push({ index: index++, text: chunkText, charCount: chunkText.length })
    // 下一块从 (start + chunkSize - overlap) 开始，确保重叠
    start += chunkSize - overlap
  }

  return chunks
}

// ─── 策略二：按 Markdown 标题语义切块 ─────────────────────────────────────────

/**
 * 按 Markdown 标题（# / ## / ###）作为切割点。
 * 每个标题连同其下方的内容作为一个独立 chunk。
 *
 * 适用于结构清晰的 Markdown 文档，能保证每块语义完整。
 *
 * @param markdown Markdown 格式的文本
 * @param minLength 过滤掉过短的 chunk（字符数低于此值的会被丢弃）
 */
export function chunkByMarkdownHeadings(markdown: string, minLength: number = 50): Chunk[] {
  // 以 #/##/### 开头的行作为切割点，使用前瞻断言保留标题本身
  const sections = markdown.split(/(?=^#{1,3}\s)/m)
  return sections
    .map(s => s.trim())
    .filter(s => s.length >= minLength)
    .map((text, index) => ({ index, text, charCount: text.length }))
}

// ─── 策略三：父子 Chunk ────────────────────────────────────────────────────────

/**
 * 构建父子 Chunk：
 *   - 父 chunk（粗粒度）：用于生成阶段，提供充足上下文
 *   - 子 chunk（细粒度）：用于检索阶段，精确匹配问题
 *
 * 检索时用子 chunk 匹配（精度高），命中后把对应的父 chunk 传给 LLM（上下文充分）。
 *
 * @param text 原始文本
 * @param parentSize 父 chunk 大小（字符数），建议 500~800
 * @param childSize 子 chunk 大小（字符数），建议 100~200
 * @param childOverlap 子 chunk 之间的重叠字符数
 */
export function buildParentChildChunks(
  text: string,
  parentSize: number = 600,
  childSize: number = 150,
  childOverlap: number = 20,
): ParentChildChunk[] {
  // 父 chunk 之间不设重叠，避免重复入库
  const parents = chunkWithOverlap(text, parentSize, 0)

  return parents.map(parent => ({
    parentIndex: parent.index,
    parent: parent.text,
    children: chunkWithOverlap(parent.text, childSize, childOverlap),
  }))
}

// ─── 主入口：对比三种策略 ──────────────────────────────────────────────────────

function printChunkStats(label: string, chunks: Chunk[]): void {
  const totalChars = chunks.reduce((sum, c) => sum + c.charCount, 0)
  const avgChars = Math.round(totalChars / chunks.length)
  const minChars = Math.min(...chunks.map(c => c.charCount))
  const maxChars = Math.max(...chunks.map(c => c.charCount))

  console.log(`\n${label}`)
  console.log(`  chunk 数量：${chunks.length}`)
  console.log(`  平均长度：${avgChars} 字符 | 最短：${minChars} | 最长：${maxChars}`)
}

function main(): void {
  const docLength = SAMPLE_DOCUMENT.length
  console.log(`示例文档总长度：${docLength} 字符`)
  console.log('='.repeat(60))

  // ── 策略一：固定大小 + Overlap ──
  const fixedChunks = chunkWithOverlap(SAMPLE_DOCUMENT, 300, 50)
  printChunkStats('策略一：固定大小 + Overlap（size=300, overlap=50）', fixedChunks)

  // 展示第 1 块末尾和第 2 块开头，验证 overlap 是否生效
  const end1 = fixedChunks[0].text.slice(-30).replace(/\n/g, '↵')
  const start2 = fixedChunks[1].text.slice(0, 30).replace(/\n/g, '↵')
  console.log(`  第 1 块末尾：「...${end1}」`)
  console.log(`  第 2 块开头：「${start2}...」`)
  console.log(`  ↑ 两块共享了 50 字符的内容，边界语义不会被截断`)

  // ── 策略二：Markdown 标题语义切块 ──
  const semanticChunks = chunkByMarkdownHeadings(SAMPLE_DOCUMENT)
  printChunkStats('策略二：按 Markdown 标题语义切块', semanticChunks)

  console.log('  各 chunk 对应的标题：')
  for (const chunk of semanticChunks) {
    // 取第一行作为标题展示
    const heading = chunk.text.split('\n')[0].trim()
    console.log(`    [${chunk.index}] ${heading}（${chunk.charCount} 字符）`)
  }

  // ── 策略三：父子 Chunk ──
  const parentChildChunks = buildParentChildChunks(SAMPLE_DOCUMENT, 600, 150, 20)
  const allChildren = parentChildChunks.flatMap(p => p.children)
  console.log('\n策略三：父子 Chunk（parentSize=600, childSize=150, childOverlap=20）')
  console.log(`  父 chunk 数量：${parentChildChunks.length}（传给 LLM 的单位）`)
  console.log(`  子 chunk 总数：${allChildren.length}（存入向量库的单位）`)
  console.log(`  平均每个父 chunk 对应 ${(allChildren.length / parentChildChunks.length).toFixed(1)} 个子 chunk`)

  // 展示第一个父 chunk 和它的子 chunk
  const firstParent = parentChildChunks[0]
  console.log(`\n  第 1 个父 chunk（${firstParent.parent.length} 字符）：`)
  console.log(`    「${firstParent.parent.slice(0, 60).replace(/\n/g, '↵')}...」`)
  console.log(`  拆分为 ${firstParent.children.length} 个子 chunk：`)
  for (const child of firstParent.children) {
    console.log(
      `    子 [${child.index}]（${child.charCount} 字符）：「${child.text.slice(0, 40).replace(/\n/g, '↵')}...」`,
    )
  }

  // ── 汇总建议 ──
  console.log('\n' + '='.repeat(60))
  console.log('选型建议：')
  console.log('  固定大小 + Overlap：实现简单，适合内容结构不规则的文档')
  console.log('  语义切块：结构清晰的 Markdown / 技术文档首选，chunk 边界自然')
  console.log('  父子 Chunk：最佳检索质量，推荐生产环境使用，代价是索引体积翻倍')
}

main()
