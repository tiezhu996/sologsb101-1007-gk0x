/**
 * /dams 坝体与断面台账
 * 新建坝体与断面、按坝型与等别筛选；卡片回显测点数与未闭环预警数。
 * 消费 Dam、Section；复用 <StatBadge>、<EmptyPanel>、<FilterBar>。
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import EmptyPanel from '@/components/common/EmptyPanel'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar'
import StatBadge from '@/components/common/StatBadge'
import { useDamStore } from '@/stores/damStore'
import { usePointStore } from '@/stores/pointStore'
import { useAlarmStore } from '@/stores/alarmStore'
import { DAM_GRADES, DAM_TYPES, EMPTY_DAM_DRAFT, formatHeight, type Dam, type DamDraft, type DamGrade, type DamType } from '@/types/dam'
import { EMPTY_SECTION_DRAFT, formatSlope, formatStakeNo, type Section, type SectionDraft } from '@/types/section'

export default function DamList() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const damStore = useDamStore()
  const pointStore = usePointStore()
  const alarmStore = useAlarmStore()

  const [damForm] = Form.useForm<DamDraft>()
  const [sectionForm] = Form.useForm<SectionDraft>()
  const [damOpen, setDamOpen] = useState(false)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [editingDamId, setEditingDamId] = useState<string | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)

  const filter = damStore.filter
  const filteredDams = damStore.filteredDams()
  const currentDam = damStore.currentDam()
  const sections = currentDam ? damStore.sectionsOfDam(currentDam.id) : []

  const filterSelects = useMemo(
    () => [
      { key: 'damTypes', label: '坝型', options: DAM_TYPES.map((item) => ({ label: item, value: item })) },
      { key: 'grades', label: '等别', options: DAM_GRADES.map((item) => ({ label: item, value: item })) }
    ],
    []
  )

  const model: FilterModel = {
    keyword: filter.keyword,
    damTypes: filter.damTypes,
    grades: filter.grades
  }

  const onModelChange = (next: FilterModel): void => {
    damStore.patchFilter({
      keyword: String(next.keyword ?? ''),
      damTypes: (Array.isArray(next.damTypes) ? next.damTypes : []) as DamType[],
      grades: (Array.isArray(next.grades) ? next.grades : []) as DamGrade[]
    })
  }

  const pointCountOf = (damId: string): number => pointStore.points.filter((point) => point.damId === damId).length
  const openAlarmCountOf = (damId: string): number =>
    alarmStore.alarms.filter((alarm) => alarm.damId === damId && alarm.state !== '已闭环').length

  const openCreateDam = (): void => {
    setEditingDamId(null)
    damForm.setFieldsValue({ ...EMPTY_DAM_DRAFT })
    setDamOpen(true)
  }

  const openEditDam = (dam: Dam): void => {
    setEditingDamId(dam.id)
    damForm.setFieldsValue({
      name: dam.name,
      damType: dam.damType,
      finalHeightM: dam.finalHeightM,
      grade: dam.grade,
      commissionDate: dam.commissionDate
    })
    setDamOpen(true)
  }

  const submitDam = async (): Promise<void> => {
    const values = await damForm.validateFields().catch(() => null)
    if (!values) return
    if (editingDamId) {
      await damStore.updateDam(editingDamId, values)
      message.success('坝体信息已更新')
    } else {
      await damStore.createDam(values)
      message.success('坝体已创建，可继续录入断面')
    }
    setDamOpen(false)
  }

  const removeDam = async (dam: Dam): Promise<void> => {
    await damStore.removeDam(dam.id)
    message.success('坝体及其下游数据已删除')
  }

  const openCreateSection = (): void => {
    if (!currentDam) {
      message.warning('请先选择或新建一个坝体')
      return
    }
    setEditingSectionId(null)
    sectionForm.setFieldsValue({ ...EMPTY_SECTION_DRAFT, damId: currentDam.id })
    setSectionOpen(true)
  }

  const openEditSection = (section: Section): void => {
    setEditingSectionId(section.id)
    sectionForm.setFieldsValue({
      damId: section.damId,
      stakeNo: section.stakeNo,
      slopeRatio: section.slopeRatio,
      elevationM: section.elevationM
    })
    setSectionOpen(true)
  }

  const submitSection = async (): Promise<void> => {
    const values = await sectionForm.validateFields().catch(() => null)
    if (!values) return
    if (editingSectionId) {
      await damStore.updateSection(editingSectionId, values)
      message.success('断面已更新')
    } else {
      await damStore.createSection(values)
      message.success('断面已录入')
    }
    setSectionOpen(false)
  }

  const removeSection = async (section: Section): Promise<void> => {
    await damStore.removeSection(section.id)
    message.success('断面及其下游测点已删除')
  }

  const sectionColumns: TableColumnsType<Section> = [
    { title: '桩号', dataIndex: 'stakeNo', width: 140, render: (value: string) => formatStakeNo(value) },
    { title: '坡比', dataIndex: 'slopeRatio', width: 120, render: (value: number) => formatSlope(value) },
    { title: '坝顶高程', dataIndex: 'elevationM', width: 130, render: (value: number) => `${value.toFixed(1)} m` },
    {
      title: '测点数',
      width: 100,
      render: (_value, record) => pointStore.points.filter((point) => point.sectionId === record.id).length
    },
    {
      title: '操作',
      width: 220,
      render: (_value, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEditSection(record)}>
            编辑
          </Button>
          <Popconfirm title="删除该断面将同时删除其测点与观测记录" onConfirm={() => removeSection(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
          <Button
            type="link"
            size="small"
            onClick={() => {
              pointStore.patchFilter({ damId: record.damId, keyword: '' })
              navigate('/points')
            }}
          >
            测点配置
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-head__title">坝体与断面台账</h2>
          <p className="page-head__desc">
            先建坝体再录断面；卡片回显测点数与未闭环预警数，点击切换右侧断面明细。
          </p>
        </div>
        <div className="page-head__actions">
          <Button type="primary" onClick={openCreateDam}>
            新建坝体
          </Button>
          <Button disabled={!currentDam} onClick={openCreateSection}>
            录入断面
          </Button>
        </div>
      </div>

      <div className="stat-row">
        <StatBadge label="坝体总数" value={damStore.dams.length} suffix="座" tone="primary" />
        <StatBadge label="断面总数" value={damStore.sections.length} suffix="个" tone="info" />
        <StatBadge label="测点总数" value={pointStore.points.length} suffix="个" tone="default" />
        <StatBadge
          label="未闭环预警"
          value={alarmStore.alarms.filter((alarm) => alarm.state !== '已闭环').length}
          percent={100 - alarmStore.closedPercent()}
          tone="danger"
        />
      </div>

      <FilterBar
        model={model}
        selects={filterSelects}
        keywordPlaceholder="搜索坝体名称 / 坝型"
        onModelChange={onModelChange}
      />

      <div className="grid-two" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 className="panel-title">坝体列表（{filteredDams.length}）</h3>
          {filteredDams.length === 0 ? (
            <EmptyPanel
              title="还没有坝体"
              description="新建坝体后即可录入断面与测点。"
              actionText="新建坝体"
              onAction={openCreateDam}
              compact
            />
          ) : (
            filteredDams.map((dam) => (
              <div
                key={dam.id}
                className={`card-list-item${dam.id === damStore.currentDamId ? ' is-active' : ''}`}
                onClick={() => damStore.selectDam(dam.id)}
              >
                <div className="card-list-item__head">
                  <span>{dam.name}</span>
                  <Tag color="blue">{dam.grade}</Tag>
                </div>
                <div className="card-list-item__meta">
                  <span>{dam.damType}</span>
                  <span>· 最终坝高 {formatHeight(dam.finalHeightM)}</span>
                  <span>· 投运 {dam.commissionDate || '—'}</span>
                </div>
                <div className="card-list-item__meta">
                  <span>断面 {damStore.sectionsOfDam(dam.id).length}</span>
                  <span>· 测点 {pointCountOf(dam.id)}</span>
                  <span style={{ color: openAlarmCountOf(dam.id) > 0 ? '#b03a2e' : undefined }}>
                    · 未闭环预警 {openAlarmCountOf(dam.id)}
                  </span>
                </div>
                <div className="card-list-item__meta" style={{ gap: 8 }}>
                  <Button type="link" size="small" onClick={(event) => { event.stopPropagation(); openEditDam(dam) }}>
                    编辑
                  </Button>
                  <Popconfirm title="删除坝体会级联删除断面、测点、观测与预警" onConfirm={() => removeDam(dam)}>
                    <Button type="link" size="small" danger onClick={(event) => event.stopPropagation()}>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title" style={{ margin: 0 }}>
              断面明细{currentDam ? ` · ${currentDam.name}` : ''}
            </h3>
            <span className="muted">共 {sections.length} 个断面</span>
          </div>
          {sections.length === 0 ? (
            <EmptyPanel
              title="该坝体暂无断面"
              description="按桩号录入断面后，可在断面下布设测点并配置阈值。"
              actionText="录入断面"
              onAction={openCreateSection}
              compact
            />
          ) : (
            <Table<Section> rowKey="id" size="small" bordered dataSource={sections} columns={sectionColumns} pagination={false} />
          )}
        </div>
      </div>

      <Modal
        open={damOpen}
        title={editingDamId ? '编辑坝体' : '新建坝体'}
        onCancel={() => setDamOpen(false)}
        onOk={submitDam}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={damForm} layout="vertical" initialValues={EMPTY_DAM_DRAFT}>
          <Form.Item name="name" label="坝体名称" rules={[{ required: true, message: '请填写坝体名称' }]}>
            <Input placeholder="如 尾矿库 A 坝" />
          </Form.Item>
          <Form.Item name="damType" label="坝型" rules={[{ required: true, message: '请选择坝型' }]}>
            <Select options={DAM_TYPES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="finalHeightM" label="最终坝高(m)" rules={[{ required: true, message: '请填写最终坝高' }]}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="grade" label="等别" rules={[{ required: true, message: '请选择等别' }]}>
            <Select options={DAM_GRADES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="commissionDate" label="投运日期" rules={[{ required: true, message: '请填写投运日期' }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={sectionOpen}
        title={editingSectionId ? '编辑断面' : '录入断面'}
        onCancel={() => setSectionOpen(false)}
        onOk={submitSection}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={sectionForm} layout="vertical" initialValues={EMPTY_SECTION_DRAFT}>
          <Form.Item label="所属坝体">
            <Input value={currentDam ? currentDam.name : ''} disabled />
          </Form.Item>
          <Form.Item name="stakeNo" label="桩号" rules={[{ required: true, message: '请填写桩号，如 0+120' }]}>
            <Input placeholder="0+120" />
          </Form.Item>
          <Form.Item name="slopeRatio" label="坡比" rules={[{ required: true, message: '请填写坡比（如 2.5 表示 1:2.5）' }]}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="elevationM" label="坝顶高程(m)" rules={[{ required: true, message: '请填写坝顶高程' }]}>
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
