/**
 * 导出工具：整库 JSON 存档、监测台账 CSV、结构版本导出
 */
import type { Dam } from '@/types/dam'
import type { Section } from '@/types/section'
import type { Point } from '@/types/point'
import type { Observation } from '@/types/observation'
import type { Alarm } from '@/types/alarm'
import type { Pool } from '@/types/pool'
import { checkPool, MIN_BEACH_LENGTH_M, MIN_FREEBOARD_M } from '@/types/pool'
import { ratioOf } from '@/utils/threshold'

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function stampSuffix(): string {
  const date = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function exportBackupJson(payload: unknown): string {
  const filename = `gbtaildam-backup-${stampSuffix()}.json`
  download(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
  return filename
}

export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 观测台账 CSV */
export function exportObservationCsv(
  dams: Dam[],
  sections: Section[],
  points: Point[],
  observations: Observation[]
): string {
  const header = [
    '坝体',
    '坝型',
    '等别',
    '桩号',
    '测点编号',
    '测点类型',
    '初值',
    '阈值',
    '单位',
    '观测日期',
    '读数',
    '累计变化',
    '日速率',
    '占阈值比(%)',
    '观测人'
  ]
  const lines: string[] = [header.map(csvCell).join(',')]
  observations.forEach((observation) => {
    const point = points.find((item) => item.id === observation.pointId)
    const section = point ? sections.find((item) => item.id === point.sectionId) : undefined
    const dam = section ? dams.find((item) => item.id === section.damId) : undefined
    lines.push(
      [
        dam ? dam.name : '—',
        dam ? dam.damType : '—',
        dam ? dam.grade : '—',
        section ? section.stakeNo : '—',
        point ? point.code : '—',
        point ? point.type : '—',
        point ? point.initialValue : '—',
        point ? point.threshold : '—',
        point ? point.unit : '—',
        observation.date,
        observation.reading,
        observation.cumulative,
        observation.dailyRate,
        point ? (ratioOf(observation.cumulative, point.threshold) * 100).toFixed(1) : '—',
        observation.observer
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `监测观测台账-${stampSuffix()}.csv`
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** 预警与闭环台账 CSV */
export function exportAlarmCsv(dams: Dam[], points: Point[], alarms: Alarm[]): string {
  const header = ['坝体', '测点编号', '测点类型', '级别', '触发值', '触发日期', '状态', '处置人', '处置措施']
  const lines: string[] = [header.map(csvCell).join(',')]
  alarms.forEach((alarm) => {
    const point = points.find((item) => item.id === alarm.pointId)
    const dam = dams.find((item) => item.id === alarm.damId)
    lines.push(
      [
        dam ? dam.name : '—',
        point ? point.code : '—',
        point ? point.type : '—',
        alarm.level,
        alarm.triggerValue,
        alarm.triggerDate,
        alarm.state,
        alarm.handler || '—',
        alarm.measure || '—'
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `预警闭环台账-${stampSuffix()}.csv`
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** 库水位与干滩 CSV（含达标校核） */
export function exportPoolCsv(dams: Dam[], pools: Pool[]): string {
  const header = ['坝体', '日期', '库水位(m)', '干滩长度(m)', '安全超高(m)', '校核结论']
  const lines: string[] = [header.map(csvCell).join(',')]
  pools.forEach((pool) => {
    const dam = dams.find((item) => item.id === pool.damId)
    lines.push(
      [
        dam ? dam.name : '—',
        pool.date,
        pool.waterLevelM,
        pool.beachLengthM,
        pool.freeboardM,
        checkPool(pool).text
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `库水位干滩记录-${stampSuffix()}.csv`
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

export const POOL_LIMITS = { MIN_BEACH_LENGTH_M, MIN_FREEBOARD_M }

/** 导出结构版本（表结构与行数摘要） */
export function exportStructureVersion(summary: {
  dbName: string
  dbVersion: number
  counts: Record<string, number>
  exportedAt: string
}): string {
  const filename = `gbtaildam-structure-${stampSuffix()}.json`
  download(filename, JSON.stringify(summary, null, 2), 'application/json;charset=utf-8')
  return filename
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  return false
}
