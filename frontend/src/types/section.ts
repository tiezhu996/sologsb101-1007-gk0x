/** 断面：坝体上的监测断面 */
export interface Section {
  id: string
  damId: string
  /** 桩号，如 0+120 */
  stakeNo: string
  /** 坡比，如 2.5 表示 1:2.5 */
  slopeRatio: number
  /** 坝顶高程（m） */
  elevationM: number
  createdAt: number
  updatedAt: number
}

export interface SectionDraft {
  damId: string
  stakeNo: string
  slopeRatio: number
  elevationM: number
}

export const EMPTY_SECTION_DRAFT: SectionDraft = {
  damId: '',
  stakeNo: '',
  slopeRatio: 2.5,
  elevationM: 0
}

export function formatStakeNo(stakeNo: string): string {
  return stakeNo.trim().length > 0 ? `桩号 ${stakeNo}` : '桩号未填'
}

export function formatSlope(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '坡比 —'
  return `1:${ratio.toFixed(2)}`
}
