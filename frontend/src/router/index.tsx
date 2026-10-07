/**
 * 路由表：/dams、/points、/observations、/trends、/alarms、/pool
 * 页面按路由懒加载，构建时自动分包。
 */
import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { Skeleton } from 'antd'
import App from '../App'

const DamList = lazy(() => import('../pages/DamList'))
const PointConfig = lazy(() => import('../pages/PointConfig'))
const ObservationEntry = lazy(() => import('../pages/ObservationEntry'))
const TrendBoard = lazy(() => import('../pages/TrendBoard'))
const AlarmBoard = lazy(() => import('../pages/AlarmBoard'))
const PoolLog = lazy(() => import('../pages/PoolLog'))

export const ROUTES = {
  dams: '/dams',
  points: '/points',
  observations: '/observations',
  trends: '/trends',
  alarms: '/alarms',
  pool: '/pool'
} as const

function RouteFallback() {
  return <Skeleton active paragraph={{ rows: 6 }} style={{ background: '#ffffff', padding: 16, borderRadius: 10 }} />
}

function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTES.dams} replace /> },
      { path: 'dams', element: withSuspense(<DamList />) },
      { path: 'points', element: withSuspense(<PointConfig />) },
      { path: 'observations', element: withSuspense(<ObservationEntry />) },
      { path: 'trends', element: withSuspense(<TrendBoard />) },
      { path: 'alarms', element: withSuspense(<AlarmBoard />) },
      { path: 'pool', element: withSuspense(<PoolLog />) },
      { path: '*', element: <Navigate to={ROUTES.dams} replace /> }
    ]
  }
]

export default appRoutes
