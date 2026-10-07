/**
 * /alarms 预警触发与处置闭环
 * 按级别与状态处置预警，填写措施与处置人，状态机 待处置 → 处置中 → 已闭环。
 * 消费 Alarm、Point、Observation；复用 <AlarmTag>、<FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react'
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import AlarmTag from '@/components/common/AlarmTag'
import EmptyPanel from '@/components/common/EmptyPanel'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar'
import StatBadge from '@/components/common/StatBadge'
import { useDamStore } from '@/stores/damStore'
import { usePointStore } from '@/stores/pointStore'
import { useAlarmStore } from '@/stores/alarmStore'
import { useIdbTable } from '@/hooks/useIdbTable'
import { db, type ObservationRow } from '@/utils/db'
import {
  ALARM_LEVELS,
  ALARM_STATE_FLOW,
  ALARM_STATES,
  EMPTY_ALARM_DRAFT,
  type Alarm,
  type AlarmDraft,
  type AlarmLevel,
  type AlarmState
} from '@/types/alarm'

export default function AlarmBoard() {
  const { message } = AntdApp.useApp()
  const damStore = useDamStore()
  const pointStore = usePointStore()
  const alarmStore = useAlarmStore()
  const observationTable = useIdbTable<ObservationRow>(db.observations, { sortByUpdatedAt: false })

  const [form] = Form.useForm<AlarmDraft>()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<Alarm | null>(null)
  const [closeForm] = Form.useForm<{ handler: string; measure: string }>()

  const filterSelects = useMemo(
    () => [
      {
        key: 'damId',
        label: '坝体',
        multiple: false,
        options: damStore.dams.map((dam) => ({ label: dam.name, value: dam.id }))
      },
      { key: 'levels', label: '预警级别', options: ALARM_LEVELS.map((item) => ({ label: `${item}色`, value: item })) },
      { key: 'states', label: '处置状态', options: ALARM_STATES.map((item) => ({ label: item, value: item })) }
    ],
    [damStore.dams]
  )

  const [keyword, setKeyword] = useState('')
  const [damId, setDamId] = useState('')
  const [levels, setLevels] = useState<AlarmLevel[]>([])
  const model: FilterModel = { keyword, damId, levels, states: alarmStore.stateFilter }

  const onModelChange = (next: FilterModel): void => {
    setKeyword(String(next.keyword ?? ''))
    setDamId(typeof next.damId === 'string' ? next.damId : '')
    setLevels((Array.isArray(next.levels) ? next.levels : []) as AlarmLevel[])
    alarmStore.patchFilter({ stateFilter: (Array.isArray(next.states) ? next.states : []) as AlarmState[] })
  }

  const rows = alarmStore.sortedAlarms().filter((alarm) => {
    if (damId && alarm.damId !== damId) return false
    if (levels.length > 0 && !levels.includes(alarm.level)) return false
    if (alarmStore.stateFilter.length > 0 && !alarmStore.stateFilter.includes(alarm.state)) return false
    if (alarmStore.onlyOpen && alarm.state === '已闭环') return false
    const text = keyword.trim().toLowerCase()
    if (text.length === 0) return true
    const point = pointStore.points.find((item) => item.id === alarm.pointId)
    return (
      (point ? point.code.toLowerCase().includes(text) : false) ||
      alarm.handler.toLowerCase().includes(text) ||
      alarm.measure.toLowerCase().includes(text)
    )
  })

  const counts = alarmStore.counts()
  const levelCounts = alarmStore.levelCounts()

  const openCreate = (): void => {
    if (pointStore.points.length === 0) {
      message.warning('请先布设测点')
      return
    }
    setEditingId(null)
    form.setFieldsValue({ ...EMPTY_ALARM_DRAFT, pointId: pointStore.points[0].id })
    setOpen(true)
  }

  const openEdit = (alarm: Alarm): void => {
    setEditingId(alarm.id)
    form.setFieldsValue({
      pointId: alarm.pointId,
      level: alarm.level,
      triggerValue: alarm.triggerValue,
      triggerDate: alarm.triggerDate,
      state: alarm.state,
      handler: alarm.handler,
      measure: alarm.measure
    })
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    if (editingId) {
      await alarmStore.updateAlarm(editingId, values)
      message.success('预警单已更新')
    } else {
      await alarmStore.createAlarm(values)
      message.success('预警单已创建')
    }
    setOpen(false)
  }

  const remove = async (alarm: Alarm): Promise<void> => {
    await alarmStore.removeAlarm(alarm.id)
    message.success('预警单已删除')
  }

  const advance = async (alarm: Alarm): Promise<void> => {
    const next = ALARM_STATE_FLOW[alarm.state]
    if (!next) {
      message.info('该预警已完成闭环')
      return
    }
    if (next === '已闭环') {
      setCloseTarget(alarm)
      closeForm.setFieldsValue({ handler: alarm.handler, measure: alarm.measure })
      setCloseOpen(true)
      return
    }
    await alarmStore.advance(alarm.id)
    message.success(`预警状态已推进为「${next}」`)
  }

  const submitClose = async (): Promise<void> => {
    const values = await closeForm.validateFields().catch(() => null)
    if (!values || !closeTarget) return
    await alarmStore.closeAlarm(closeTarget.id, values.handler, values.measure)
    message.success('预警已闭环，处置措施已归档')
    setCloseOpen(false)
    setCloseTarget(null)
  }

  const pointOptions = pointStore.points.map((point) => {
    const dam = damStore.dams.find((item) => item.id === point.damId)
    return { label: `${point.code} · ${point.type} · ${dam ? dam.name : '未知坝体'}`, value: point.id }
  })

  const columns: TableColumnsType<Alarm> = [
    {
      title: '坝体 / 测点',
      width: 200,
      render: (_value, record) => {
        const point = pointStore.points.find((item) => item.id === record.pointId)
        const dam = damStore.dams.find((item) => item.id === record.damId)
        return `${dam ? dam.name : '—'} / ${point ? point.code : '测点已删除'}`
      }
    },
    { title: '级别', width: 150, render: (_value, record) => <AlarmTag level={record.level} size="small" /> },
    {
      title: '触发值',
      width: 130,
      render: (_value, record) => {
        const point = pointStore.points.find((item) => item.id === record.pointId)
        return `${record.triggerValue.toFixed(3)} ${point ? point.unit : ''}`
      }
    },
    { title: '触发日期', dataIndex: 'triggerDate', width: 120 },
    {
      title: '触发读数',
      width: 130,
      render: (_value, record) => {
        const observation = observationTable.rows.find(
          (row) => row.pointId === record.pointId && row.date === record.triggerDate
        )
        return observation ? observation.reading.toFixed(3) : <span className="muted">—</span>
      }
    },
    {
      title: '状态',
      width: 110,
      render: (_value, record) => (
        <Tag color={record.state === '已闭环' ? 'green' : record.state === '处置中' ? 'blue' : 'orange'}>
          {record.state}
        </Tag>
      )
    },
    { title: '处置人', dataIndex: 'handler', width: 100, render: (value: string) => value || '—' },
    { title: '处置措施', dataIndex: 'measure', width: 220, render: (value: string) => value || '—' },
    {
      title: '操作',
      width: 220,
      render: (_value, record) => (
        <Space size={4}>
          <Button type="link" size="small" disabled={!ALARM_STATE_FLOW[record.state]} onClick={() => advance(record)}>
            {ALARM_STATE_FLOW[record.state] === '处置中' ? '开始处置' : ALARM_STATE_FLOW[record.state] === '已闭环' ? '闭环' : '已闭环'}
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该预警单？" onConfirm={() => remove(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-head__title">预警触发与处置闭环</h2>
          <p className="page-head__desc">
            按级别（红 &gt; 橙 &gt; 黄 &gt; 蓝）排序处置，填写处置人与措施后闭环归档。
          </p>
        </div>
        <div className="page-head__actions">
          <Button
            onClick={() => {
              alarmStore.patchFilter({ onlyOpen: !alarmStore.onlyOpen })
            }}
          >
            {alarmStore.onlyOpen ? '查看全部预警' : '仅看未闭环'}
          </Button>
          <Button type="primary" onClick={openCreate}>
            新建预警单
          </Button>
        </div>
      </div>

      <div className="stat-row">
        <StatBadge label="预警总数" value={alarmStore.alarms.length} suffix="张" tone="primary" />
        <StatBadge label="待处置" value={counts['待处置']} suffix="张" tone="warning" />
        <StatBadge label="处置中" value={counts['处置中']} suffix="张" tone="info" />
        <StatBadge label="闭环率" value={alarmStore.closedPercent()} percent={alarmStore.closedPercent()} tone="danger" hint={`红 ${levelCounts['红']} / 橙 ${levelCounts['橙']} / 黄 ${levelCounts['黄']} / 蓝 ${levelCounts['蓝']}`} />
      </div>

      <FilterBar model={model} selects={filterSelects} keywordPlaceholder="搜索测点编号 / 处置人 / 措施" onModelChange={onModelChange} />

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h3 className="panel-title" style={{ margin: 0 }}>
            预警清单（{rows.length} / {alarmStore.alarms.length}）
          </h3>
          <span className="muted">蓝色为接近阈值，红色为严重越限</span>
        </div>
        {rows.length === 0 ? (
          <EmptyPanel
            title="没有匹配的预警"
            description="可在观测录入页对越限读数直接生成预警单。"
            actionText="新建预警单"
            secondaryText="重置筛选"
            onAction={openCreate}
            onSecondary={() => alarmStore.resetFilter()}
            compact
          />
        ) : (
          <Table<Alarm> rowKey="id" size="small" bordered dataSource={rows} columns={columns} pagination={false} scroll={{ x: 1400 }} />
        )}
      </div>

      <Modal
        open={open}
        title={editingId ? '编辑预警单' : '新建预警单'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_ALARM_DRAFT}>
          <Form.Item name="pointId" label="关联测点" rules={[{ required: true, message: '请选择测点' }]}>
            <Select options={pointOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="level" label="预警级别" rules={[{ required: true, message: '请选择级别' }]}>
            <Select options={ALARM_LEVELS.map((item) => ({ label: `${item}色`, value: item }))} />
          </Form.Item>
          <Form.Item name="triggerValue" label="触发值（累计变化量）" rules={[{ required: true, message: '请填写触发值' }]}>
            <InputNumber step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="triggerDate" label="触发日期" rules={[{ required: true, message: '请填写触发日期' }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="state" label="处置状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={ALARM_STATES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="handler" label="处置人">
            <Input placeholder="如 王丽" />
          </Form.Item>
          <Form.Item name="measure" label="处置措施">
            <Input.TextArea rows={3} placeholder="如 加密观测频次，同时降低库水位" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={closeOpen}
        title="预警闭环"
        onCancel={() => setCloseOpen(false)}
        onOk={submitClose}
        okText="确认闭环"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={closeForm} layout="vertical">
          <Form.Item name="handler" label="处置人" rules={[{ required: true, message: '请填写处置人' }]}>
            <Input placeholder="如 王丽" />
          </Form.Item>
          <Form.Item name="measure" label="处置措施" rules={[{ required: true, message: '请填写处置措施' }]}>
            <Input.TextArea rows={3} placeholder="填写处置经过与复测结论" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
