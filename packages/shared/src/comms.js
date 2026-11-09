// Staff chat & call bell (module `comms`): calls & emergency alerts (paging) and staff chat. Ported from the
// hospital product. Product defaults live here; an institution renames / recolours alerts in
// Staff chat & call bell › Emergency alerts.

/**
 * Every signed-in staff member can call and chat, whatever their roles say — like My workspace,
 * these aren't something a custom role should be able to forget. Codes (`broadcast`), chat
 * moderation (`manage`), the call log export and code setup stay role-based.
 */

/** How urgent a call is. CODE needs `comms.calls.broadcast` and never closes on its own. */
export const PAGE_PRIORITIES = [
  { value: 'ROUTINE', label: 'Normal', tone: 'neutral' },
  { value: 'URGENT', label: 'Urgent', tone: 'warning' },
  { value: 'CODE', label: 'Emergency alert', tone: 'danger' },
]
export const PAGE_PRIORITY_BY = Object.fromEntries(PAGE_PRIORITIES.map((p) => [p.value, p]))

/** Who a call rings. Resolved to people when it is sent (and again on escalation). */
export const PAGE_TARGET_TYPES = [
  { value: 'USER', label: 'A person' },
  { value: 'ROLE', label: 'Everyone in a role' },
  { value: 'DEPARTMENT', label: 'A department' },
  { value: 'EVERYONE', label: 'Everyone (whole campus)', broadcast: true },
]
export const PAGE_TARGET_LABEL = Object.fromEntries(PAGE_TARGET_TYPES.map((t) => [t.value, t.label]))

/**
 * Campus emergency alerts. `color` is the swatch on the incoming screen and the log; labels, meanings and
 * colours are editable per institution (Staff chat & call bell › Emergency alerts).
 */
export const PAGE_CODES = [
  { code: 'LOCKDOWN', label: 'Lockdown', meaning: 'Threat on campus — lock doors, keep students inside', color: '#111827' },
  { code: 'FIRE', label: 'Fire evacuation', meaning: 'Fire — evacuate to the assembly point', color: '#DC2626' },
  { code: 'MEDICAL', label: 'Medical emergency', meaning: 'A student or staff member needs urgent medical help', color: '#1D4ED8' },
  { code: 'MISSING', label: 'Missing child', meaning: 'A student cannot be found — check gates and rooms', color: '#DB2777' },
  { code: 'INTRUDER', label: 'Intruder', meaning: 'Unknown or aggressive person on campus', color: '#6B7280' },
  { code: 'QUAKE', label: 'Earthquake / disaster', meaning: 'Drop, cover, hold — then evacuate', color: '#CA8A04' },
]
export const PAGE_CODE_BY = Object.fromEntries(PAGE_CODES.map((c) => [c.code, c]))

export const PAGE_CALL_STATUSES = {
  ACTIVE: { label: 'Active', tone: 'info' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  ALL_CLEAR: { label: 'All clear', tone: 'success' },
  EXPIRED: { label: 'Closed (no answer)', tone: 'warning' },
}

/** One person's answer to a call. */
export const PAGE_RECIPIENT_STATUSES = {
  RINGING: { label: 'Ringing', tone: 'warning' },
  ACKNOWLEDGED: { label: 'On the way', tone: 'success' },
  BUSY: { label: 'Busy', tone: 'danger' },
  MISSED: { label: 'Missed', tone: 'neutral' },
}

/** ETA chips on the incoming screen (minutes). */
export const PAGE_ETAS = [2, 5, 10, 15]

/** One-tap reasons for "Busy". */
export const PAGE_BUSY_REASONS = ['In class', 'In a meeting', 'On exam duty', 'Off campus', 'Ask someone else']

/** Who an unanswered routine / urgent call escalates to, in order. */
export const PAGE_ESCALATION_TARGETS = [
  { value: 'DEPARTMENT_HEAD', label: 'Head of the department' },
  { value: 'DEPARTMENT', label: 'The whole department' },
]
export const PAGE_CODE_ESCALATION_TARGETS = [
  { value: 'EVERYONE', label: 'Everyone on the campus' },
  { value: 'DEPARTMENT', label: 'The whole department' },
  { value: 'NONE', label: 'Do not escalate (keep ringing)' },
]

/** Seconds → "1 min 20 s" (response-time columns). */
export function formatSeconds(s) {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '—'
  const n = Math.max(0, Math.round(Number(s)))
  if (n < 60) return `${n} s`
  const m = Math.floor(n / 60)
  const r = n % 60
  return r ? `${m} min ${r} s` : `${m} min`
}

/** Merge an institution's own alert rows over the product defaults. */
export function mergePageCodes(rows = []) {
  const own = new Map(rows.map((r) => [r.code, r]))
  return PAGE_CODES.map((d) => {
    const o = own.get(d.code)
    return {
      code: d.code,
      label: o?.label || d.label,
      meaning: o?.meaning || d.meaning,
      color: o?.color || d.color,
      enabled: o?.enabled ?? true,
      customised: !!o,
      defaults: { label: d.label, meaning: d.meaning, color: d.color },
    }
  })
}

// ───────────────────────────────────────────────────────── staff chat

/**
 * Chat channel types. INSTITUTION (the whole staff room of a campus) and DEPARTMENT are automatic: who is in
 * them follows the users' campus and department (and their Staff & HR record). GROUP is made by a member of
 * staff; DIRECT is two people, created with the first message.
 */
export const CHAT_CHANNEL_TYPES = [
  { value: 'INSTITUTION', label: 'Whole staff', auto: true },
  { value: 'DEPARTMENT', label: 'Department', auto: true },
  { value: 'GROUP', label: 'Group' },
  { value: 'DIRECT', label: 'Direct message' },
]
export const CHAT_CHANNEL_TYPE_BY = Object.fromEntries(CHAT_CHANNEL_TYPES.map((t) => [t.value, t]))
export const CHAT_AUTO_TYPES = CHAT_CHANNEL_TYPES.filter((t) => t.auto).map((t) => t.value)

/** A member's role in a group. Automatic channels and direct messages only have members. */
export const CHAT_MEMBER_ROLES = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MEMBER', label: 'Member' },
]

/** Which messages of a channel ring the bell (in-app notification) for a member. */
export const CHAT_NOTIFY_LEVELS = [
  { value: 'ALL', label: 'Direct messages and mentions' },
  { value: 'MENTIONS', label: 'Only @mentions' },
  { value: 'NONE', label: 'Nothing' },
]

export const CHAT_MESSAGE_MAX = 4000
export const CHAT_GROUP_NAME_MAX = 60
export const CHAT_GROUP_MAX_MEMBERS = 500
export const CHAT_ATTACHMENTS_MAX = 5
/** Own messages can be edited for this long. */
export const CHAT_EDIT_HOURS = 24
/** Read receipts ("Seen by") are kept for channels up to this size. */
export const CHAT_RECEIPTS_MAX_MEMBERS = 200
/** Reactions: a small fixed set. */
export const CHAT_REACTIONS = ['👍', '✅', '👀', '🙏', '❤️']

/** One-line preview of a message for the channel list and notifications. */
export function chatPreview(m, max = 120) {
  if (!m) return ''
  if (m.deleted?.at || m.deleted === true) return 'Message removed'
  const text = String(m.text ?? '').replace(/\s+/g, ' ').trim()
  const files = m.attachments?.length ?? 0
  const bits = [text || (m.student?.display ? `Student: ${m.student.display}` : ''), !text && files ? `${files} attachment${files > 1 ? 's' : ''}` : ''].filter(Boolean)
  const out = bits.join(' · ') || (files ? 'Attachment' : '')
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}
