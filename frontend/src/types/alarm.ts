/** 预警：观测值越限生成的预警单 */
export type AlarmLevel = '蓝' | '黄' | '橙' | '红'
export type AlarmState = '待处置' | '处置中' | '已闭环'

export interface Alarm {
  id: string
  pointId: string
  /** 冗余坝体 id，便于按坝体筛选 */
  damId: string
  level: AlarmLevel
  /** 触发值（累计变化量） */
  triggerValue: number
  triggerDate: string
  state: AlarmState
  /** 处置人 */
  handler: string
  /** 处置措施 */
  measure: string
  createdAt: number
  updatedAt: number
}

export const ALARM_LEVELS: AlarmLevel[] = ['蓝', '黄', '橙', '红']
export const ALARM_STATES: AlarmState[] = ['待处置', '处置中', '已闭环']

/** 预警状态机：待处置 → 处置中 → 已闭环 */
export const ALARM_STATE_FLOW: Record<AlarmState, AlarmState | null> = {
  待处置: '处置中',
  处置中: '已闭环',
  已闭环: null
}

export const ALARM_LEVEL_WEIGHT: Record<AlarmLevel, number> = { 红: 40, 橙: 30, 黄: 20, 蓝: 10 }

export interface AlarmDraft {
  pointId: string
  level: AlarmLevel
  triggerValue: number
  triggerDate: string
  state: AlarmState
  handler: string
  measure: string
}

export const EMPTY_ALARM_DRAFT: AlarmDraft = {
  pointId: '',
  level: '蓝',
  triggerValue: 0,
  triggerDate: '',
  state: '待处置',
  handler: '',
  measure: ''
}

export function createEmptyAlarmDraft(): AlarmDraft {
  return { ...EMPTY_ALARM_DRAFT }
}
