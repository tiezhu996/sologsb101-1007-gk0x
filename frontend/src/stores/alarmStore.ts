/**
 * 预警状态（Zustand）
 * 维护预警级别排序、处置进度与闭环统计，以及预警单状态机。
 */
import { create } from 'zustand'
import { liveQuery } from 'dexie'
import { createId, db, type AlarmRow } from '@/utils/db'
import {
  ALARM_LEVEL_WEIGHT,
  type Alarm,
  type AlarmDraft,
  type AlarmLevel,
  type AlarmState
} from '@/types/alarm'

interface AlarmState_ {
  alarms: Alarm[]
  stateFilter: AlarmState[]
  onlyOpen: boolean
  ready: boolean
  patchFilter: (patch: { stateFilter?: AlarmState[]; onlyOpen?: boolean }) => void
  resetFilter: () => void
  createAlarm: (draft: AlarmDraft) => Promise<Alarm>
  updateAlarm: (id: string, patch: Partial<AlarmDraft>) => Promise<void>
  removeAlarm: (id: string) => Promise<void>
  advance: (id: string) => Promise<AlarmState | null>
  closeAlarm: (id: string, handler: string, measure: string) => Promise<void>
  counts: () => Record<AlarmState, number>
  levelCounts: () => Record<AlarmLevel, number>
  closedPercent: () => number
  sortedAlarms: () => Alarm[]
}

export const useAlarmStore = create<AlarmState_>((set, get) => ({
  alarms: [],
  stateFilter: [],
  onlyOpen: false,
  ready: false,

  patchFilter(patch) {
    set({
      stateFilter: patch.stateFilter ?? get().stateFilter,
      onlyOpen: patch.onlyOpen ?? get().onlyOpen
    })
  },

  resetFilter() {
    set({ stateFilter: [], onlyOpen: false })
  },

  async createAlarm(draft) {
    const point = await db.points.get(draft.pointId)
    const now = Date.now()
    const row: AlarmRow = {
      id: createId('al'),
      pointId: draft.pointId,
      damId: point ? point.damId : '',
      level: draft.level,
      triggerValue: Number(draft.triggerValue) || 0,
      triggerDate: draft.triggerDate,
      state: draft.state,
      handler: draft.handler.trim(),
      measure: draft.measure.trim(),
      createdAt: now,
      updatedAt: now
    }
    await db.alarms.put(row)
    return row
  },

  async updateAlarm(id, patch) {
    const next: Partial<AlarmRow> = { ...patch, updatedAt: Date.now() }
    if (patch.handler !== undefined) next.handler = patch.handler.trim()
    if (patch.measure !== undefined) next.measure = patch.measure.trim()
    await db.alarms.update(id, next)
  },

  async removeAlarm(id) {
    await db.alarms.delete(id)
  },

  async advance(id) {
    const alarm = get().alarms.find((item) => item.id === id)
    if (!alarm) return null
    const next: AlarmState | null = alarm.state === '待处置' ? '处置中' : alarm.state === '处置中' ? '已闭环' : null
    if (!next) return null
    await db.alarms.update(id, { state: next, updatedAt: Date.now() })
    return next
  },

  async closeAlarm(id, handler, measure) {
    await db.alarms.update(id, {
      state: '已闭环',
      handler: handler.trim() || '未署名',
      measure: measure.trim() || '处置完成，复测无异常',
      updatedAt: Date.now()
    })
  },

  counts() {
    const counts: Record<AlarmState, number> = { 待处置: 0, 处置中: 0, 已闭环: 0 }
    get().alarms.forEach((alarm) => {
      counts[alarm.state] += 1
    })
    return counts
  },

  levelCounts() {
    const counts: Record<AlarmLevel, number> = { 蓝: 0, 黄: 0, 橙: 0, 红: 0 }
    get().alarms.forEach((alarm) => {
      counts[alarm.level] += 1
    })
    return counts
  },

  closedPercent() {
    const { alarms } = get()
    if (alarms.length === 0) return 0
    const closed = alarms.filter((alarm) => alarm.state === '已闭环').length
    return Math.round((closed / alarms.length) * 100)
  },

  sortedAlarms() {
    return [...get().alarms].sort((a, b) => {
      const levelDiff = ALARM_LEVEL_WEIGHT[b.level] - ALARM_LEVEL_WEIGHT[a.level]
      if (levelDiff !== 0) return levelDiff
      return b.triggerDate.localeCompare(a.triggerDate)
    })
  }
}))

liveQuery(async () =>
  (await db.alarms.toArray()).sort((a, b) => {
    const levelDiff = ALARM_LEVEL_WEIGHT[b.level] - ALARM_LEVEL_WEIGHT[a.level]
    if (levelDiff !== 0) return levelDiff
    return b.triggerDate.localeCompare(a.triggerDate)
  })
).subscribe({
  next: (rows) => useAlarmStore.setState({ alarms: rows, ready: true }),
  error: () => useAlarmStore.setState({ ready: true })
})
