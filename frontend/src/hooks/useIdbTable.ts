/**
 * Dexie 单表增删改查 + liveQuery 订阅封装（React 版）
 * 页面与 store 统一通过它读写 IndexedDB，避免组件内部直接操作 Dexie 实例。
 */
import { liveQuery, type Table } from 'dexie'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createId } from '@/utils/db'

export type IdbRecord = { id: string; createdAt?: number; updatedAt?: number }

export interface UseIdbTableOptions<T extends IdbRecord> {
  /** 是否按 updatedAt 倒序，默认 true */
  sortByUpdatedAt?: boolean
  /** 数据变化后的额外回调 */
  onChange?: (rows: T[]) => void
}

/** 新增记录入参：id / 时间戳由封装层补齐 */
export type NewRecord<T extends IdbRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
}

export interface UseIdbTableResult<T extends IdbRecord> {
  rows: T[]
  loading: boolean
  /** 是否已完成首次载入：用于区分「数据为空」与「尚未读取」 */
  ready: boolean
  error: string | null
  refresh: () => Promise<void>
  getById: (id: string) => Promise<T | undefined>
  list: () => Promise<T[]>
  create: (payload: NewRecord<T>, idPrefix?: string) => Promise<T>
  update: (id: string, patch: Partial<T>) => Promise<void>
  upsert: (row: T) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkRemove: (ids: string[]) => Promise<void>
  bulkPut: (list: T[]) => Promise<void>
  clear: () => Promise<void>
}

export function useIdbTable<T extends IdbRecord>(
  table: Table<T, string>,
  options: UseIdbTableOptions<T> = {}
): UseIdbTableResult<T> {
  const { sortByUpdatedAt = true, onChange } = options
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const applySort = useCallback(
    (list: T[]): T[] => {
      if (!sortByUpdatedAt) return [...list]
      return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    },
    [sortByUpdatedAt]
  )

  useEffect(() => {
    const subscription = liveQuery(async () => applySort(await table.toArray())).subscribe({
      next: (list) => {
        setRows(list)
        setError(null)
        setReady(true)
        onChangeRef.current?.(list)
      },
      error: (err: unknown) => {
        setError(err instanceof Error ? err.message : '订阅本地数据失败')
      }
    })
    return () => subscription.unsubscribe()
  }, [table, applySort])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = applySort(await table.toArray())
      setRows(list)
      setError(null)
      setReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取本地数据失败')
    } finally {
      setLoading(false)
    }
  }, [table, applySort])

  const create = useCallback(
    async (payload: NewRecord<T>, idPrefix = 'row'): Promise<T> => {
      const now = Date.now()
      const record = {
        ...(payload as object),
        id: payload.id ?? createId(idPrefix),
        createdAt: payload.createdAt ?? now,
        updatedAt: payload.updatedAt ?? now
      } as T
      await table.put(record)
      return record
    },
    [table]
  )

  const update = useCallback(
    async (id: string, patch: Partial<T>): Promise<void> => {
      await table.update(id, { ...patch, updatedAt: Date.now() } as never)
    },
    [table]
  )

  const upsert = useCallback(
    async (row: T): Promise<void> => {
      await table.put({ ...row, updatedAt: Date.now() } as T)
    },
    [table]
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await table.delete(id)
    },
    [table]
  )

  const bulkRemove = useCallback(
    async (ids: string[]): Promise<void> => {
      await table.bulkDelete(ids)
    },
    [table]
  )

  const bulkPut = useCallback(
    async (list: T[]): Promise<void> => {
      await table.bulkPut(list)
    },
    [table]
  )

  const clear = useCallback(async (): Promise<void> => {
    await table.clear()
  }, [table])

  return useMemo(
    () => ({
      rows,
      loading,
      ready,
      error,
      refresh,
      getById: (id: string) => table.get(id),
      list: () => table.toArray(),
      create,
      update,
      upsert,
      remove,
      bulkRemove,
      bulkPut,
      clear
    }),
    [rows, loading, ready, error, refresh, table, create, update, upsert, remove, bulkRemove, bulkPut, clear]
  )
}
