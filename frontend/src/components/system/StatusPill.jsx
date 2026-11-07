import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { TONE, statusTone } from './tokens'

/**
 * Dot + label status chip. Pass an explicit `tone`, or let it infer from the
 * text: <StatusPill>In Progress</StatusPill>.
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

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        toneStyle.bg, toneStyle.text, toneStyle.border, className,
      )}
    >
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', toneStyle.dot)} />}
      {content}
    </span>
  )
}

