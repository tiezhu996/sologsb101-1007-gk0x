/**
 * 坝体与断面状态（Zustand）
 * 维护坝体/断面列表、当前选中坝体与坝型/等别筛选。
 * 数据通过模块级 liveQuery 订阅 Dexie，写入后自动回流。
 */
import { create } from 'zustand'
import { liveQuery } from 'dexie'
import {
  createId,
  db,
  deleteDamCascade,
  deleteSectionCascade,
  readUiPrefs,
  writeUiPrefs,
  type DamRow,
  type SectionRow
} from '@/utils/db'
import type { Dam, DamDraft, DamGrade, DamType } from '@/types/dam'
import type { Section, SectionDraft } from '@/types/section'

export interface DamFilterState {
  keyword: string
  damTypes: DamType[]
  grades: DamGrade[]
}

export function createEmptyDamFilter(): DamFilterState {
  return { keyword: '', damTypes: [], grades: [] }
}

interface DamState {
  dams: Dam[]
  sections: Section[]
  currentDamId: string | null
  filter: DamFilterState
  ready: boolean
  selectDam: (id: string | null) => void
  patchFilter: (patch: Partial<DamFilterState>) => void
  resetFilter: () => void
  createDam: (draft: DamDraft) => Promise<Dam>
  updateDam: (id: string, patch: Partial<DamDraft>) => Promise<void>
  removeDam: (id: string) => Promise<void>
  createSection: (draft: SectionDraft) => Promise<Section>
  updateSection: (id: string, patch: Partial<SectionDraft>) => Promise<void>
  removeSection: (id: string) => Promise<void>
  sectionsOfDam: (damId: string) => Section[]
  filteredDams: () => Dam[]
  currentDam: () => Dam | null
}

export const useDamStore = create<DamState>((set, get) => ({
  dams: [],
  sections: [],
  currentDamId: readUiPrefs().lastDamId,
  filter: createEmptyDamFilter(),
  ready: false,

  selectDam(id) {
    set({ currentDamId: id })
    writeUiPrefs({ ...readUiPrefs(), lastDamId: id })
  },

  patchFilter(patch) {
    set({ filter: { ...get().filter, ...patch } })
  },

  resetFilter() {
    set({ filter: createEmptyDamFilter() })
  },

  async createDam(draft) {
    const now = Date.now()
    const row: DamRow = {
      id: createId('dam'),
      name: draft.name.trim(),
      damType: draft.damType,
      finalHeightM: Number(draft.finalHeightM) || 0,
      grade: draft.grade,
      commissionDate: draft.commissionDate,
      createdAt: now,
      updatedAt: now
    }
    await db.dams.put(row)
    get().selectDam(row.id)
    return row
  },

  async updateDam(id, patch) {
    const next: Partial<DamRow> = { ...patch, updatedAt: Date.now() }
    if (patch.name !== undefined) next.name = patch.name.trim()
    await db.dams.update(id, next)
  },

  async removeDam(id) {
    await deleteDamCascade(id)
    if (get().currentDamId === id) {
      const fallback = get().dams.find((dam) => dam.id !== id) ?? null
      get().selectDam(fallback ? fallback.id : null)
    }
  },

  async createSection(draft) {
    const now = Date.now()
    const row: SectionRow = {
      id: createId('sec'),
      damId: draft.damId || get().currentDamId || '',
      stakeNo: draft.stakeNo.trim(),
      slopeRatio: Number(draft.slopeRatio) || 0,
      elevationM: Number(draft.elevationM) || 0,
      createdAt: now,
      updatedAt: now
    }
    await db.sections.put(row)
    return row
  },

  async updateSection(id, patch) {
    const next: Partial<SectionRow> = { ...patch, updatedAt: Date.now() }
    if (patch.stakeNo !== undefined) next.stakeNo = patch.stakeNo.trim()
    await db.sections.update(id, next)
  },

  async removeSection(id) {
    await deleteSectionCascade(id)
  },

  sectionsOfDam(damId) {
    return get()
      .sections.filter((section) => section.damId === damId)
      .sort((a, b) => a.stakeNo.localeCompare(b.stakeNo, 'zh-Hans-CN'))
  },

  filteredDams() {
    const { dams, filter } = get()
    const text = filter.keyword.trim().toLowerCase()
    return dams.filter((dam) => {
      if (filter.damTypes.length > 0 && !filter.damTypes.includes(dam.damType)) return false
      if (filter.grades.length > 0 && !filter.grades.includes(dam.grade)) return false
      if (text.length === 0) return true
      return dam.name.toLowerCase().includes(text) || dam.damType.toLowerCase().includes(text)
    })
  },

  currentDam() {
    return get().dams.find((dam) => dam.id === get().currentDamId) ?? null
  }
}))

// 全局订阅：坝体与断面数据变化时回流到 store（首屏播种后同样生效）
liveQuery(async () => (await db.dams.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))).subscribe({
  next: (rows) => useDamStore.setState({ dams: rows, ready: true }),
  error: () => useDamStore.setState({ ready: true })
})

liveQuery(async () => (await db.sections.toArray()).sort((a, b) => a.stakeNo.localeCompare(b.stakeNo, 'zh-Hans-CN'))).subscribe({
  next: (rows) => useDamStore.setState({ sections: rows })
})
