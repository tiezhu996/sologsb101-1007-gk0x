/** 观测：某测点某日的读数记录 */
export interface Observation {
  id: string
  pointId: string
  /** 观测日期 YYYY-MM-DD */
  date: string
  /** 读数 */
  reading: number
  /** 累计变化（读数 − 初值） */
  cumulative: number
  /** 日速率（与上一次观测的差值 ÷ 间隔天数） */
  dailyRate: number
  observer: string
  createdAt: number
  updatedAt: number
}

export interface ObservationDraft {
  pointId: string
  date: string
  reading: number
  observer: string
}

export const EMPTY_OBSERVATION_DRAFT: ObservationDraft = {
  pointId: '',
  date: '',
  reading: 0,
  observer: ''
}

/** 单测点观测序列取点 */
export interface TrendPoint {
  seq: number
  date: string
  reading: number
  cumulative: number
  dailyRate: number
}

/** 观测录入页的成组录入行 */
export interface ObservationBatchRow {
  pointId: string
  date: string
  reading: number
  observer: string
}
