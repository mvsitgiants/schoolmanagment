import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BellRing, Bell } from 'lucide-react'
import i18n from '../../i18n'
import { PAGE_CALL_STATUSES, PAGE_PRIORITY_BY, PAGE_RECIPIENT_STATUSES } from '@schoolgiant/shared'
import { StatusPill } from '../system'
import { respondToCall } from '../../api/comms'

// Small pieces shared by the call composer, the incoming-call screen and the Call bell page.

export const errText = (e) => e?.response?.data?.message || e?.message || i18n.t('comms:somethingWrong')

/** "just now", "4 min", "2 h 5 min" since a time. */
export function sinceText(at, now = Date.now(), t = i18n.t) {
  if (!at) return ''
  const m = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000))
  if (m < 1) return t('comms:justNow')
  if (m < 60) return t('comms:minAgo', { m })
  const h = Math.floor(m / 60)
  return m % 60 ? t('comms:hourMinAgo', { h, m: m % 60 }) : t('comms:hourAgo', { h })
}

/** Seconds → "1 min 20 s" (response-time columns), in the UI language. */
export function secondsText(s, t = i18n.t) {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '—'
  const n = Math.max(0, Math.round(Number(s)))
  if (n < 60) return t('comms:secs', { s: n })
  const m = Math.floor(n / 60)
  const r = n % 60
  return r ? t('comms:minSecs', { m, s: r }) : t('comms:minAgo', { m })
}

/** A busy reason's key in comms.json (`busyReasons.in_class`). */
export const busyReasonKey = (r) => `comms:busyReasons.${String(r).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`

/** An alert's own colour as a dot. */
export function CodeSwatch({ color, className }) {
  return <span aria-hidden="true" className={clsx('inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-surface', className)} style={{ backgroundColor: color || 'currentColor' }} />
}

/** A colour tile for an alert (lists, pickers): the alert colour with a siren-ish icon. */
export function CodeTile({ color, size = 32, className }) {
  return (
    <span aria-hidden="true" className={clsx('shrink-0 rounded-lg flex items-center justify-center text-white shadow-sm', className)} style={{ width: size, height: size, backgroundColor: color || '#B42318' }}>
      <AlertTriangle style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  )
}

const PRIORITY_TILE = {
  ROUTINE: { cls: 'bg-brand-50 text-brand-700', icon: Bell },
  URGENT: { cls: 'bg-amber-50 text-amber-600', icon: BellRing },
}

/** The leading tile of a call row: the alert colour for an emergency, else a priority-tinted bell. */
export function CallTile({ call, size = 32 }) {
  if (call?.priority === 'CODE') return <CodeTile color={call.codeColor} size={size} />
  const p = PRIORITY_TILE[call?.priority] ?? PRIORITY_TILE.ROUTINE
  const Icon = p.icon
  return <span aria-hidden="true" className={clsx('shrink-0 rounded-lg flex items-center justify-center', p.cls)} style={{ width: size, height: size }}><Icon style={{ width: size * 0.5, height: size * 0.5 }} /></span>
}

/** Priority — or, for an emergency alert, the alert in its colour. */
export function PriorityPill({ call, className }) {
  const { t } = useTranslation('comms')
  if (call?.priority === 'CODE') {
    return (
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink', className)}>
        <CodeSwatch color={call.codeColor} /> {call.codeLabel || t('priorities.CODE')}
      </span>
    )
  }
  const p = PAGE_PRIORITY_BY[call?.priority]
  return <StatusPill tone={p?.tone ?? 'neutral'} className={className}>{p ? t(`priorities.${p.value}`) : call?.priority}</StatusPill>
}

export function CallStatusPill({ status }) {
  const { t } = useTranslation('comms')
  const s = PAGE_CALL_STATUSES[status]
  return <StatusPill tone={s?.tone ?? 'neutral'}>{s ? t(`callStatuses.${status}`) : status}</StatusPill>
}

export function RecipientStatusPill({ r }) {
  const { t } = useTranslation('comms')
  const s = PAGE_RECIPIENT_STATUSES[r?.status]
  const label = r?.status === 'ACKNOWLEDGED' && r.etaMinutes !== undefined && r.etaMinutes !== null
    ? t('onTheWayMinutes', { min: r.etaMinutes })
    : s ? t(`recipientStatuses.${r.status}`) : r?.status
  return <StatusPill tone={s?.tone ?? 'neutral'}>{label}</StatusPill>
}

/** "2 on the way · 1 busy · 3 ringing" */
export function answerSummary(counts = {}, t = i18n.t) {
  const parts = []
  if (counts.ACKNOWLEDGED) parts.push(t('comms:onTheWayCount', { count: counts.ACKNOWLEDGED }))
  if (counts.BUSY) parts.push(t('comms:busyCount', { count: counts.BUSY }))
  if (counts.RINGING) parts.push(t('comms:ringingCount', { count: counts.RINGING }))
  if (counts.MISSED) parts.push(t('comms:missedCount', { count: counts.MISSED }))
  return parts.join(' · ') || t('comms:nobodyYet')
}

/** Answer a call over the live connection when it is up, else over the API. */
export async function sendAnswer(realtime, id, body) {
  if (realtime?.connected) {
    try { return await realtime.emit('page:respond', { id, ...body }) } catch (e) { if (e?.code !== 'OFFLINE' && e?.code !== 'TIMEOUT') throw e }
  }
  return respondToCall(id, body)
}
