/**
 * /pool 干滩长度与库水位记录
 * 按日登记水位、干滩长度并校核安全超高，导出结构版本。
 * 消费 Pool、Dam；复用 <EmptyPanel>、<StatBadge>、<FilterBar>。
 */
import { useMemo, useState } from 'react'
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import EmptyPanel from '@/components/common/EmptyPanel'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar'
import StatBadge from '@/components/common/StatBadge'
import { useDamStore } from '@/stores/damStore'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  countAll,
  DB_NAME,
  DB_VERSION,
  db,
  exportSnapshot,
  readLastBackupAt,
  readStampedDbVersion,
  resetDatabase,
  type PoolRow
} from '@/utils/db'
import {
  checkPool,
  EMPTY_POOL_DRAFT,
  MIN_BEACH_LENGTH_M,
  MIN_FREEBOARD_M,
  type Pool,
  type PoolDraft
} from '@/types/pool'
import { exportPoolCsv, exportStructureVersion } from '@/utils/export'

export default function PoolLog() {
  const { message } = AntdApp.useApp()
  const damStore = useDamStore()
  const poolTable = useIdbTable<PoolRow>(db.pools, { sortByUpdatedAt: false })

  const [form] = Form.useForm<PoolDraft>()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [damId, setDamId] = useState('')

  const filterSelects = useMemo(
    () => [
      {
        key: 'damId',
        label: '坝体',
        multiple: false,
        options: damStore.dams.map((dam) => ({ label: dam.name, value: dam.id }))
      }
    ],
    [damStore.dams]
  )

  const model: FilterModel = { keyword, damId }

  const onModelChange = (next: FilterModel): void => {
    setKeyword(String(next.keyword ?? ''))
    setDamId(typeof next.damId === 'string' ? next.damId : '')
  }

  const rows = poolTable.rows
    .filter((pool) => {
      if (damId && pool.damId !== damId) return false
      const text = keyword.trim().toLowerCase()
      if (text.length === 0) return true
      const dam = damStore.dams.find((item) => item.id === pool.damId)
      return pool.date.includes(text) || (dam ? dam.name.toLowerCase().includes(text) : false)
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const unqualified = poolTable.rows.filter((pool) => !checkPool(pool).beachOk || !checkPool(pool).freeboardOk).length

  const openCreate = (): void => {
    if (damStore.dams.length === 0) {
      message.warning('请先新建坝体')
      return
    }
    setEditingId(null)
    form.setFieldsValue({
      ...EMPTY_POOL_DRAFT,
      damId: damId || damStore.dams[0].id,
      date: new Date().toISOString().slice(0, 10)
    })
    setOpen(true)
  }

  const openEdit = (pool: Pool): void => {
    setEditingId(pool.id)
    form.setFieldsValue({
      damId: pool.damId,
      date: pool.date,
      waterLevelM: pool.waterLevelM,
      beachLengthM: pool.beachLengthM,
      freeboardM: pool.freeboardM
    })
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    if (editingId) {
      await poolTable.update(editingId, { ...values })
      message.success('库水位记录已更新')
    } else {
      await poolTable.create({ ...values }, 'pl')
      message.success('库水位与干滩长度已登记')
    }
    setOpen(false)
  }

  const remove = async (pool: Pool): Promise<void> => {
    await poolTable.remove(pool.id)
    message.success('记录已删除')
  }

  const exportJson = async (): Promise<void> => {
    const payload = await exportSnapshot()
    const filename = `gbtaildam-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    message.success(`已导出全量存档 ${filename}`)
  }

  const exportStructure = async (): Promise<void> => {
    const counts = await countAll()
    const filename = exportStructureVersion({
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      counts,
      exportedAt: new Date().toISOString()
    })
    message.success(`已导出结构版本 ${filename}（本地记录 v${readStampedDbVersion()}，最近备份 ${readLastBackupAt() ?? '—'}）`)
  }

  const reseed = async (): Promise<void> => {
    await resetDatabase()
    message.success('已重置为演示数据')
  }

  const columns: TableColumnsType<PoolRow> = [
    {
      title: '坝体',
      width: 190,
      render: (_value, record) => damStore.dams.find((item) => item.id === record.damId)?.name ?? '—'
    },
    { title: '日期', dataIndex: 'date', width: 120 },
    { title: '库水位', dataIndex: 'waterLevelM', width: 120, render: (value: number) => `${value.toFixed(2)} m` },
    {
      title: '干滩长度',
      dataIndex: 'beachLengthM',
      width: 130,
      render: (value: number) => (
        <span style={{ color: value < MIN_BEACH_LENGTH_M ? '#b03a2e' : undefined }}>{value.toFixed(1)} m</span>
      )
    },
    {
      title: '安全超高',
      dataIndex: 'freeboardM',
      width: 130,
      render: (value: number) => (
        <span style={{ color: value < MIN_FREEBOARD_M ? '#b03a2e' : undefined }}>{value.toFixed(2)} m</span>
      )
    },
    {
      title: '校核结论',
      width: 190,
      render: (_value, record) => {
        const result = checkPool(record)
        return <Tag color={result.beachOk && result.freeboardOk ? 'green' : 'red'}>{result.text}</Tag>
      }
    },
    {
      title: '操作',
      width: 140,
      render: (_value, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该记录？" onConfirm={() => remove(record)}>
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
          <h2 className="page-head__title">干滩长度与库水位记录</h2>
          <p className="page-head__desc">
            按日登记库水位、干滩长度与安全超高，自动校核是否达标（干滩 ≥ {MIN_BEACH_LENGTH_M} m、超高 ≥{' '}
            {MIN_FREEBOARD_M} m）。
          </p>
        </div>
        <div className="page-head__actions">
          <Button onClick={() => exportPoolCsv(damStore.dams, poolTable.rows)}>导出 CSV</Button>
          <Button onClick={exportStructure}>导出结构版本</Button>
          <Button onClick={exportJson}>导出全量 JSON</Button>
          <Button type="primary" onClick={openCreate}>
            登记水位
          </Button>
        </div>
      </div>

      <div className="stat-row">
        <StatBadge label="坝体总数" value={damStore.dams.length} suffix="座" tone="primary" />
        <StatBadge label="水位记录" value={poolTable.rows.length} suffix="条" tone="info" />
        <StatBadge label="校核不达标" value={unqualified} suffix="条" tone="danger" />
        <StatBadge
          label="达标率"
          value={poolTable.rows.length === 0 ? 100 : Math.round(((poolTable.rows.length - unqualified) / poolTable.rows.length) * 100)}
          percent={poolTable.rows.length === 0 ? 100 : Math.round(((poolTable.rows.length - unqualified) / poolTable.rows.length) * 100)}
          tone="success"
        />
      </div>

      <FilterBar model={model} selects={filterSelects} keywordPlaceholder="搜索日期 / 坝体" onModelChange={onModelChange} />

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h3 className="panel-title" style={{ margin: 0 }}>
            水位与干滩记录（{rows.length} / {poolTable.rows.length}）
          </h3>
          <Button size="small" onClick={reseed}>
            重置为演示数据
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyPanel
            title="还没有水位记录"
            description="按日登记库水位与干滩长度后，系统自动校核安全超高。"
            actionText="登记水位"
            onAction={openCreate}
            showSeed
            onSeed={reseed}
            compact
          />
        ) : (
          <Table<PoolRow> rowKey="id" size="small" bordered dataSource={rows} columns={columns} pagination={false} />
        )}
      </div>

      <Modal
        open={open}
        title={editingId ? '编辑水位记录' : '登记库水位与干滩'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_POOL_DRAFT}>
          <Form.Item name="damId" label="所属坝体" rules={[{ required: true, message: '请选择坝体' }]}>
            <Select options={damStore.dams.map((dam) => ({ label: dam.name, value: dam.id }))} />
          </Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true, message: '请填写日期' }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="waterLevelM" label="库水位(m)" rules={[{ required: true, message: '请填写库水位' }]}>
            <InputNumber step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="beachLengthM" label="干滩长度(m)" rules={[{ required: true, message: '请填写干滩长度' }]}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="freeboardM" label="安全超高(m)" rules={[{ required: true, message: '请填写安全超高' }]}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
