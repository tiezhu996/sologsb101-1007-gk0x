/** 坝体：尾矿库安全监测的管理单元 */
export type DamType = '上游式' | '中线式' | '下游式'
export type DamGrade = '一等' | '二等' | '三等' | '四等' | '五等'

export interface Dam {
  id: string
  name: string
  damType: DamType
  /** 最终坝高（m） */
  finalHeightM: number
  grade: DamGrade
  /** 投运日期 YYYY-MM-DD */
  commissionDate: string
  createdAt: number
  updatedAt: number
}

export const DAM_TYPES: DamType[] = ['上游式', '中线式', '下游式']
export const DAM_GRADES: DamGrade[] = ['一等', '二等', '三等', '四等', '五等']

export interface DamDraft {
  name: string
  damType: DamType
  finalHeightM: number
  grade: DamGrade
  commissionDate: string
}

export const EMPTY_DAM_DRAFT: DamDraft = {
  name: '',
  damType: '上游式',
  finalHeightM: 0,
  grade: '三等',
  commissionDate: ''
}

/** 坝体卡片回显用的聚合值 */
export interface DamStat {
  damId: string
  sectionCount: number
  pointCount: number
  openAlarmCount: number
}

export function formatHeight(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} m`
}
