/**
 * /trends 累计位移与沉降速率计算
 * 按测点降序展示累计变化量与日速率，抽屉内查看历次观测曲线并可直接生成预警单。
 * 消费 Observation、Point；复用 <StatBadge>、<AlarmTag>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Descriptions,
  Drawer,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag
} from 'antd'
import type { TableColumnsType } from 'antd'
import AlarmTag from '@/components/common/AlarmTag'
import EmptyPanel from '@/components/common/EmptyPanel'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar'
import StatBadge from '@/components/common/StatBadge'
import { useDamStore } from '@/stores/damStore'
import { usePointStore } from '@/stores/pointStore'
import { useAlarmStore } from '@/stores/alarmStore'
import { useAlarmLevel } from '@/hooks/useAlarmLevel'
import { useIdbTable } from '@/hooks/useIdbTable'
import { db, type ObservationRow } from '@/utils/db'
import { POINT_TYPES, type Point, type PointType } from '@/types/point'
import { formatRate, formatReading, ratioOf } from '@/utils/threshold'

interface TrendRow {
  point: Point
  damName: string
  stakeNo: string
  latest: ObservationRow | null
  count: number
  cumulative: number
  dailyRate: number
  ratio: number
}

export default function TrendBoard() {
  const { message } = AntdApp.useApp()
  const damStore = useDamStore()
  const pointStore = usePointStore()
  const alarmStore = useAlarmStore()
  const alarmLevel = useAlarmLevel()
  const observationTable = useIdbTable<ObservationRow>(db.observations, { sortByUpdatedAt: false })

  const [drawerPointId, setDrawerPointId] = useState<string | null>(null)
  const [onlyExceeded, setOnlyExceeded] = useState(false)
  const [thresholdOpen, setThresholdOpen] = useState(false)
  const [editingPoint, setEditingPoint] = useState<Point | null>(null)
  const [thresholdForm] = Form.useForm<{ initialValue: number; threshold: number }>()

  const filter = pointStore.filter
  const filterSelects = useMemo(
    () => [
      {
        key: 'damId',
        label: '坝体',
        multiple: false,
        options: damStore.dams.map((dam) => ({ label: dam.name, value: dam.id }))
      },
      { key: 'types', label: '测点类型', options: POINT_TYPES.map((item) => ({ label: item, value: item })) }
    ],
    [damStore.dams]
  )

  const model: FilterModel = { keyword: filter.keyword, damId: filter.damId, types: filter.types }

  const onModelChange = (next: FilterModel): void => {
    pointStore.patchFilter({
      keyword: String(next.keyword ?? ''),
      damId: typeof next.damId === 'string' ? next.damId : '',
      types: (Array.isArray(next.types) ? next.types : []) as PointType[]
    })
  }

  const trendRows = useMemo<TrendRow[]>(() => {
    const rows = pointStore.points
      .filter((point) => {
        if (filter.damId && point.damId !== filter.damId) return false
        if (filter.types.length > 0 && !filter.types.includes(point.type)) return false
        const text = filter.keyword.trim().toLowerCase()
        if (text.length > 0 && !point.code.toLowerCase().includes(text)) return false
        return true
      })
      .map((point) => {
        const own = observationTable.rows
          .filter((row) => row.pointId === point.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        const latest = own[own.length - 1] ?? null
        const section = damStore.sections.find((item) => item.id === point.sectionId)
        const dam = damStore.dams.find((item) => item.id === point.damId)
        const cumulative = latest ? latest.cumulative : 0
        return {
          point,
          damName: dam ? dam.name : '—',
          stakeNo: section ? section.stakeNo : '—',
          latest,
          count: own.length,
          cumulative,
          dailyRate: latest ? latest.dailyRate : 0,
          ratio: ratioOf(cumulative, point.threshold)
        }
      })
    const filtered = onlyExceeded ? rows.filter((row) => row.ratio >= 0.7) : rows
    return filtered.sort((a, b) => b.ratio - a.ratio)
  }, [pointStore.points, observationTable.rows, damStore.sections, damStore.dams, filter, onlyExceeded])

  const exceededCount = trendRows.filter((row) => row.ratio >= 0.7).length
  const averageRate = useMemo(() => {
    const rated = trendRows.filter((row) => row.latest !== null)
    if (rated.length === 0) return 0
    return rated.reduce((sum, row) => sum + row.dailyRate, 0) / rated.length
  }, [trendRows])

  const drawerPoint = drawerPointId ? pointStore.points.find((point) => point.id === drawerPointId) ?? null : null
  const drawerObservations = useMemo(
    () =>
      observationTable.rows
        .filter((row) => row.pointId === drawerPointId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [observationTable.rows, drawerPointId]
  )
  const drawerLatest = drawerObservations[0] ?? null
  const drawerLevel = drawerPoint && drawerLatest ? alarmLevel.evaluate(drawerPoint, drawerLatest.reading).level : null

  const generateAlarm = async (point: Point, observation: ObservationRow): Promise<void> => {
    if (alarmStore.alarms.some((alarm) => alarm.pointId === point.id && alarm.triggerDate === observation.date)) {
      message.info('该测点当日已生成预警单')
      return
    }
    const result = alarmLevel.buildDraft(point, observation.date, observation.reading)
    if (!result) {
      message.info('该观测未越限，无需生成预警单')
      return
    }
    await alarmStore.createAlarm({ ...result.draft, measure: result.basis })
    message.success(`已生成${result.draft.level}色预警单`)
  }

  const openThreshold = (point: Point): void => {
    setEditingPoint(point)
    thresholdForm.setFieldsValue({ initialValue: point.initialValue, threshold: point.threshold })
    setThresholdOpen(true)
  }

  const submitThreshold = async (): Promise<void> => {
    if (!editingPoint) return
    const values = await thresholdForm.validateFields().catch(() => null)
    if (!values) return
    await pointStore.updatePoint(editingPoint.id, {
      initialValue: values.initialValue,
      threshold: values.threshold
    })
    message.success(`${editingPoint.code} 初值与阈值已更新，历史观测偏差已重算`)
    setThresholdOpen(false)
  }

  const removePoint = async (point: Point): Promise<void> => {
    await pointStore.removePoint(point.id)
    setDrawerPointId(null)
    message.success('测点及其观测记录已删除')
  }

  const columns: TableColumnsType<TrendRow> = [
    {
      title: '排名',
      width: 70,
      render: (_value, _record, index) => index + 1
    },
    { title: '测点编号', width: 120, render: (_value, record) => <strong>{record.point.code}</strong> },
    {
      title: '坝体 / 桩号',
      width: 190,
      render: (_value, record) => `${record.damName} / ${record.stakeNo}`
    },
    { title: '类型', width: 100, render: (_value, record) => <Tag color="blue">{record.point.type}</Tag> },
    { title: '观测次数', width: 100, render: (_value, record) => record.count },
    {
      title: '最新读数',
      width: 140,
      render: (_value, record) =>
        record.latest ? formatReading(record.latest.reading, record.point.unit) : <span className="muted">暂无观测</span>
    },
    {
      title: '累计变化',
      width: 140,
      render: (_value, record) => (
        <span style={{ color: record.ratio >= 0.7 ? '#b03a2e' : undefined }}>
          {record.cumulative.toFixed(3)} {record.point.unit}
        </span>
      )
    },
    {
      title: '日速率',
      width: 130,
      render: (_value, record) => (record.latest ? formatRate(record.dailyRate, record.point.unit) : '—')
    },
    {
      title: '占阈值比',
      width: 110,
      render: (_value, record) => `${(record.ratio * 100).toFixed(1)}%`
    },
    {
      title: '判定',
      width: 150,
      render: (_value, record) => {
        if (!record.latest) return <Tag>暂无观测</Tag>
        const level = alarmLevel.evaluate(record.point, record.latest.reading).level
        return level ? <AlarmTag level={level} size="small" /> : <Tag color="green">正常</Tag>
      }
    },
    {
      title: '操作',
      width: 170,
      render: (_value, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setDrawerPointId(record.point.id)}>
            曲线
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!record.latest || record.ratio < 0.7}
            onClick={() => record.latest && generateAlarm(record.point, record.latest)}
          >
            生成预警
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-head__title">累计位移与沉降速率计算</h2>
          <p className="page-head__desc">
            按累计变化量占阈值比降序排列，日速率由相邻两次观测差值除以间隔天数得到。
          </p>
        </div>
        <div className="page-head__actions">
          <Button onClick={() => setOnlyExceeded((value) => !value)}>{onlyExceeded ? '查看全部测点' : '仅看越限测点'}</Button>
        </div>
      </div>

      <div className="stat-row">
        <StatBadge label="测点总数" value={pointStore.points.length} suffix="个" tone="primary" />
        <StatBadge label="越限测点" value={exceededCount} suffix="个" tone="warning" />
        <StatBadge
          label="越限占比"
          value={exceededCount}
          percent={pointStore.points.length === 0 ? 0 : Math.round((exceededCount / pointStore.points.length) * 100)}
          tone="danger"
        />
        <StatBadge label="平均日速率" value={averageRate.toFixed(4)} suffix="/d" tone="info" />
      </div>

      <FilterBar
        model={model}
        selects={filterSelects}
        keywordPlaceholder="搜索测点编号"
        onModelChange={onModelChange}
      />

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h3 className="panel-title" style={{ margin: 0 }}>
            速率排行（{trendRows.length} / {pointStore.points.length}）
          </h3>
          <span className="muted">点击「曲线」查看该测点全部观测记录</span>
        </div>
        {trendRows.length === 0 ? (
          <EmptyPanel
            title="没有可计算的测点"
            description="先到观测录入页登记各测点的读数。"
            secondaryText="查看全部测点"
            onSecondary={() => setOnlyExceeded(false)}
            compact
          />
        ) : (
          <Table<TrendRow>
            rowKey={(record) => record.point.id}
            size="small"
            bordered
            dataSource={trendRows}
            columns={columns}
            pagination={false}
            scroll={{ x: 1400 }}
          />
        )}
      </div>

      <Drawer
        open={drawerPointId !== null}
        width={620}
        title={drawerPoint ? `${drawerPoint.code} · 观测曲线` : '测点详情'}
        onClose={() => setDrawerPointId(null)}
      >
        {drawerPoint ? (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="测点类型">{drawerPoint.type}</Descriptions.Item>
              <Descriptions.Item label="单位">{drawerPoint.unit}</Descriptions.Item>
              <Descriptions.Item label="初值">{drawerPoint.initialValue}</Descriptions.Item>
              <Descriptions.Item label="阈值">{drawerPoint.threshold}</Descriptions.Item>
              <Descriptions.Item label="观测次数">{drawerObservations.length}</Descriptions.Item>
              <Descriptions.Item label="最新判定">
                {drawerLevel ? <AlarmTag level={drawerLevel} size="small" /> : <Tag color="green">正常</Tag>}
              </Descriptions.Item>
            </Descriptions>
            <div style={{ margin: '14px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {drawerLatest ? (
                <Button
                  type="primary"
                  size="small"
                  disabled={!drawerLevel}
                  onClick={() => generateAlarm(drawerPoint, drawerLatest)}
                >
                  按最新观测生成预警单
                </Button>
              ) : null}
              <Button size="small" onClick={() => openThreshold(drawerPoint)}>
                编辑初值与阈值
              </Button>
              <Popconfirm title="删除该测点将同时删除其观测记录与预警单" onConfirm={() => removePoint(drawerPoint)}>
                <Button size="small" danger>
                  删除测点
                </Button>
              </Popconfirm>
            </div>
            {drawerObservations.length === 0 ? (
              <EmptyPanel title="暂无观测记录" description="该测点尚未录入任何读数。" compact />
            ) : (
              <Table<ObservationRow>
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                dataSource={drawerObservations}
                columns={[
                  { title: '日期', dataIndex: 'date', width: 120 },
                  { title: '读数', dataIndex: 'reading', width: 110, render: (value: number) => value.toFixed(3) },
                  { title: '累计变化', dataIndex: 'cumulative', width: 120, render: (value: number) => value.toFixed(3) },
                  { title: '日速率', dataIndex: 'dailyRate', width: 110, render: (value: number) => value.toFixed(4) },
                  { title: '观测人', dataIndex: 'observer', width: 100 }
                ]}
              />
            )}
          </>
        ) : (
          <EmptyPanel title="未选择测点" description="从速率排行中选择一个测点查看详情。" compact />
        )}
      </Drawer>

      <Modal
        open={thresholdOpen}
        title={editingPoint ? `编辑阈值 · ${editingPoint.code}` : '编辑阈值'}
        onCancel={() => setThresholdOpen(false)}
        onOk={submitThreshold}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={thresholdForm} layout="vertical">
          <Form.Item
            name="initialValue"
            label={`初值（${editingPoint ? editingPoint.unit : ''}）`}
            rules={[{ required: true, message: '请填写初值' }]}
          >
            <InputNumber step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="threshold"
            label={`阈值 · 允许最大变化量（${editingPoint ? editingPoint.unit : ''}）`}
            rules={[{ required: true, message: '请填写阈值' }]}
          >
            <InputNumber min={0.01} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
