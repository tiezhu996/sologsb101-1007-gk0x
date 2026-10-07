/**
 * 阈值区间比较、累计量与日速率计算、毫米与米单位换算
 */
import type { Alarm, AlarmLevel, AlarmState } from '@/types/alarm'
import type { Observation } from '@/types/observation'
import type { Point } from '@/types/point'
import type { TrendPoint } from '@/types/observation'

/** 各级预警对应的“累计变化量 / 阈值”比例下限 */
export const ALARM_RATIO: Record<AlarmLevel, number> = { 蓝: 0.7, 黄: 0.85, 橙: 1.0, 红: 1.3 }

export const ALARM_COLOR: Record<AlarmLevel, string> = {
  蓝: '#2b6cb0',
  黄: '#d6a100',
  橙: '#e07b00',
  红: '#c0392b'
}

export const ALARM_BG: Record<AlarmLevel, string> = {
  蓝: '#e8f1fb',
  黄: '#fdf6e3',
  橙: '#fdf0e3',
  红: '#fdecea'
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 两个 YYYY-MM-DD 之间天数（至少 1） */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`)
  const end = Date.parse(`${to}T00:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
  const days = Math.round((end - start) / 86400000)
  return days > 0 ? days : 1
}

/** 累计变化量 = 读数 − 初值 */
export function cumulativeOf(reading: number, initialValue: number): number {
  return round(reading - initialValue, 3)
}

/** 日速率 = 与上一次观测的差值绝对值 ÷ 间隔天数 */
export function dailyRateOf(current: number, previous: number, days: number): number {
  const span = days > 0 ? days : 1
  return round(Math.abs(current - previous) / span, 4)
}

/** 累计变化量与阈值的比值 */
export function ratioOf(cumulative: number, threshold: number): number {
  if (!Number.isFinite(threshold) || threshold <= 0) return 0
  return round(Math.abs(cumulative) / threshold, 4)
}

/** 是否越限（比值 ≥ 蓝级下限即视为进入预警区间） */
export function isExceeded(cumulative: number, threshold: number): boolean {
  return ratioOf(cumulative, threshold) >= ALARM_RATIO['蓝']
}

/**
 * 由测点类型、阈值与观测值推导蓝/黄/橙/红级别
 * 比值 < 0.70 返回 null（正常）
 */
export function alarmLevelOf(cumulative: number, threshold: number): AlarmLevel | null {
  const ratio = ratioOf(cumulative, threshold)
  if (ratio >= ALARM_RATIO['红']) return '红'
  if (ratio >= ALARM_RATIO['橙']) return '橙'
  if (ratio >= ALARM_RATIO['黄']) return '黄'
  if (ratio >= ALARM_RATIO['蓝']) return '蓝'
  return null
}

/** 预警级别排序权重（红最高） */
export function alarmWeight(level: AlarmLevel): number {
  if (level === '红') return 40
  if (level === '橙') return 30
  if (level === '黄') return 20
  return 10
}

/** 蓝色及以上按类型加权：测斜与浸润线敏感度更高 */
export function severityScore(level: AlarmLevel | null, type: string): number {
  if (level === null) return 0
  const typeWeight = type === '测斜' || type === '浸润线' ? 1.2 : 1
  return round(alarmWeight(level) * typeWeight, 1)
}

/** 把某测点的观测记录整理为趋势取点 */
export function buildTrendPoints(observations: Observation[]): TrendPoint[] {
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((row, index) => ({
    seq: index + 1,
    date: row.date,
    reading: row.reading,
    cumulative: row.cumulative,
    dailyRate: row.dailyRate
  }))
}

/** 毫米 → 米 */
export function mmToM(value: number): number {
  return round(value / 1000, 4)
}

/** 米 → 毫米 */
export function mToMm(value: number): number {
  return round(value * 1000, 2)
}

/** 千帕 → 米水柱（近似 1 kPa ≈ 0.102 m） */
export function kpaToMeter(value: number): number {
  return round(value * 0.10197, 3)
}

/** 米水柱 → 千帕 */
export function meterToKpa(value: number): number {
  return round(value / 0.10197, 3)
}

export function formatReading(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  const digits = unit === 'kPa' || unit === 'mm' ? 2 : 3
  return `${value.toFixed(digits)} ${unit}`
}

export function formatRate(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(4)} ${unit}/d`
}

export function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

/** 预警草稿的判定依据文案 */
export function alarmBasis(point: { code: string; type: string; threshold: number; unit: string }, cumulative: number, level: AlarmLevel): string {
  const ratio = ratioOf(cumulative, point.threshold)
  return `${point.code}（${point.type}）累计变化 ${cumulative.toFixed(3)} ${point.unit}，达阈值 ${point.threshold} ${point.unit} 的 ${formatRatio(ratio)}，判定为${level}色预警`
}

/**
 * 测点最新观测：预警单始终按该测点的最新一条观测调整，
 * 而不是按预警单触发日期对应的历史观测。
 */
export interface LatestObservationLike {
  date: string
  cumulative: number
}

/** 单张未闭环预警按最新配置 / 最新观测调整后的结果 */
export interface AlarmReconciliation {
  alarm: Alarm
  /** null 表示最新观测已恢复正常，应关闭原单；否则为调整后的级别 */
  level: AlarmLevel | null
  /** 最新累计变化量（同时回写为触发值） */
  triggerValue: number
  triggerDate: string
}

/** 一批测点调整结果的汇总，供页面给出反馈文案 */
export interface AlarmReconcileSummary {
  /** 升级（漏掉的更高级别被补上）/ 降级 / 关闭的原单数量 */
  upgraded: number
  downgraded: number
  closed: number
}

/**
 * 未闭环预警统一按最新测点配置与最新观测调整原单：
 * - 最新观测恢复正常（低于蓝级下限）→ 关闭原单，不另开新单；
 * - 仍越限但级别变化 → 原地调整级别、触发值与触发日期；
 * - 测点或观测已不存在 → 无法继续跟踪，关闭原单；
 * - 已闭环预警单不在此处理，保留原样（历史处置记录）。
 * 同一测点的每张未闭环单都按最新观测独立调整，不新建任何单据。
 */
export function reconcileOpenAlarms(
  openAlarms: Alarm[],
  points: Point[],
  latestByPoint: ReadonlyMap<string, LatestObservationLike>
): { items: AlarmReconciliation[]; summary: AlarmReconcileSummary } {
  const pointOf = new Map(points.map((point) => [point.id, point]))
  const items: AlarmReconciliation[] = []
  let upgraded = 0
  let downgraded = 0
  let closed = 0

  openAlarms
    .filter((alarm) => isOpenAlarmState(alarm.state))
    .forEach((alarm) => {
      const point = pointOf.get(alarm.pointId)
      const latest = latestByPoint.get(alarm.pointId)
      if (!point || !latest) {
        // 测点 / 观测已不存在，原单无法继续跟踪，直接关闭
        items.push({ alarm, level: null, triggerValue: alarm.triggerValue, triggerDate: alarm.triggerDate })
        closed += 1
        return
      }
      const level = alarmLevelOf(latest.cumulative, point.threshold)
      items.push({
        alarm,
        level,
        triggerValue: latest.cumulative,
        triggerDate: latest.date
      })
      if (level === null) {
        closed += 1
      } else if (alarmWeight(level) > alarmWeight(alarm.level)) {
        upgraded += 1
      } else if (level !== alarm.level) {
        downgraded += 1
      }
    })

  return { items, summary: { upgraded, downgraded, closed } }
}

/** 预警单是否为未闭环（待处置 / 处置中） */
export function isOpenAlarmState(state: AlarmState): boolean {
  return state !== '已闭环'
}

/** 配置重算与预警联动结果的页面反馈文案 */
export function describeSyncSummary(summary: {
  alarmUpgraded: number
  alarmDowngraded: number
  alarmClosed: number
}): string {
  const parts: string[] = []
  if (summary.alarmUpgraded > 0) parts.push(`${summary.alarmUpgraded} 张未闭环单升级到最新级别`)
  if (summary.alarmDowngraded > 0) parts.push(`${summary.alarmDowngraded} 张未闭环单降级`)
  if (summary.alarmClosed > 0) parts.push(`${summary.alarmClosed} 张已恢复正常并自动闭环`)
  return parts.length > 0 ? parts.join('，') : '未闭环预警无需调整'
}
