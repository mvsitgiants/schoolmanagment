import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Avatar, TONE } from '../../system'

// Small pieces the Live campus panels share: a teacher's presence as a coloured dot, a teacher with that dot on
// their avatar, and the order the presence states are listed in.

/** Presence state → tone. Green in, amber late / not in yet, red away, grey off or unknown. */
export const PRESENCE_TONE = {
  PRESENT: 'success', LATE: 'warning', NOT_IN_YET: 'warning', EXPECTED: 'neutral', ON_LEAVE: 'danger', ABSENT: 'danger', OFF: 'neutral', UNKNOWN: 'neutral',
}
/** The order teacher groups show in: who needs a decision first. */
export const PRESENCE_ORDER = ['ABSENT', 'ON_LEAVE', 'NOT_IN_YET', 'LATE', 'PRESENT', 'EXPECTED', 'OFF', 'UNKNOWN']

export const isAway = (state) => state === 'ABSENT' || state === 'ON_LEAVE'

export function PresenceDot({ state, size = 8, ring = false, className }) {
  const { t } = useTranslation('dashboard')
  if (!state) return null
  const tone = TONE[PRESENCE_TONE[state] ?? 'neutral']
  return (
    <span title={t(`dashboard.live.presence.${state}`)} aria-label={t(`dashboard.live.presence.${state}`)}
      className={clsx('inline-block shrink-0 rounded-full', tone.dot, ring && 'ring-2 ring-surface', state === 'PRESENT' && 'pulse-dot', className)}
      style={{ width: size, height: size }} />
  )
}

/** An avatar with the presence dot on its corner. */
export function PresenceAvatar({ name, state, size = 28 }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar name={name} size={size} soft />
      {state && <PresenceDot state={state} size={Math.max(7, Math.round(size / 3.2))} ring className="absolute -bottom-0.5 -end-0.5" />}
    </span>
  )
}

/** Time "HH:MM" → minutes, for widths along the school day. */
export const toMin = (hhmm) => { const [h, m] = String(hhmm ?? '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
