// 多租户配额：给不同 Tenant 分配每日调用次数和预算
// 真实 SaaS 的计费层还包含套餐、额度、退款、发票等，本文件只保留核心的用量扣减

import type { ModelTier } from './pricing.js'

export interface TenantQuota {
  /** 每日允许的调用次数 */
  dailyCalls: number
  /** 每日允许的花费（USD） */
  dailyBudgetUSD: number
  /** 允许访问的最高档位，low-tier plan 可能禁用 large */
  maxTier: ModelTier
}

export interface TenantUsage {
  calls: number
  spendUSD: number
}

export interface TenantRecord {
  id: string
  name: string
  quota: TenantQuota
  usage: TenantUsage
}

const tenants = new Map<string, TenantRecord>()

// 预置两个示例租户：免费版和企业版
export function seedTenants(): void {
  tenants.set('tenant-free', {
    id: 'tenant-free',
    name: 'Acme Free Tier',
    quota: { dailyCalls: 50, dailyBudgetUSD: 0.01, maxTier: 'medium' },
    usage: { calls: 0, spendUSD: 0 },
  })
  tenants.set('tenant-pro', {
    id: 'tenant-pro',
    name: 'Acme Pro Tier',
    quota: { dailyCalls: 2000, dailyBudgetUSD: 5, maxTier: 'large' },
    usage: { calls: 0, spendUSD: 0 },
  })
}

export function getTenant(id: string): TenantRecord {
  const t = tenants.get(id)
  if (!t) throw new Error(`unknown tenant: ${id}`)
  return t
}

export interface QuotaCheck {
  allowed: boolean
  reason?: string
}

/**
 * 预检查：判断这一次调用是否在租户配额内
 * 注意：此时还不知道实际 token 消耗，预算检查只能拿"已累计"花费来做保守判断
 */
export function checkQuota(tenant: TenantRecord): QuotaCheck {
  if (tenant.usage.calls >= tenant.quota.dailyCalls) {
    return { allowed: false, reason: 'daily-calls-exceeded' }
  }
  if (tenant.usage.spendUSD >= tenant.quota.dailyBudgetUSD) {
    return { allowed: false, reason: 'daily-budget-exceeded' }
  }
  return { allowed: true }
}

/**
 * 档位裁剪：把路由决策的 tier 压到租户允许的最高档内
 * 返回的 tier 永远不会超过 quota.maxTier
 */
export function capTier(desired: ModelTier, cap: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { small: 1, medium: 2, large: 3 }
  return rank[desired] <= rank[cap] ? desired : cap
}

export function recordUsage(tenant: TenantRecord, costUSD: number): void {
  tenant.usage.calls += 1
  tenant.usage.spendUSD += costUSD
}
