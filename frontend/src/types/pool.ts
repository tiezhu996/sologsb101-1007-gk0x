/** 库水位：与位移观测同日登记的库水位、干滩长度与安全超高 */
export interface Pool {
  id: string
  damId: string
  date: string
  /** 库水位（m） */
  waterLevelM: number
  /** 干滩长度（m） */
  beachLengthM: number
  /** 安全超高（m） */
  freeboardM: number
  createdAt: number
  updatedAt: number
}

/** 干滩长度达标下限（m），简化按等别统一取值 */
export const MIN_BEACH_LENGTH_M = 100
/** 安全超高达标下限（m） */
export const MIN_FREEBOARD_M = 1.5

export interface PoolDraft {
  damId: string
  date: string
  waterLevelM: number
  beachLengthM: number
  freeboardM: number
}

export const EMPTY_POOL_DRAFT: PoolDraft = {
  damId: '',
  date: '',
  waterLevelM: 0,
  beachLengthM: 0,
  freeboardM: 0
}

export interface PoolCheck {
  beachOk: boolean
  freeboardOk: boolean
  text: string
}

/** 校核干滩长度与安全超高是否达标 */
export function checkPool(pool: Pick<Pool, 'beachLengthM' | 'freeboardM'>): PoolCheck {
  const beachOk = pool.beachLengthM >= MIN_BEACH_LENGTH_M
  const freeboardOk = pool.freeboardM >= MIN_FREEBOARD_M
  if (beachOk && freeboardOk) return { beachOk, freeboardOk, text: '干滩与超高均达标' }
  if (!beachOk && !freeboardOk) return { beachOk, freeboardOk, text: '干滩不足且超高不够' }
  return { beachOk, freeboardOk, text: beachOk ? '安全超高不足' : '干滩长度不足' }
}
