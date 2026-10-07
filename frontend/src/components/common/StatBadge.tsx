/**
 * <StatBadge> 测点计数、越限占比徽标
 * 被坝体台账、速率计算页消费。
 */
import { Progress, Tooltip } from 'antd'

export type BadgeTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface StatBadgeProps {
  label: string
  value: number | string
  suffix?: string
  /** 占比 0-100，传入后渲染进度条并以百分比展示数值 */
  percent?: number
  tone?: BadgeTone
  /** 悬浮说明 */
  hint?: string
}

const TONE_COLOR: Record<BadgeTone, string> = {
  default: '#6b7a8d',
  primary: '#1f5c99',
  success: '#2f7a4f',
  warning: '#c9963c',
  danger: '#b03a2e',
  info: '#3f6fa8'
}

export function StatBadge({ label, value, suffix = '', percent, tone = 'default', hint }: StatBadgeProps) {
  const color = TONE_COLOR[tone]
  const display = percent === undefined ? value : `${percent}%`

  const body = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 140,
        padding: '12px 14px',
        background: '#ffffff',
        border: '1px solid #dde5ee',
        borderLeft: `4px solid ${color}`,
        borderRadius: 10
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7a8d', fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#1b2a3a', fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </span>
        {suffix ? <span style={{ fontSize: 12, color: '#6b7a8d' }}>{suffix}</span> : null}
      </div>
      {percent === undefined ? null : (
        <Progress percent={Math.min(100, Math.max(0, percent))} strokeColor={color} showInfo={false} size="small" />
      )}
    </div>
  )

  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body
}

export default StatBadge
