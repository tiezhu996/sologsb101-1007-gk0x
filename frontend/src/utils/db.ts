/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据结构版本号 + upgrade 迁移
 * - 级联删除、整库导入导出、首屏幂等播种
 */
import Dexie, { type Table } from 'dexie'
import type { Dam } from '@/types/dam'
import type { Section } from '@/types/section'
import type { Point } from '@/types/point'
import type { Observation } from '@/types/observation'
import type { Alarm } from '@/types/alarm'
import type { Pool } from '@/types/pool'
import {
  cumulativeOf,
  dailyRateOf,
  daysBetween,
  isOpenAlarmState,
  reconcileOpenAlarms,
  type LatestObservationLike
} from '@/utils/threshold'

export const DB_NAME = 'gbtaildam'
export const DB_VERSION = 3

export const LS_KEYS = {
  dbVersion: 'gbtaildam:db-version',
  lastBackupAt: 'gbtaildam:last-backup-at',
  uiPrefs: 'gbtaildam:ui-prefs'
} as const

export interface UiPrefs {
  lastDamId: string | null
  alarmOnlyOpen: boolean
}

export const DEFAULT_UI_PREFS: UiPrefs = { lastDamId: null, alarmOnlyOpen: false }

export interface BackupPayload {
  app: 'gbtaildam'
  dbVersion: number
  exportedAt: string
  dams: Dam[]
  sections: Section[]
  points: Point[]
  observations: Observation[]
  alarms: Alarm[]
  pools: Pool[]
}

export interface Revisioned {
  revision?: number
}

export const ROW_REVISION = 2

export type DamRow = Dam & Revisioned
export type SectionRow = Section & Revisioned
export type PointRow = Point & Revisioned
export type ObservationRow = Observation & Revisioned
export type AlarmRow = Alarm & Revisioned
export type PoolRow = Pool & Revisioned

class TailDamDatabase extends Dexie {
  dams!: Table<DamRow, string>
  sections!: Table<SectionRow, string>
  points!: Table<PointRow, string>
  observations!: Table<ObservationRow, string>
  alarms!: Table<AlarmRow, string>
  pools!: Table<PoolRow, string>

  constructor() {
    super(DB_NAME)

    this.version(1).stores({
      dams: 'id, name, damType, grade',
      sections: 'id, damId, stakeNo',
      points: 'id, sectionId, code, type',
      observations: 'id, pointId, date',
      alarms: 'id, pointId, level, state',
      pools: 'id, damId, date'
    })

    // v2：测点/预警补 damId 冗余列（按坝体筛选免联表）；全部表补 revision 行修订号
    this.version(DB_VERSION)
      .stores({
        dams: 'id, name, damType, grade, updatedAt',
        sections: 'id, damId, stakeNo, updatedAt',
        points: 'id, sectionId, damId, code, type, updatedAt',
        observations: 'id, pointId, date, observer, updatedAt',
        alarms: 'id, pointId, damId, level, state, updatedAt',
        pools: 'id, damId, date, updatedAt'
      })
      .upgrade(async (tx) => {
        // 迁移 1：为全部业务行补齐 revision
        for (const name of ['dams', 'sections', 'points', 'observations', 'alarms', 'pools']) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              row.revision = ROW_REVISION
            })
        }

        // 迁移 2：测点缺少 damId 时用所属断面回填
        const sections = (await tx.table('sections').toArray()) as Array<{ id: string; damId: string }>
        const damOfSection = new Map(sections.map((section) => [section.id, section.damId]))
        await tx
          .table('points')
          .toCollection()
          .modify((point: Record<string, unknown>) => {
            if (typeof point.damId !== 'string' || point.damId.length === 0) {
              point.damId = damOfSection.get(String(point.sectionId)) ?? ''
            }
            if (typeof point.threshold !== 'number' || !Number.isFinite(point.threshold)) {
              point.threshold = 25
            }
          })

        // 迁移 3：预警缺少 damId 时用测点回填；补齐 handler / measure 字段
        const points = (await tx.table('points').toArray()) as Array<{ id: string; damId: string }>
        const damOfPoint = new Map(points.map((point) => [point.id, point.damId]))
        await tx
          .table('alarms')
          .toCollection()
          .modify((alarm: Record<string, unknown>) => {
            if (typeof alarm.damId !== 'string' || alarm.damId.length === 0) {
              alarm.damId = damOfPoint.get(String(alarm.pointId)) ?? ''
            }
            if (typeof alarm.handler !== 'string') alarm.handler = ''
            if (typeof alarm.measure !== 'string') alarm.measure = ''
          })
      })

    // v3：历史观测统一按最新测点配置重算累计变化与日速率；
    // 未闭环预警按最新观测调整原单（恢复正常关闭、级别变化升降级），已闭环单保留原样。
    // 索引无变化，仅升级数据口径。
    this.version(DB_VERSION)
      .stores({
        dams: 'id, name, damType, grade, updatedAt',
        sections: 'id, damId, stakeNo, updatedAt',
        points: 'id, sectionId, damId, code, type, updatedAt',
        observations: 'id, pointId, date, observer, updatedAt',
        alarms: 'id, pointId, damId, level, state, updatedAt',
        pools: 'id, damId, date, updatedAt'
      })
      .upgrade(async (tx) => {
        const pointRows = (await tx.table('points').toArray()) as PointRow[]
        const observationRows = (await tx.table('observations').toArray()) as ObservationRow[]
        const alarmRows = (await tx.table('alarms').toArray()) as AlarmRow[]
        const now = Date.now()

        // 1. 按测点分组重算全部观测
        const observationsByPoint = new Map<string, ObservationRow[]>()
        observationRows.forEach((row) => {
          const list = observationsByPoint.get(row.pointId) ?? []
          list.push(row)
          observationsByPoint.set(row.pointId, list)
        })
        const nextObservations: ObservationRow[] = []
        const latestByPoint = new Map<string, LatestObservationLike>()
        pointRows.forEach((point) => {
          const rows = (observationsByPoint.get(point.id) ?? []).sort((a, b) => a.date.localeCompare(b.date))
          rows.forEach((row, index) => {
            const previous = index === 0 ? null : rows[index - 1]
            nextObservations.push({
              ...row,
              cumulative: cumulativeOf(row.reading, point.initialValue),
              dailyRate: previous
                ? dailyRateOf(row.reading, previous.reading, daysBetween(previous.date, row.date))
                : 0,
              updatedAt: now
            })
          })
          const latest = rows[rows.length - 1]
          if (latest) {
            latestByPoint.set(point.id, {
              date: latest.date,
              cumulative: cumulativeOf(latest.reading, point.initialValue)
            })
          }
        })

        // 2. 未闭环预警按最新观测调整原单
        const openAlarms = alarmRows.filter((alarm) => isOpenAlarmState(alarm.state))
        const { items } = reconcileOpenAlarms(openAlarms, pointRows, latestByPoint)
        const nextAlarms = items.map((item) => {
          if (item.level === null) {
            return {
              ...item.alarm,
              state: '已闭环' as const,
              handler: item.alarm.handler || '系统自动',
              measure: item.alarm.measure || AUTO_CLOSE_MEASURE,
              updatedAt: now
            }
          }
          return {
            ...item.alarm,
            level: item.level,
            triggerValue: item.triggerValue,
            triggerDate: item.triggerDate,
            updatedAt: now
          }
        })

        if (nextObservations.length > 0) await tx.table('observations').bulkPut(nextObservations)
        if (nextAlarms.length > 0) await tx.table('alarms').bulkPut(nextAlarms)
      })
  }
}

export const db = new TailDamDatabase()

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

/* ============================ 演示数据播种 ============================ */

const SEED_STAMP = Date.parse('2024-06-12T09:00:00+08:00')
const stamp = (offsetDays = 0): number => SEED_STAMP + offsetDays * 86400000

const SEED_DAMS: DamRow[] = [
  { id: 'dam-1', name: '尾矿库 A 坝', damType: '上游式', finalHeightM: 68, grade: '三等', commissionDate: '2012-06-30', createdAt: stamp(-400), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'dam-2', name: '尾矿库 B 坝', damType: '中线式', finalHeightM: 45, grade: '四等', commissionDate: '2018-09-15', createdAt: stamp(-360), updatedAt: stamp(-1), revision: ROW_REVISION }
]

const SEED_SECTIONS: SectionRow[] = [
  { id: 'sec-1', damId: 'dam-1', stakeNo: '0+120', slopeRatio: 2.5, elevationM: 712.5, createdAt: stamp(-390), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'sec-2', damId: 'dam-1', stakeNo: '0+260', slopeRatio: 2.8, elevationM: 713.2, createdAt: stamp(-389), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'sec-3', damId: 'dam-2', stakeNo: '0+080', slopeRatio: 2.2, elevationM: 645.0, createdAt: stamp(-350), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'sec-4', damId: 'dam-2', stakeNo: '0+180', slopeRatio: 2.4, elevationM: 645.6, createdAt: stamp(-349), updatedAt: stamp(-1), revision: ROW_REVISION }
]

const SEED_POINTS: PointRow[] = [
  { id: 'pt-1', sectionId: 'sec-1', damId: 'dam-1', code: 'DB-01', type: '表面位移', initialValue: 0, threshold: 25, unit: 'mm', installDate: '2021-03-18', createdAt: stamp(-380), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'pt-2', sectionId: 'sec-1', damId: 'dam-1', code: 'CX-01', type: '测斜', initialValue: 0, threshold: 30, unit: 'mm', installDate: '2021-03-18', createdAt: stamp(-380), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'pt-3', sectionId: 'sec-1', damId: 'dam-1', code: 'JR-01', type: '浸润线', initialValue: 12.6, threshold: 2, unit: 'm', installDate: '2021-04-02', createdAt: stamp(-379), updatedAt: stamp(-3), revision: ROW_REVISION },
  { id: 'pt-4', sectionId: 'sec-2', damId: 'dam-1', code: 'DB-02', type: '表面位移', initialValue: 0, threshold: 25, unit: 'mm', installDate: '2021-03-20', createdAt: stamp(-378), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'pt-5', sectionId: 'sec-2', damId: 'dam-1', code: 'SY-01', type: '渗压', initialValue: 45, threshold: 8, unit: 'kPa', installDate: '2021-04-06', createdAt: stamp(-377), updatedAt: stamp(-4), revision: ROW_REVISION },
  { id: 'pt-6', sectionId: 'sec-2', damId: 'dam-1', code: 'JR-02', type: '浸润线', initialValue: 13.1, threshold: 2, unit: 'm', installDate: '2021-04-06', createdAt: stamp(-377), updatedAt: stamp(-4), revision: ROW_REVISION },
  { id: 'pt-7', sectionId: 'sec-3', damId: 'dam-2', code: 'DB-03', type: '表面位移', initialValue: 0, threshold: 20, unit: 'mm', installDate: '2022-05-11', createdAt: stamp(-340), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'pt-8', sectionId: 'sec-3', damId: 'dam-2', code: 'CX-02', type: '测斜', initialValue: 0, threshold: 24, unit: 'mm', installDate: '2022-05-11', createdAt: stamp(-340), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'pt-9', sectionId: 'sec-4', damId: 'dam-2', code: 'SY-02', type: '渗压', initialValue: 38.5, threshold: 6, unit: 'kPa', installDate: '2022-05-18', createdAt: stamp(-339), updatedAt: stamp(-1), revision: ROW_REVISION }
]

/** 播种用的观测原始行：[测点, 日期, 读数, 观测人] */
const SEED_OBSERVATION_ROWS: Array<[string, string, number, string]> = [
  ['pt-1', '2024-04-10', 8.2, '刘振国'],
  ['pt-1', '2024-05-10', 15.4, '刘振国'],
  ['pt-1', '2024-06-09', 27.4, '陈文'],
  ['pt-2', '2024-04-10', 9.6, '刘振国'],
  ['pt-2', '2024-05-10', 16.2, '陈文'],
  ['pt-2', '2024-06-09', 27.9, '陈文'],
  ['pt-3', '2024-04-11', 12.8, '王丽'],
  ['pt-3', '2024-05-11', 13.4, '王丽'],
  ['pt-3', '2024-06-10', 14.9, '王丽'],
  ['pt-4', '2024-04-11', 5.4, '刘振国'],
  ['pt-4', '2024-06-10', 11.2, '刘振国'],
  ['pt-5', '2024-04-12', 46.8, '王丽'],
  ['pt-5', '2024-06-11', 51.6, '王丽'],
  ['pt-6', '2024-04-12', 13.3, '陈文'],
  ['pt-6', '2024-06-11', 13.9, '陈文'],
  ['pt-7', '2024-04-13', 6.8, '赵鹏'],
  ['pt-7', '2024-06-11', 14.2, '赵鹏'],
  ['pt-8', '2024-04-13', 7.5, '赵鹏'],
  ['pt-8', '2024-06-11', 18.4, '赵鹏'],
  ['pt-9', '2024-04-14', 39.6, '赵鹏'],
  ['pt-9', '2024-06-11', 44.2, '赵鹏']
]

const SEED_ALARMS: AlarmRow[] = [
  { id: 'al-1', pointId: 'pt-1', damId: 'dam-1', level: '橙', triggerValue: 27.4, triggerDate: '2024-06-09', state: '待处置', handler: '', measure: '', createdAt: stamp(-2), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'al-2', pointId: 'pt-3', damId: 'dam-1', level: '橙', triggerValue: 2.3, triggerDate: '2024-06-10', state: '处置中', handler: '王丽', measure: '加密浸润线观测至每周一次，同时降低库水位', createdAt: stamp(-2), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'al-3', pointId: 'pt-9', damId: 'dam-2', level: '黄', triggerValue: 5.7, triggerDate: '2024-06-11', state: '待处置', handler: '', measure: '', createdAt: stamp(-1), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'al-4', pointId: 'pt-2', damId: 'dam-1', level: '黄', triggerValue: 27.9, triggerDate: '2024-06-09', state: '已闭环', handler: '陈文', measure: '复核测斜孔，补充人工观测，位移稳定后闭环', createdAt: stamp(-2), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'al-5', pointId: 'pt-5', damId: 'dam-1', level: '蓝', triggerValue: 6.6, triggerDate: '2024-06-11', state: '已闭环', handler: '王丽', measure: '渗压计校核后复测，读数正常', createdAt: stamp(-1), updatedAt: stamp(-1), revision: ROW_REVISION },
  { id: 'al-6', pointId: 'pt-7', damId: 'dam-2', level: '蓝', triggerValue: 14.2, triggerDate: '2024-06-11', state: '待处置', handler: '', measure: '', createdAt: stamp(-1), updatedAt: stamp(-1), revision: ROW_REVISION }
]

const SEED_POOLS: PoolRow[] = [
  { id: 'pl-1', damId: 'dam-1', date: '2024-04-10', waterLevelM: 709.8, beachLengthM: 132, freeboardM: 2.7, createdAt: stamp(-63), updatedAt: stamp(-63), revision: ROW_REVISION },
  { id: 'pl-2', damId: 'dam-1', date: '2024-05-10', waterLevelM: 710.4, beachLengthM: 118, freeboardM: 2.1, createdAt: stamp(-33), updatedAt: stamp(-33), revision: ROW_REVISION },
  { id: 'pl-3', damId: 'dam-1', date: '2024-06-09', waterLevelM: 711.1, beachLengthM: 96, freeboardM: 1.4, createdAt: stamp(-2), updatedAt: stamp(-2), revision: ROW_REVISION },
  { id: 'pl-4', damId: 'dam-2', date: '2024-05-10', waterLevelM: 642.1, beachLengthM: 88, freeboardM: 2.9, createdAt: stamp(-33), updatedAt: stamp(-33), revision: ROW_REVISION },
  { id: 'pl-5', damId: 'dam-2', date: '2024-06-09', waterLevelM: 643.4, beachLengthM: 74, freeboardM: 1.8, createdAt: stamp(-2), updatedAt: stamp(-2), revision: ROW_REVISION }
]

/** 由原始行派生累计变化量与日速率 */
function buildSeedObservations(): ObservationRow[] {
  const previousByPoint = new Map<string, { date: string; reading: number }>()
  return SEED_OBSERVATION_ROWS.map(([pointId, date, reading, observer], index) => {
    const point = SEED_POINTS.find((item) => item.id === pointId)
    const initialValue = point ? point.initialValue : 0
    const previous = previousByPoint.get(pointId)
    const dailyRate = previous ? dailyRateOf(reading, previous.reading, daysBetween(previous.date, date)) : 0
    previousByPoint.set(pointId, { date, reading })
    return {
      id: `ob-${index + 1}`,
      pointId,
      date,
      reading,
      cumulative: cumulativeOf(reading, initialValue),
      dailyRate,
      observer,
      createdAt: stamp(-200 + index),
      updatedAt: stamp(-200 + index),
      revision: ROW_REVISION
    }
  })
}

export async function seedDatabase(): Promise<void> {
  await db.transaction('rw', [db.dams, db.sections, db.points, db.observations, db.alarms, db.pools], async () => {
    await db.dams.bulkPut(SEED_DAMS)
    await db.sections.bulkPut(SEED_SECTIONS)
    await db.points.bulkPut(SEED_POINTS)
    await db.observations.bulkPut(buildSeedObservations())
    await db.alarms.bulkPut(SEED_ALARMS)
    await db.pools.bulkPut(SEED_POOLS)
  })
}

/** 首屏调用：打开数据库并在主表为空时播种演示数据 */
export async function initDatabase(): Promise<void> {
  await db.open()
  if ((await db.dams.count()) === 0) {
    await seedDatabase()
  }
}

/* ============================== 级联删除 ============================== */

export async function deleteDamCascade(damId: string): Promise<void> {
  await db.transaction('rw', [db.dams, db.sections, db.points, db.observations, db.alarms, db.pools], async () => {
    const sections = await db.sections.where('damId').equals(damId).toArray()
    await deletePointsOfSections(sections.map((section) => section.id))
    if (sections.length > 0) await db.sections.bulkDelete(sections.map((section) => section.id))
    await db.pools.where('damId').equals(damId).delete()
    await db.dams.delete(damId)
  })
}

export async function deleteSectionCascade(sectionId: string): Promise<void> {
  await db.transaction('rw', db.sections, db.points, db.observations, db.alarms, async () => {
    await deletePointsOfSections([sectionId])
    await db.sections.delete(sectionId)
  })
}

export async function deletePointCascade(pointId: string): Promise<void> {
  await db.transaction('rw', db.points, db.observations, db.alarms, async () => {
    await db.observations.where('pointId').equals(pointId).delete()
    await db.alarms.where('pointId').equals(pointId).delete()
    await db.points.delete(pointId)
  })
}

async function deletePointsOfSections(sectionIds: string[]): Promise<void> {
  if (sectionIds.length === 0) return
  const points = await db.points.where('sectionId').anyOf(sectionIds).toArray()
  const pointIds = points.map((point) => point.id)
  if (pointIds.length > 0) {
    await db.observations.where('pointId').anyOf(pointIds).delete()
    await db.alarms.where('pointId').anyOf(pointIds).delete()
    await db.points.bulkDelete(pointIds)
  }
}

/* ============================ 整库导入导出 ============================ */

export async function countAll(): Promise<Record<string, number>> {
  const [dams, sections, points, observations, alarms, pools] = await Promise.all([
    db.dams.count(),
    db.sections.count(),
    db.points.count(),
    db.observations.count(),
    db.alarms.count(),
    db.pools.count()
  ])
  return { dams, sections, points, observations, alarms, pools }
}

export async function exportSnapshot(): Promise<BackupPayload> {
  const [dams, sections, points, observations, alarms, pools] = await Promise.all([
    db.dams.toArray(),
    db.sections.toArray(),
    db.points.toArray(),
    db.observations.toArray(),
    db.alarms.toArray(),
    db.pools.toArray()
  ])
  const strip = <T extends Revisioned>(row: T): Omit<T, 'revision'> => {
    const { revision: _revision, ...rest } = row
    return rest
  }
  return {
    app: 'gbtaildam',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    dams: dams.map(strip),
    sections: sections.map(strip),
    points: points.map(strip),
    observations: observations.map(strip),
    alarms: alarms.map(strip),
    pools: pools.map(strip)
  }
}

export async function importSnapshot(payload: BackupPayload): Promise<void> {
  await db.transaction('rw', [db.dams, db.sections, db.points, db.observations, db.alarms, db.pools], async () => {
    await Promise.all([
      db.dams.clear(),
      db.sections.clear(),
      db.points.clear(),
      db.observations.clear(),
      db.alarms.clear(),
      db.pools.clear()
    ])
    const rev = <T>(row: T): T & Revisioned => ({ ...row, revision: ROW_REVISION })
    await db.dams.bulkPut((payload.dams ?? []).map(rev))
    await db.sections.bulkPut((payload.sections ?? []).map(rev))
    await db.points.bulkPut((payload.points ?? []).map(rev))
    await db.observations.bulkPut((payload.observations ?? []).map(rev))
    await db.alarms.bulkPut((payload.alarms ?? []).map(rev))
    await db.pools.bulkPut((payload.pools ?? []).map(rev))
  })
}

export async function clearAllTables(): Promise<void> {
  await db.transaction('rw', [db.dams, db.sections, db.points, db.observations, db.alarms, db.pools], async () => {
    await Promise.all([
      db.dams.clear(),
      db.sections.clear(),
      db.points.clear(),
      db.observations.clear(),
      db.alarms.clear(),
      db.pools.clear()
    ])
  })
}

export async function resetDatabase(): Promise<void> {
  await clearAllTables()
  await seedDatabase()
}

/**
 * 观测录入：先按最新测点配置写入累计变化量与日速率，再统一重算该测点全部观测，
 * 并按本次最新观测调整未闭环预警（恢复正常关闭原单、升级补级，不另开重复单）。
 */
export async function putObservation(
  row: Omit<Observation, 'cumulative' | 'dailyRate'> & { cumulative?: number; dailyRate?: number }
): Promise<{ observation: ObservationRow; sync: PointSyncResult }> {
  const point = await db.points.get(row.pointId)
  const initialValue = point ? point.initialValue : 0
  const others = (await db.observations.where('pointId').equals(row.pointId).toArray())
    .filter((item) => item.id !== row.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  const previous = others.filter((item) => item.date < row.date).pop() ?? null
  const next: ObservationRow = {
    ...row,
    cumulative: cumulativeOf(row.reading, initialValue),
    dailyRate: previous ? dailyRateOf(row.reading, previous.reading, daysBetween(previous.date, row.date)) : 0,
    revision: ROW_REVISION
  }
  await db.observations.put(next)
  const sync = await syncPointObservations([row.pointId])
  return { observation: next, sync }
}

/**
 * 删除观测后重算该测点序列：后续观测的日速率会变，未闭环预警按删除后的最新观测调整。
 */
export async function deleteObservationAndSync(observationId: string): Promise<PointSyncResult | null> {
  const row = await db.observations.get(observationId)
  if (!row) return null
  const pointId = row.pointId
  await db.observations.delete(observationId)
  return syncPointObservations([pointId])
}

/** 重算某测点全部观测的累计变化量与日速率，并同步调整该测点未闭环预警 */
export async function recalculateObservations(pointId: string): Promise<void> {
  await syncPointObservations([pointId])
}

/** 按最新观测自动关闭原单时写入的处置措施（已闭环单保留原处置记录，不动） */
export const AUTO_CLOSE_MEASURE = '测点初值/阈值更新后按最新观测重算，累计变化已回落至蓝级以下，自动闭环'

/** 测点配置 / 观测变更后，重算累计量、日速率并联动调整未闭环预警的结果 */
export interface PointSyncResult {
  pointCount: number
  observationCount: number
  /** 预警级别升级（含漏判的更高级别被补上）的原单数 */
  alarmUpgraded: number
  /** 预警级别降级的原单数 */
  alarmDowngraded: number
  /** 恢复正常被关闭的原单数 */
  alarmClosed: number
}

export const EMPTY_POINT_SYNC_RESULT: PointSyncResult = {
  pointCount: 0,
  observationCount: 0,
  alarmUpgraded: 0,
  alarmDowngraded: 0,
  alarmClosed: 0
}

/**
 * 测点配置（初值 / 阈值）或观测序列变更后的统一收口：
 * 1. 历史观测一律按最新测点配置重算累计变化量与日速率（本次口径以最新配置为准）；
 * 2. 未闭环预警按各测点最新观测调整原单——恢复正常则关闭（不另开重复单），
 *    级别变化则原地升降级，已闭环单保留原样。
 */
export async function syncPointObservations(pointIds: string[]): Promise<PointSyncResult> {
  if (pointIds.length === 0) return { ...EMPTY_POINT_SYNC_RESULT }
  const result: PointSyncResult = { ...EMPTY_POINT_SYNC_RESULT, pointCount: pointIds.length }
  await db.transaction('rw', db.points, db.observations, db.alarms, async () => {
    const now = Date.now()
    const latestByPoint = new Map<string, LatestObservationLike>()
    const points = await db.points.where('id').anyOf(pointIds).toArray()

    for (const point of points) {
      const rows = (await db.observations.where('pointId').equals(point.id).toArray()).sort((a, b) =>
        a.date.localeCompare(b.date)
      )
      if (rows.length === 0) continue
      const patches = rows.map((row, index) => {
        const previous = index === 0 ? null : rows[index - 1]
        return {
          ...row,
          cumulative: cumulativeOf(row.reading, point.initialValue),
          dailyRate: previous ? dailyRateOf(row.reading, previous.reading, daysBetween(previous.date, row.date)) : 0,
          updatedAt: now
        }
      })
      await db.observations.bulkPut(patches)
      result.observationCount += patches.length
      const latest = patches[patches.length - 1]
      latestByPoint.set(point.id, {
        date: latest.date,
        cumulative: latest.cumulative
      })
    }

    const openAlarms = (await db.alarms.where('pointId').anyOf(pointIds).toArray()).filter((alarm) =>
      isOpenAlarmState(alarm.state)
    )
    const { items, summary } = reconcileOpenAlarms(openAlarms, points, latestByPoint)
    result.alarmUpgraded = summary.upgraded
    result.alarmDowngraded = summary.downgraded
    result.alarmClosed = summary.closed
    const alarmPatches = items.map((item) => {
      if (item.level === null) {
        return {
          ...item.alarm,
          state: '已闭环' as const,
          handler: item.alarm.handler || '系统自动',
          measure: item.alarm.measure || AUTO_CLOSE_MEASURE,
          updatedAt: now
        }
      }
      return {
        ...item.alarm,
        level: item.level,
        triggerValue: item.triggerValue,
        triggerDate: item.triggerDate,
        updatedAt: now
      }
    })
    if (alarmPatches.length > 0) await db.alarms.bulkPut(alarmPatches)
  })
  return result
}

/* ============================ 本地 UI 偏好 ============================ */

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(LS_KEYS.uiPrefs)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      lastDamId: typeof parsed.lastDamId === 'string' ? parsed.lastDamId : null,
      alarmOnlyOpen: parsed.alarmOnlyOpen === true
    }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

export function writeUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(LS_KEYS.uiPrefs, JSON.stringify(prefs))
}

export function stampDbVersion(): void {
  localStorage.setItem(LS_KEYS.dbVersion, String(DB_VERSION))
}

export function readStampedDbVersion(): number {
  const parsed = Number(localStorage.getItem(LS_KEYS.dbVersion))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DB_VERSION
}

export function stampBackupTime(iso: string): void {
  localStorage.setItem(LS_KEYS.lastBackupAt, iso)
}

export function readLastBackupAt(): string | null {
  return localStorage.getItem(LS_KEYS.lastBackupAt)
}
