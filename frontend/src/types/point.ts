/** 测点：断面上的表面位移 / 测斜 / 浸润线 / 渗压测点 */
export type PointType = '表面位移' | '测斜' | '浸润线' | '渗压'

export interface Point {
  id: string
  sectionId: string
  /** 冗余坝体 id，便于按坝体快速筛选与统计 */
  damId: string
  code: string
  type: PointType
  /** 初值（与读数同单位） */
  initialValue: number
  /** 阈值：允许的最大变化量绝对值 */
  threshold: number
  unit: string
  installDate: string
  createdAt: number
  updatedAt: number
}

export const POINT_TYPES: PointType[] = ['表面位移', '测斜', '浸润线', '渗压']

/** 各类测点的默认单位 */
export const POINT_UNIT: Record<PointType, string> = {
  表面位移: 'mm',
  测斜: 'mm',
  浸润线: 'm',
  渗压: 'kPa'
}

export interface PointDraft {
  sectionId: string
  code: string
  type: PointType
  initialValue: number
  threshold: number
  unit: string
  installDate: string
}

export const EMPTY_POINT_DRAFT: PointDraft = {
  sectionId: '',
  code: '',
  type: '表面位移',
  initialValue: 0,
  threshold: 25,
  unit: 'mm',
  installDate: ''
}

/** 阈值编辑草稿：测点 id → 待提交的初值与阈值 */
export interface ThresholdDraft {
  initialValue: number
  threshold: number
}

/** 测点列表筛选条件（存于 pointStore，与 URL query 同步） */
export interface PointFilterState {
  keyword: string
  damId: string
  types: PointType[]
  onlyExceeded: boolean
}

export function createEmptyPointFilter(): PointFilterState {
  return { keyword: '', damId: '', types: [], onlyExceeded: false }
}
