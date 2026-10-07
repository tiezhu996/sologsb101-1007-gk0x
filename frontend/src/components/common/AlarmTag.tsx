/**
 * <AlarmTag> 按 蓝/黄/橙/红 渲染底色与图标
 * 被监测录入、预警处置两页消费。
 */
import type { CSSProperties } from 'react'
import { ALARM_BG, ALARM_COLOR } from '@/utils/threshold'
import type { AlarmLevel } from '@/types/alarm'

export interface AlarmTagProps {
  level: AlarmLevel
  /** 附加展示的触发值 */
  triggerValue?: number
  unit?: string
  size?: 'small' | 'default' | 'large'
  /** 是否展示颜色圆点 */
  dot?: boolean
}

const MARK: Record<AlarmLevel, string> = { 蓝: '蓝', 黄: '黄', 橙: '橙', 红: '红' }

const SIZE_STYLE: Record<'small' | 'default' | 'large', CSSProperties> = {
  small: { padding: '0 8px', fontSize: 12, lineHeight: '18px' },
  default: { padding: '2px 10px', fontSize: 13, lineHeight: '20px' },
  large: { padding: '4px 14px', fontSize: 15, lineHeight: '24px' }
}

export function AlarmTag({ level, triggerValue, unit = '', size = 'default', dot = true }: AlarmTagProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        border: `1px solid ${ALARM_COLOR[level]}`,
        backgroundColor: ALARM_BG[level],
        color: ALARM_COLOR[level],
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...SIZE_STYLE[size]
      }}
    >
      {dot ? (
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: ALARM_COLOR[level] }}
          aria-hidden
        />
      ) : null}
      <span>{MARK[level]}色预警</span>
      {triggerValue === undefined ? null : (
        <span style={{ fontWeight: 400, opacity: 0.9 }}>
          · {triggerValue.toFixed(2)}
          {unit ? ` ${unit}` : ''}
        </span>
      )}
    </span>
  )
}

export default AlarmTag
