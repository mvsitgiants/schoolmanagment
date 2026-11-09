import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { TONE, statusTone } from './tokens'

/**
 * Modern Dot + label status chip with pill shape, subtle border tint, and pulse effect.
 * Automatically localizes standard status strings if available in common:status.
 */
export default function StatusPill({ children, tone, dot = true, className }) {
  const { t } = useTranslation('common')
  const inferredTone = tone ?? statusTone(children)
  const toneStyle = TONE[inferredTone] ?? TONE.neutral

  let content = children
  if (typeof children === 'string') {
    const normKey = children.trim().toLowerCase().replace(/[\s-]+/g, '_')
    content = t(`status.${normKey}`, { defaultValue: children })
  }

  const isLive = inferredTone === 'success' || inferredTone === 'info'

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap shadow-sm tracking-tight',
        toneStyle.bg,
        toneStyle.text,
        toneStyle.border,
        className
      )}
    >
      {dot && (
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', toneStyle.dot, isLive && 'pulse-dot')} />
      )}
      {content}
    </span>
  )
}
