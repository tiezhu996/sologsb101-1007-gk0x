/**
 * 测点状态（Zustand）
 * 维护测点集合、阈值编辑草稿与类型筛选，并提供批量布点。
 */
import { create } from 'zustand'
import { liveQuery } from 'dexie'
import { createId, db, deletePointCascade, type PointRow } from '@/utils/db'
import {
  createEmptyPointFilter,
  POINT_UNIT,
  type Point,
  type PointDraft,
  type PointFilterState,
  type PointType,
  type ThresholdDraft
} from '@/types/point'

interface PointState {
  points: Point[]
  filter: PointFilterState
  /** 阈值编辑草稿：测点 id → 待提交的初值与阈值 */
  thresholdDraft: Record<string, ThresholdDraft>
  selectedIds: string[]
  ready: boolean
  patchFilter: (patch: Partial<PointFilterState>) => void
  resetFilter: () => void
  createPoint: (draft: PointDraft) => Promise<Point>
  updatePoint: (id: string, patch: Partial<PointDraft>) => Promise<void>
  removePoint: (id: string) => Promise<void>
  bulkCreatePoints: (sectionId: string, drafts: PointDraft[]) => Promise<number>
  setThresholdDraft: (pointId: string, draft: ThresholdDraft) => void
  clearThresholdDraft: (pointId?: string) => void
  commitThresholdDraft: (pointId: string) => Promise<void>
  commitAllThresholdDrafts: () => Promise<number>
  toggleSelect: (id: string, checked: boolean) => void
  setSelectedIds: (ids: string[]) => void
  clearSelection: () => void
  pointsOfSection: (sectionId: string) => Point[]
  unitOf: (type: PointType) => string
}

export const usePointStore = create<PointState>((set, get) => ({
  points: [],
  filter: createEmptyPointFilter(),
  thresholdDraft: {},
  selectedIds: [],
  ready: false,

  patchFilter(patch) {
    set({ filter: { ...get().filter, ...patch } })
  },

  resetFilter() {
    set({ filter: createEmptyPointFilter() })
  },

  async createPoint(draft) {
    const now = Date.now()
    const section = await db.sections.get(draft.sectionId)
    const row: PointRow = {
      id: createId('pt'),
      sectionId: draft.sectionId,
      damId: section ? section.damId : '',
      code: draft.code.trim() || `PT-${Date.now().toString().slice(-5)}`,
      type: draft.type,
      initialValue: Number(draft.initialValue) || 0,
      threshold: Number(draft.threshold) || 1,
      unit: draft.unit || POINT_UNIT[draft.type],
      installDate: draft.installDate,
      createdAt: now,
      updatedAt: now
    }
    await db.points.put(row)
    return row
  },

  async updatePoint(id, patch) {
    const next: Partial<PointRow> = { ...patch, updatedAt: Date.now() }
    if (patch.code !== undefined) next.code = patch.code.trim()
    if (patch.sectionId !== undefined) {
      const section = await db.sections.get(patch.sectionId)
      if (section) next.damId = section.damId
    }
    await db.points.update(id, next)
  },

  async removePoint(id) {
    await deletePointCascade(id)
    get().clearThresholdDraft(id)
    set({ selectedIds: get().selectedIds.filter((item) => item !== id) })
  },

  async bulkCreatePoints(sectionId, drafts) {
    const section = await db.sections.get(sectionId)
    const damId = section ? section.damId : ''
    const now = Date.now()
    const rows: PointRow[] = drafts.map((draft, index) => ({
      id: createId('pt'),
      sectionId,
      damId,
      code: draft.code.trim() || `PT-${now.toString().slice(-5)}-${index + 1}`,
      type: draft.type,
      initialValue: Number(draft.initialValue) || 0,
      threshold: Number(draft.threshold) || 1,
      unit: draft.unit || POINT_UNIT[draft.type],
      installDate: draft.installDate,
      createdAt: now,
      updatedAt: now
    }))
    if (rows.length > 0) await db.points.bulkPut(rows)
    return rows.length
  },

  setThresholdDraft(pointId, draft) {
    set({ thresholdDraft: { ...get().thresholdDraft, [pointId]: draft } })
  },

  clearThresholdDraft(pointId) {
    if (pointId === undefined) {
      set({ thresholdDraft: {} })
      return
    }
    const next = { ...get().thresholdDraft }
    delete next[pointId]
    set({ thresholdDraft: next })
  },

  async commitThresholdDraft(pointId) {
    const draft = get().thresholdDraft[pointId]
    if (!draft) return
    await db.points.update(pointId, {
      initialValue: draft.initialValue,
      threshold: draft.threshold > 0 ? draft.threshold : 1,
      updatedAt: Date.now()
    })
    get().clearThresholdDraft(pointId)
  },

  async commitAllThresholdDrafts() {
    const entries = Object.entries(get().thresholdDraft)
    if (entries.length === 0) return 0
    const rows = get()
      .points.filter((point) => entries.some(([id]) => id === point.id))
      .map((point) => {
        const draft = get().thresholdDraft[point.id]
        return {
          ...point,
          initialValue: draft.initialValue,
          threshold: draft.threshold > 0 ? draft.threshold : 1,
          updatedAt: Date.now()
        }
      })
    if (rows.length > 0) await db.points.bulkPut(rows)
    get().clearThresholdDraft()
    return rows.length
  },

  toggleSelect(id, checked) {
    const current = get().selectedIds
    set({ selectedIds: checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id) })
  },

  setSelectedIds(ids) {
    set({ selectedIds: [...ids] })
  },

  clearSelection() {
    set({ selectedIds: [] })
  },

  pointsOfSection(sectionId) {
    return get().points.filter((point) => point.sectionId === sectionId)
  },

  unitOf(type) {
    return POINT_UNIT[type]
  }
}))

liveQuery(async () => (await db.points.toArray()).sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))).subscribe({
  next: (rows) => usePointStore.setState({ points: rows, ready: true }),
  error: () => usePointStore.setState({ ready: true })
})
