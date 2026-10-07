/**
 * <FilterBar> 坝体 / 测点类型 / 预警状态多条件过滤并同步 URL query
 * 被测点配置、观测录入、预警处置页消费。
 */
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Input, Select, Space, Switch, Tag } from 'antd'
import type { ReactNode } from 'react'

export interface FilterSelectOption {
  label: string
  value: string
}

export interface FilterSelectConfig {
  /** query key，同时作为唯一标识 */
  key: string
  label: string
  options: FilterSelectOption[]
  placeholder?: string
  /** 多选（默认）或单选 */
  multiple?: boolean
}

export interface FilterModel {
  keyword: string
  [key: string]: string | string[] | boolean
}

export interface FilterBarProps {
  model: FilterModel
  selects?: FilterSelectConfig[]
  keywordPlaceholder?: string
  switchLabel?: string
  switchValue?: boolean
  hasSwitch?: boolean
  syncQuery?: boolean
  onModelChange: (model: FilterModel) => void
  onSwitchChange?: (value: boolean) => void
  actions?: ReactNode
}

function toTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter((item) => item.length > 0)
  return []
}

export function FilterBar({
  model,
  selects = [],
  keywordPlaceholder = '搜索关键字…',
  switchLabel = '',
  switchValue = false,
  hasSwitch = false,
  syncQuery = true,
  onModelChange,
  onSwitchChange,
  actions
}: FilterBarProps) {
  const [, setSearchParams] = useSearchParams()
  const restored = useRef(false)

  const pushQuery = (next: FilterModel): void => {
    if (!syncQuery) return
    const params = new URLSearchParams()
    Object.entries(next).forEach(([key, value]) => {
      const target = key === 'keyword' ? 'kw' : key
      if (Array.isArray(value)) {
        if (value.length > 0) params.set(target, value.join(','))
      } else if (typeof value === 'string') {
        if (value.length > 0) params.set(target, value)
      }
    })
    setSearchParams(params, { replace: true })
  }

  // 首次挂载：地址栏已有条件时回填给父级
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (!syncQuery) return
    const params = new URLSearchParams(window.location.search)
    if ([...params.keys()].length === 0) return
    const next: FilterModel = { keyword: params.get('kw') ?? '' }
    selects.forEach((select) => {
      const values = toTextArray(params.get(select.key))
      next[select.key] = select.multiple === false ? values[0] ?? '' : values
    })
    onModelChange(next)
  }, [selects, syncQuery, onModelChange])

  const commit = (next: FilterModel): void => {
    onModelChange(next)
    pushQuery(next)
  }

  const activeCount = Object.entries(model).reduce((sum, [key, value]) => {
    if (key === 'keyword') return sum
    if (Array.isArray(value)) return sum + value.length
    if (typeof value === 'string' && value.length > 0) return sum + 1
    if (typeof value === 'boolean' && value) return sum + 1
    return sum
  }, 0)

  const handleReset = (): void => {
    const cleared: FilterModel = { keyword: '' }
    selects.forEach((select) => {
      cleared[select.key] = select.multiple === false ? '' : []
    })
    onModelChange(cleared)
    if (syncQuery) setSearchParams(new URLSearchParams(), { replace: true })
    if (hasSwitch) onSwitchChange?.(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        background: '#ffffff',
        border: '1px solid #dde5ee',
        borderRadius: 10
      }}
    >
      <Space wrap size={12} style={{ flex: '1 1 520px' }}>
        <Input
          allowClear
          style={{ width: 220 }}
          placeholder={keywordPlaceholder}
          value={model.keyword}
          onChange={(event) => commit({ ...model, keyword: event.target.value })}
        />
        {selects.map((select) => (
          <Space key={select.key} size={6}>
            <span style={{ fontSize: 13, color: '#6b7a8d' }}>{select.label}</span>
            <Select
              style={{ width: 190 }}
              mode={select.multiple === false ? undefined : 'multiple'}
              allowClear
              maxTagCount="responsive"
              placeholder={select.placeholder ?? `选择${select.label}`}
              value={
                (select.multiple === false
                  ? (typeof model[select.key] === 'string' ? (model[select.key] as string) : undefined)
                  : ((model[select.key] as string[] | undefined) ?? [])) as never
              }
              options={select.options}
              onChange={(value: unknown) => {
                const next: FilterModel = { ...model }
                next[select.key] = (value ?? (select.multiple === false ? '' : [])) as string | string[]
                commit(next)
              }}
            />
          </Space>
        ))}
        {hasSwitch ? (
          <Space size={6}>
            <Switch
              size="small"
              checked={switchValue}
              onChange={(checked) => {
                onSwitchChange?.(checked)
                commit({ ...model, [switchLabel || 'switch']: checked })
              }}
            />
            <span style={{ fontSize: 13, color: '#6b7a8d' }}>{switchLabel}</span>
          </Space>
        ) : null}
      </Space>

      <Space wrap>
        {actions}
        {activeCount > 0 ? <Tag color="orange">{activeCount} 项条件</Tag> : null}
        <Button type="link" onClick={handleReset}>
          重置
        </Button>
      </Space>
    </div>
  )
}

export default FilterBar
