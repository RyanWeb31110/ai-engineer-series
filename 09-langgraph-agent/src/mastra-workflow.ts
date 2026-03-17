/**
 * Mastra Workflow 示例
 *
 * 展示 Mastra 的 Workflow 能力：用确定性的图结构编排多步骤任务。
 * 场景：一个「出差规划助手」，依次执行查天气 → 评估出行建议 → 查费用政策 → 汇总报告。
 *
 * 和 Agent 的区别：
 * - Agent：LLM 自主决定调哪个工具、调几次（开放式推理）
 * - Workflow：开发者预定义执行顺序和分支条件（确定性编排）
 *
 * 运行：pnpm workflow
 */

import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { Mastra } from '@mastra/core'

// ─── 加载 .env ──────────────────────────────────────────────────────────────────

const dotenvPath = new URL('../.env', import.meta.url).pathname
try {
  const envContent = readFileSync(dotenvPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && !key.startsWith('#') && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim()
    }
  }
} catch {
  // .env 不存在时跳过
}

// ─── Step 1: 查询天气 ───────────────────────────────────────────────────────────

const WEATHER_DATA: Record<string, { temp: number; condition: string; humidity: number }> = {
  北京: { temp: 5, condition: '晴，有北风 3-4 级', humidity: 30 },
  上海: { temp: 12, condition: '阴转小雨', humidity: 78 },
  广州: { temp: 22, condition: '多云', humidity: 65 },
  成都: { temp: 10, condition: '阴，有雾', humidity: 85 },
}

const fetchWeatherStep = createStep({
  id: 'fetch-weather',
  inputSchema: z.object({
    city: z.string(),
    days: z.number(),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
  }),
  execute: async ({ inputData }) => {
    console.log(`  [Step 1] Fetching weather for ${inputData.city}...`)
    const data = WEATHER_DATA[inputData.city] ?? { temp: 15, condition: '晴', humidity: 50 }
    return {
      city: inputData.city,
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
    }
  },
})

// ─── Step 2: 评估出行建议（条件分支） ───────────────────────────────────────────

const goodWeatherStep = createStep({
  id: 'good-weather-advice',
  inputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
  }),
  outputSchema: z.object({
    advice: z.string(),
    packingList: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log('  [Step 2] Good weather path - generating advice...')
    return {
      advice: `${inputData.city}天气不错（${inputData.temperature}°C，${inputData.condition}），适合出行。`,
      packingList: ['薄外套', '墨镜', '防晒霜'],
    }
  },
})

const badWeatherStep = createStep({
  id: 'bad-weather-advice',
  inputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
  }),
  outputSchema: z.object({
    advice: z.string(),
    packingList: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    console.log('  [Step 2] Bad weather path - generating advice...')
    return {
      advice: `${inputData.city}天气较差（${inputData.temperature}°C，${inputData.condition}），注意防寒保暖。`,
      packingList: ['厚外套', '雨伞', '暖宝宝', '口罩'],
    }
  },
})

// ─── Step 3: 汇总报告 ───────────────────────────────────────────────────────────

const generateReportStep = createStep({
  id: 'generate-report',
  inputSchema: z.object({
    'good-weather-advice': z
      .object({
        advice: z.string(),
        packingList: z.array(z.string()),
      })
      .optional(),
    'bad-weather-advice': z
      .object({
        advice: z.string(),
        packingList: z.array(z.string()),
      })
      .optional(),
  }),
  outputSchema: z.object({
    report: z.string(),
  }),
  execute: async ({ inputData }) => {
    console.log('  [Step 3] Generating final report...')
    // 条件分支只有一个会执行，取有值的那个
    const result = inputData['good-weather-advice'] ?? inputData['bad-weather-advice']
    if (!result) {
      return { report: 'Error: no weather advice available' }
    }
    const report = [
      '=== 出差规划报告 ===',
      '',
      `出行建议: ${result.advice}`,
      `建议携带: ${result.packingList.join('、')}`,
    ].join('\n')
    return { report }
  },
})

// ─── 构建 Workflow ──────────────────────────────────────────────────────────────

/**
 * Workflow 结构：
 *
 *   fetchWeather → branch → goodWeatherStep (temp >= 15)
 *                         → badWeatherStep  (temp < 15)
 *               → generateReport
 *
 * 这就是 Mastra Workflow 的核心价值：
 * 用代码显式定义执行路径和分支条件，而不是交给 LLM 自主决定。
 */
const tripPlanningWorkflow = createWorkflow({
  id: 'trip-planning',
  inputSchema: z.object({
    city: z.string(),
    days: z.number(),
  }),
  outputSchema: z.object({
    report: z.string(),
  }),
})
  .then(fetchWeatherStep)
  .branch([
    [async ({ inputData }) => inputData.temperature >= 15, goodWeatherStep],
    [async ({ inputData }) => inputData.temperature < 15, badWeatherStep],
  ])
  .then(generateReportStep)
  .commit()

// ─── 运行 ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Mastra Workflow Demo')
  console.log('使用 Mastra Workflow 编排确定性的多步骤任务\n')

  // 注册 Workflow 到 Mastra 实例
  const mastra = new Mastra({
    workflows: {
      'trip-planning': tripPlanningWorkflow,
    },
  })

  const workflow = mastra.getWorkflow('trip-planning')

  // 场景一：去广州（温度 22°C，走 good weather 分支）
  console.log('\n' + '='.repeat(50))
  console.log('[场景一] 出差去广州（好天气路径）')
  console.log('='.repeat(50))

  const run1 = await workflow.createRun()
  const result1 = await run1.start({
    inputData: { city: '广州', days: 3 },
  })

  if (result1.status === 'success') {
    console.log(`\n${result1.result.report}`)
  } else {
    console.log('\nWorkflow failed:', result1.status)
  }

  // 场景二：去北京（温度 5°C，走 bad weather 分支）
  console.log('\n' + '='.repeat(50))
  console.log('[场景二] 出差去北京（坏天气路径）')
  console.log('='.repeat(50))

  const run2 = await workflow.createRun()
  const result2 = await run2.start({
    inputData: { city: '北京', days: 3 },
  })

  if (result2.status === 'success') {
    console.log(`\n${result2.result.report}`)
  } else {
    console.log('\nWorkflow failed:', result2.status)
  }
}

main().catch(console.error)
