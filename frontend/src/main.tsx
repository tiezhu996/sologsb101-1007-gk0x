import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './styles/main.css'
import { appRoutes } from './router'
import { initDatabase, stampDbVersion } from './utils/db'

const theme = {
  token: {
    colorPrimary: '#1f5c99',
    colorInfo: '#1f5c99',
    colorSuccess: '#2f7a4f',
    colorWarning: '#c9963c',
    colorError: '#b03a2e',
    colorTextBase: '#1b2a3a',
    borderRadius: 8
  },
  components: {
    Layout: { headerBg: '#ffffff', bodyBg: '#f2f5f9' },
    Card: { headerBg: '#f7fafd' },
    Table: { headerBg: '#f2f6fa' }
  }
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('未找到 #root 挂载节点')
}

const router = createBrowserRouter(appRoutes)

stampDbVersion()

// 首屏先完成 IndexedDB 打开与演示数据播种，再渲染应用，避免列表页空窗
void initDatabase()
  .catch((error: unknown) => {
    console.error('本地数据库初始化失败', error)
  })
  .finally(() => {
    ReactDOM.createRoot(container).render(
      <React.StrictMode>
        <ConfigProvider locale={zhCN} theme={theme}>
          <AntdApp>
            <RouterProvider router={router} />
          </AntdApp>
        </ConfigProvider>
      </React.StrictMode>
    )
  })
