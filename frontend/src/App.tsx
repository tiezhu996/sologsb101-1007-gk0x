/**
 * 应用外壳：顶部导航 + 当前上下文摘要 + 页脚，页面通过 <Outlet> 渲染。
 */
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Layout, Space, Tag, Tooltip, Typography } from 'antd'
import { ROUTES } from './router'
import { useDamStore } from './stores/damStore'
import { usePointStore } from './stores/pointStore'
import { useAlarmStore } from './stores/alarmStore'
import { useIdbTable } from './hooks/useIdbTable'
import { db, type ObservationRow } from './utils/db'

const { Header, Content, Footer } = Layout

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const damStore = useDamStore()
  const pointStore = usePointStore()
  const alarmStore = useAlarmStore()
  const observationTable = useIdbTable<ObservationRow>(db.observations, { sortByUpdatedAt: false })

  const currentDam = damStore.currentDam()
  const openAlarms = alarmStore.alarms.filter((alarm) => alarm.state !== '已闭环').length

  const navItems = [
    { path: ROUTES.dams, label: '坝体台账', count: damStore.dams.length },
    { path: ROUTES.points, label: '测点配置', count: pointStore.points.length },
    { path: ROUTES.observations, label: '观测录入', count: observationTable.rows.length },
    { path: ROUTES.trends, label: '速率计算', count: pointStore.points.length },
    { path: ROUTES.alarms, label: '预警处置', count: openAlarms },
    { path: ROUTES.pool, label: '库水位', count: 0 }
  ]

  const activePath = navItems.find((item) => location.pathname.startsWith(item.path))?.path ?? ROUTES.dams

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark">坝</span>
          <div>
            <h1 className="app-header__title">尾矿库坝体位移与浸润线监测台</h1>
            <p className="app-header__sub">坝体 · 断面 · 测点 · 观测值 · 预警闭环 · 库水位干滩</p>
          </div>
        </div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`app-nav__item${activePath === item.path ? ' is-active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span>{item.label}</span>
              {item.count > 0 ? <em className="app-nav__badge">{item.count}</em> : null}
            </button>
          ))}
        </nav>
      </Header>

      <Content className="app-main">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <Space size={8} wrap>
            <Typography.Text strong>当前坝体：</Typography.Text>
            {currentDam ? (
              <>
                <Tag color="#1f5c99">{currentDam.name}</Tag>
                <Tag>{currentDam.damType}</Tag>
                <Tag color="gold">{currentDam.grade}</Tag>
              </>
            ) : (
              <Tag>未选择坝体</Tag>
            )}
          </Space>
          <Space size={8} wrap>
            <Tooltip title="未闭环预警数量">
              <Badge count={openAlarms} showZero color="#b03a2e" />
            </Tooltip>
            <Button size="small" onClick={() => navigate(ROUTES.dams)}>
              坝体台账
            </Button>
            <Button size="small" type="primary" onClick={() => navigate(ROUTES.alarms)}>
              预警处置
            </Button>
          </Space>
        </div>
        <Outlet />
      </Content>

      <Footer className="app-footer">
        <span>数据仅保存于本机浏览器（IndexedDB / localStorage），不上传任何服务器。</span>
        <span>
          坝体 {damStore.dams.length} 座 · 断面 {damStore.sections.length} 个 · 测点 {pointStore.points.length} 个 · 观测{' '}
          {observationTable.rows.length} 条 · 未闭环预警 {openAlarms} 张
        </span>
      </Footer>
    </Layout>
  )
}
