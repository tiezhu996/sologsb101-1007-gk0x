/**
 * <EmptyPanel> 空数据引导与新建入口
 * 被全部列表页消费。
 */
import { Button, Empty, Space, Typography } from 'antd'
import type { ReactNode } from 'react'

export interface EmptyPanelProps {
  title: string
  description?: ReactNode
  actionText?: string
  onAction?: () => void
  secondaryText?: string
  onSecondary?: () => void
  /** 是否展示「生成样例数据」按钮 */
  showSeed?: boolean
  onSeed?: () => void
  compact?: boolean
}

export function EmptyPanel({
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
  showSeed = false,
  onSeed,
  compact = false
}: EmptyPanelProps) {
  return (
    <div
      style={{
        padding: compact ? '20px 12px' : '44px 24px',
        textAlign: 'center',
        background: '#fbfcfe',
        border: '1px dashed #dde5ee',
        borderRadius: 10
      }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        imageStyle={{ height: compact ? 40 : 58 }}
        description={
          <Space direction="vertical" size={2}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {title}
            </Typography.Text>
            {description ? (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {description}
              </Typography.Text>
            ) : null}
          </Space>
        }
      >
        {actionText || secondaryText || showSeed ? (
          <Space wrap>
            {actionText && onAction ? (
              <Button type="primary" onClick={onAction}>
                {actionText}
              </Button>
            ) : null}
            {secondaryText && onSecondary ? <Button onClick={onSecondary}>{secondaryText}</Button> : null}
            {showSeed && onSeed ? (
              <Button type="primary" ghost onClick={onSeed}>
                生成样例数据
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Empty>
    </div>
  )
}

export default EmptyPanel
