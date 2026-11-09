import i18n from '../../../i18n'

// Staff chat — what the chat screen, the header button and the floating Call / Chat dock share.
//
// The channel list lives in the react-query cache under CHANNELS_KEY. The dock (always
// mounted for staff) keeps it live from chat:* events (useChatKeeper), rings the "pop" and
// raises a browser notification; the chat screen and the header button read the same cache.
// The chat open on screen is kept here (setActiveChat) so a message in it is not counted as
// unread or notified.

export const CHANNELS_KEY = ['chat', 'channels']
export const channelKey = (id) => ['chat', 'channel', id]

let active = null // { id, visible }
export const setActiveChat = (id) => { active = id ? { id, visible: document.visibilityState === 'visible' } : null }
export const setActiveVisible = (visible) => { if (active) active.visible = visible }
/** Is this chat open on screen in a visible tab right now? */
export const isLooking = (id) => !!active && active.id === id && active.visible && document.visibilityState === 'visible'
export const activeChatId = () => active?.id ?? null

export const errText = (e) => e?.response?.data?.message || e?.message || i18n.t('comms:somethingWrong')

/** Unread total for the badge: muted chats count only their @mentions. */
export function unreadTotal(list) {
  return (list ?? []).reduce((n, c) => n + (c.me?.muted ? c.unreadMentions ?? 0 : c.unread ?? 0), 0)
}

/** Apply a change to one channel in the cached list. */
export function patchChannel(qc, id, fn) {
  let found = false
  qc.setQueryData(CHANNELS_KEY, (prev) => {
    if (!prev?.channels) return prev
    const channels = prev.channels.map((c) => {
      if (c.id !== id) return c
      found = true
      return { ...c, ...fn(c) }
    })
    return { ...prev, channels }
  })
  return found
}

/** Re-sort after a new message: pinned first, then newest. */
export function sortChannels(qc) {
  qc.setQueryData(CHANNELS_KEY, (prev) => {
    if (!prev?.channels) return prev
    const channels = [...prev.channels].sort((a, b) => Number(!!b.me?.pinned) - Number(!!a.me?.pinned) || new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    return { ...prev, channels }
  })
}

export const mentionsMe = (m, me) => !!m && (m.mentionChannel || (m.mentions ?? []).includes(me))

/** A system line ("Asha added Ravi") as text. */
export function systemText(m, t = i18n.t) {
  const s = m.system ?? {}
  const names = (s.names ?? []).join(', ')
  const actor = s.actorName ?? t('comms:someone')
  switch (s.action) {
    case 'CREATED': return names ? t('comms:sysCreatedWith', { actor, names }) : t('comms:sysCreated', { actor })
    case 'ADDED': return t('comms:sysAdded', { actor, names })
    case 'REMOVED': return t('comms:sysRemoved', { actor, names })
    case 'LEFT': return t('comms:sysLeft', { names: names || t('comms:someone') })
    case 'JOINED': return t('comms:sysJoined', { names: names || t('comms:someone') })
    case 'RENAMED': return t('comms:sysRenamed', { actor, names })
    default: return t('comms:sysUpdate')
  }
}

export const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export const fileSize = (n, t = i18n.t) => {
  if (!n && n !== 0) return ''
  if (n < 1024) return t('comms:sizeB', { n })
  if (n < 1024 * 1024) return t('comms:sizeKB', { n: Math.round(n / 1024) })
  return t('comms:sizeMB', { n: (n / (1024 * 1024)).toFixed(1) })
}

// ── unsent text, per chat: kept when the dock closes or you switch to another chat
const drafts = new Map()
export const getDraft = (key) => (key ? drafts.get(key) ?? '' : '')
export const setDraft = (key, text) => {
  if (!key) return
  if (text) drafts.set(key, text)
  else drafts.delete(key)
}

// ── open the floating Call / Chat dock from anywhere: openDock({ tab: 'chat', channelId })
export const DOCK_EVENT = 'hx:comms-dock'
export const openDock = (detail = {}) => window.dispatchEvent(new CustomEvent(DOCK_EVENT, { detail }))
