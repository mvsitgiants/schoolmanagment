import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, Bell, BellOff, Info, Loader2, MessagesSquare, Pin } from 'lucide-react'
import { CHAT_EDIT_HOURS, CHAT_RECEIPTS_MAX_MEMBERS } from '@schoolgiant/shared'
import { Avatar, EmptyState, useConfirm } from '../../system'
import {
  deleteChatMessageRest, editChatMessageRest, fetchChatChannel, fetchChatMessages, markChatReadRest, openDirectChat, pinChatMessageRest, reactChatMessageRest,
  sendChatMessageRest, sendDirectMessageRest, updateChatPrefs,
} from '../../../api/comms'
import { useFormat } from '../../../context/SettingsContext'
import { useRealtime, useRealtimeEvent } from '../../../context/RealtimeContext'
import { useSnackbar } from '../../../context/SnackbarContext'
import { ChannelAvatar } from './ChannelList'
import ChannelInfo from './ChannelInfo'
import Composer from './Composer'
import MessageItem from './MessageItem'
import { CHANNELS_KEY, channelKey, errText, newClientId, patchChannel, setActiveChat, setActiveVisible } from './chatStore'

const GROUP_GAP_MS = 5 * 60_000
const PAGE = 40

const sameDay = (a, b) => {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

function useDayLabel() {
  const { t } = useTranslation('comms')
  const { date } = useFormat()
  return (iso) => {
    const now = new Date()
    if (sameDay(iso, now)) return t('chatToday')
    if (sameDay(iso, now.getTime() - 86_400_000)) return t('chatYesterday')
    return date(iso)
  }
}

/** Merge server messages into the list (by id; a pending one by its clientId), oldest first. */
function merge(list, incoming) {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) {
    if (m.clientId && byId.has(m.clientId)) byId.delete(m.clientId)
    byId.set(m.id, { ...byId.get(m.id), ...m, pending: false, failed: false })
  }
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : 1))
}

/**
 * One chat: header, messages, composer. Used by the Chat page (two panes) and, with
 * `compact`, inside the floating dock (always a back arrow, tighter rows).
 */
export default function ChannelView({ channelId, draftPeer, listEntry, listMeta, me, meName, focusMessageId, compact, onBack, onCreated, onLeft }) {
  const { t } = useTranslation('comms')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError } = useSnackbar()
  const { connected, emit, isOnline } = useRealtime()
  const dayLabel = useDayLabel()
  const scroller = useRef(null)
  const restore = useRef(null) // { height, top } while prepending older messages
  const stickBottom = useRef(true)
  const lastMarked = useRef(null)
  const lastTyping = useRef(0)
  const wasConnected = useRef(connected)
  const presenceTimer = useRef(null)

  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [typers, setTypers] = useState({}) // userId → { name, until }
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0)
  const [info, setInfo] = useState({ open: false, tab: 'settings' })
  const [unreadFrom, setUnreadFrom] = useState(null) // my read pointer when the chat opened

  const { data: detail, error: detailError } = useQuery({ queryKey: channelKey(channelId), queryFn: () => fetchChatChannel(channelId), enabled: !!channelId, retry: 1 })
  const channel = detail ?? listEntry ?? null
  const isDirect = draftPeer ? true : channel?.type === 'DIRECT'

  /** Socket when connected, REST otherwise. */
  const act = useCallback((event, payload, rest) => (connected ? emit(event, payload, { timeout: 10_000 }) : rest()), [connected, emit])

  // ── open a chat: latest page, my read pointer for the "new messages" line
  useEffect(() => {
    setMessages([]); setHasMore(false); setReplyTo(null); setEditing(null); setSelectedId(null); setTypers({}); setNewBelow(0); setLoadError(null)
    setInfo((i) => ({ ...i, open: false }))
    lastMarked.current = null
    stickBottom.current = true
    if (!channelId) return undefined
    setUnreadFrom(listEntry?.me?.lastReadAt ?? null)
    let alive = true
    setLoading(true)
    fetchChatMessages(channelId, { limit: PAGE })
      .then((r) => { if (alive) { setMessages(r.messages); setHasMore(r.hasMore) } })
      .catch((e) => { if (alive) setLoadError(errText(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── tell the server which chat is on screen (no bell for it) — again after a reconnect
  useEffect(() => {
    const id = channelId || null
    setActiveChat(id)
    const report = () => {
      const visible = document.visibilityState === 'visible'
      setActiveVisible(visible)
      if (connected) emit('chat:focus', { channelId: visible ? id : null }).catch(() => {})
    }
    report()
    document.addEventListener('visibilitychange', report)
    return () => {
      document.removeEventListener('visibilitychange', report)
      setActiveChat(null)
      if (connected) emit('chat:focus', { channelId: null }).catch(() => {})
    }
  }, [channelId, connected, emit])

  // ── back online: fetch what was missed
  useEffect(() => {
    const was = wasConnected.current
    wasConnected.current = connected
    if (!connected || was || !channelId) return
    const last = [...messages].reverse().find((m) => !m.pending && !m.failed)
    const after = last?.cursor
    ;(after ? fetchChatMessages(channelId, { after, limit: 100 }) : fetchChatMessages(channelId, { limit: PAGE }))
      .then((r) => setMessages((xs) => merge(xs, r.messages)))
      .catch(() => {})
    qc.invalidateQueries({ queryKey: channelKey(channelId) })
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── scrolling: keep the bottom pinned, keep the place when older messages come in
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const loadOlder = useCallback(async () => {
    const el = scroller.current
    const first = messages.find((m) => m.cursor)
    if (!first || loadingOlder || !hasMore || !channelId) return null
    setLoadingOlder(true)
    try {
      const r = await fetchChatMessages(channelId, { before: first.cursor, limit: PAGE })
      if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop }
      stickBottom.current = false
      setMessages((xs) => merge(xs, r.messages))
      setHasMore(r.hasMore)
      return r.messages
    } catch (e) {
      showError(errText(e))
      return null
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, loadingOlder, hasMore, channelId, showError])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickBottom.current = bottom
    setAtBottom(bottom)
    if (bottom) setNewBelow(0)
    if (el.scrollTop < 120 && hasMore && !loadingOlder) loadOlder()
  }

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    stickBottom.current = true
    setNewBelow(0)
  }

  // ── read pointer: when I am at the bottom of a visible chat, the latest message is read
  useEffect(() => {
    if (!channelId || !atBottom || document.visibilityState !== 'visible') return
    const last = [...messages].reverse().find((m) => !m.pending && !m.failed && m.kind === 'TEXT')
    if (!last || last.id === lastMarked.current) return
    lastMarked.current = last.id
    if (last.senderId === me && listEntry && !listEntry.unread) return
    act('chat:read', { channelId, messageId: last.id }, () => markChatReadRest(channelId, last.id)).catch(() => {})
    patchChannel(qc, channelId, () => ({ unread: 0, unreadMentions: 0 }))
  }, [messages, atBottom, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── live events for this chat
  useRealtimeEvent('chat:message', ({ channelId: cid, message } = {}) => {
    if (cid !== channelId || !message) return
    setMessages((xs) => merge(xs, [message]))
    setTypers((ty) => { if (!ty[message.senderId]) return ty; const n = { ...ty }; delete n[message.senderId]; return n })
    if (!stickBottom.current && message.senderId !== me) setNewBelow((n) => n + 1)
    if (message.senderId === me) stickBottom.current = true
  })
  useRealtimeEvent('chat:updated', ({ channelId: cid, message } = {}) => {
    if (cid !== channelId || !message) return
    const before = messages.find((m) => m.id === message.id)
    setMessages((xs) => xs.map((m) => (m.id === message.id ? { ...m, ...message } : m)))
    if (!!before?.pinned !== !!message.pinned || (message.deleted && before?.pinned)) qc.invalidateQueries({ queryKey: channelKey(channelId) })
  })
  useRealtimeEvent('chat:read', ({ channelId: cid, userId, name, lastReadAt, lastReadMessageId } = {}) => {
    if (cid !== channelId || userId === me) return
    qc.setQueryData(channelKey(channelId), (prev) => {
      if (!prev?.readStates) return prev
      const exists = prev.readStates.some((r) => r.userId === userId)
      const readStates = exists
        ? prev.readStates.map((r) => (r.userId === userId ? { ...r, lastReadAt, lastReadMessageId } : r))
        : [...prev.readStates, { userId, name, lastReadAt, lastReadMessageId }]
      return { ...prev, readStates }
    })
  })
  // who is online, live: small chats count their members' presence here; a big one re-reads
  // its count from the server, at most every 15 s while presence keeps changing
  const smallChat = !!detail && (detail.memberCount ?? 0) <= CHAT_RECEIPTS_MAX_MEMBERS
  useRealtimeEvent('presence:changed', () => {
    if (!channelId || isDirect || !detail || smallChat || presenceTimer.current) return
    presenceTimer.current = setTimeout(() => { presenceTimer.current = null; qc.invalidateQueries({ queryKey: channelKey(channelId) }) }, 15_000)
  })
  useEffect(() => () => { clearTimeout(presenceTimer.current); presenceTimer.current = null }, [channelId])

  useRealtimeEvent('chat:typing', ({ channelId: cid, userId, name } = {}) => {
    if (cid !== channelId || userId === me) return
    setTypers((ty) => ({ ...ty, [userId]: { name, until: Date.now() + 4500 } }))
  })
  useEffect(() => {
    if (!Object.keys(typers).length) return undefined
    const timer = setInterval(() => setTypers((ty) => {
      const now = Date.now()
      const next = Object.fromEntries(Object.entries(ty).filter(([, v]) => v.until > now))
      return Object.keys(next).length === Object.keys(ty).length ? ty : next
    }), 1000)
    return () => clearInterval(timer)
  }, [typers])

  const onTyping = useCallback(() => {
    if (!channelId || !connected) return
    const now = Date.now()
    if (now - lastTyping.current < 3000) return
    lastTyping.current = now
    emit('chat:typing', { channelId }).catch(() => {})
  }, [channelId, connected, emit])

  // ── jump to a message (reply quote, pinned, search result), loading older pages if needed
  const jumpTo = useCallback(async (id) => {
    let found = messages.some((m) => m.id === id)
    let pages = 0
    let cursor = messages.find((m) => m.cursor)?.cursor
    let more = hasMore
    while (!found && more && cursor && pages < 15) {
      try {
        const r = await fetchChatMessages(channelId, { before: cursor, limit: 100 })
        stickBottom.current = false
        setMessages((xs) => merge(xs, r.messages))
        setHasMore(r.hasMore)
        more = r.hasMore
        cursor = r.messages[0]?.cursor
        found = r.messages.some((m) => m.id === id)
        pages++
      } catch { break }
    }
    if (!found) { showError(t('chatViewMessageGone')); return }
    stickBottom.current = false
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlightId(id)
      setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 2200)
    }))
  }, [messages, hasMore, channelId, showError, t])

  const jumpedFor = useRef(null)
  useEffect(() => {
    if (!focusMessageId || loading || !messages.length || jumpedFor.current === `${channelId}:${focusMessageId}`) return
    jumpedFor.current = `${channelId}:${focusMessageId}`
    jumpTo(focusMessageId)
  }, [focusMessageId, loading, messages.length, channelId, jumpTo])

  // ── send / edit / remove / react / pin
  const send = async (draft, retry) => {
    const clientId = retry?.clientId ?? newClientId()
    const optimistic = retry ?? {
      id: clientId, clientId, kind: 'TEXT', pending: true, senderId: me, senderName: meName, createdAt: new Date().toISOString(),
      text: draft.text, mentions: draft.mentions, mentionNames: draft.mentionNames, attachments: draft.attachments, student: draft.student ?? null,
      replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName, preview: replyTo.text?.slice(0, 140) || t('chatAttachment') } : null, reactions: [],
      payload: { text: draft.text, mentions: draft.mentions, mentionChannel: draft.mentionChannel, attachmentIds: draft.attachmentIds, studentId: draft.studentId, replyToId: replyTo?.id },
    }
    stickBottom.current = true
    setMessages((xs) => [...xs.filter((m) => m.id !== clientId), { ...optimistic, pending: true, failed: false }])
    setReplyTo(null)
    const body = { clientId, ...optimistic.payload }
    Object.keys(body).forEach((k) => (body[k] === undefined || body[k] === null) && delete body[k])
    try {
      const out = draftPeer
        ? await act('chat:send', { ...body, toUserId: draftPeer.id }, () => sendDirectMessageRest(draftPeer.id, body))
        : await act('chat:send', { ...body, channelId }, () => sendChatMessageRest(channelId, body))
      setMessages((xs) => merge(xs, [out]))
      if (draftPeer) { qc.invalidateQueries({ queryKey: CHANNELS_KEY }); onCreated(out.channelId) }
    } catch (e) {
      setMessages((xs) => xs.map((m) => (m.id === clientId ? { ...m, pending: false, failed: true } : m)))
      showError(errText(e))
    }
  }

  // a file for a direct chat that has no messages yet: make the chat first (it opens as
  // itself once the message is sent)
  const ensureDirect = async () => {
    const c = await openDirectChat(draftPeer.id)
    qc.setQueryData(channelKey(c.id), c)
    qc.invalidateQueries({ queryKey: CHANNELS_KEY })
    return c.id
  }

  const saveEdit = async (m, text, mentions) => {
    setEditing(null)
    if (text === m.text) return
    try {
      const out = await act('chat:edit', { id: m.id, text, mentions }, () => editChatMessageRest(m.id, text, mentions))
      setMessages((xs) => merge(xs, [out]))
    } catch (e) { showError(errText(e)) }
  }

  const remove = useCallback(async (m) => {
    const own = m.senderId === me
    if (!(await confirm({ title: t('chatViewRemoveTitle'), message: own ? t('chatViewRemoveOwnMessage') : t('chatViewRemoveOtherMessage', { name: m.senderName }), tone: 'danger', confirmLabel: t('chatViewRemove') }))) return
    try {
      const out = await act('chat:delete', { id: m.id }, () => deleteChatMessageRest(m.id))
      setMessages((xs) => merge(xs, [out]))
    } catch (e) { showError(errText(e)) }
  }, [me, confirm, act, showError, t])

  const react = useCallback(async (m, emoji) => {
    try {
      const out = await act('chat:react', { id: m.id, emoji }, () => reactChatMessageRest(m.id, emoji))
      setMessages((xs) => merge(xs, [out]))
    } catch (e) { showError(errText(e)) }
  }, [act, showError])

  const pin = useCallback(async (m) => {
    try {
      const out = await act('chat:pin', { id: m.id, pinned: !m.pinned }, () => pinChatMessageRest(m.id, !m.pinned))
      setMessages((xs) => merge(xs, [out]))
      qc.invalidateQueries({ queryKey: channelKey(channelId) })
    } catch (e) { showError(errText(e)) }
  }, [act, showError, qc, channelId])

  const editLast = () => {
    const m = [...messages].reverse().find((x) => x.senderId === me && x.kind === 'TEXT' && !x.deleted && !x.pending && !x.failed)
    if (m && Date.now() - new Date(m.createdAt) < CHAT_EDIT_HOURS * 3_600_000) { setReplyTo(null); setEditing(m) }
  }

  const toggleMute = async () => {
    try {
      const out = await updateChatPrefs(channelId, { muted: !channel?.me?.muted })
      qc.setQueryData(channelKey(channelId), out)
      patchChannel(qc, channelId, (c) => ({ me: { ...c.me, muted: out.me?.muted } }))
    } catch (e) { showError(errText(e)) }
  }

  // Esc lets go of a selected message (the drawer closes itself)
  useEffect(() => {
    if (!selectedId) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setSelectedId(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId])

  // ── receipts
  const readStates = detail?.readStates ?? []
  const receiptsOn = !!detail?.receipts
  const lastOwnId = useMemo(() => [...messages].reverse().find((m) => m.senderId === me && m.kind === 'TEXT' && !m.deleted && !m.pending)?.id, [messages, me])
  const receiptOf = (m) => {
    if (m.pending) return 'pending'
    if (m.failed) return 'failed'
    if (m.deleted) return null
    if (!receiptsOn || !readStates.length) return 'sent'
    const at = new Date(m.createdAt)
    return readStates.every((r) => r.lastReadAt && new Date(r.lastReadAt) >= at) ? 'seen' : 'sent'
  }
  const seenByOf = (m) => {
    if (m.id !== lastOwnId || !receiptsOn || isDirect) return null
    const at = new Date(m.createdAt)
    const names = readStates.filter((r) => r.lastReadAt && new Date(r.lastReadAt) >= at).map((r) => r.name)
    return names.length ? names : null
  }

  // ── header
  const title = draftPeer?.name ?? channel?.name ?? ''
  const typing = Object.values(typers).map((ty) => ty.name)
  const onlineCount = smallChat ? (detail.readStates ?? []).filter((r) => isOnline(r.userId)).length + 1 : detail?.onlineCount
  const typingNames = `${typing.slice(0, 2).join(', ')}${typing.length > 2 ? ` +${typing.length - 2}` : ''}`
  const subtitle = typing.length
    ? (typing.length > 1 ? t('chatViewTypingMany', { names: typingNames }) : t('chatViewTypingOne', { names: typingNames }))
    : isDirect
      ? ((draftPeer ? isOnline(draftPeer.id) : channel?.peer && isOnline(channel.peer.id)) ? t('online') : (draftPeer?.designation ?? channel?.peer?.designation ?? ''))
      : channel ? `${t('chatMemberCount', { count: channel.memberCount ?? 0 })}${onlineCount ? ` · ${t('chatViewOnlineCount', { n: onlineCount })}` : ''}` : ''
  const pinnedList = detail?.pinnedMessages ?? []
  const canPost = draftPeer ? !!listMeta?.canCreate : !!channel?.canPost
  const disabledReason = channel?.archived
    ? t('chatViewClosedReason')
    : channel?.type === 'INSTITUTION' && listMeta?.settings?.announcementsOnly ? t('chatViewAnnouncementsOnly') : t('chatViewReadOnlyRole')
  const canPin = (c) => !!c && (['DIRECT', 'GROUP'].includes(c.type) || c.canModerate)

  if (!channelId && !draftPeer) {
    return <div className="h-full flex items-center justify-center p-6"><EmptyState icon={MessagesSquare} title={t('chatViewPickTitle')} hint={t('chatViewPickHint')} className="w-full max-w-md" /></div>
  }
  if (detailError && !listEntry) {
    return (
      <div className="h-full flex flex-col">
        <div className={clsx('p-2', !compact && 'md:hidden')}><button type="button" onClick={onBack} className="h-9 px-2 rounded-md flex items-center gap-1 text-sm text-ink-muted hover:bg-bg"><ArrowLeft className="w-4 h-4" /> {t('chatViewChats')}</button></div>
        <div className="flex-1 flex items-center justify-center p-6"><EmptyState icon={MessagesSquare} title={t('chatViewUnavailableTitle')} hint={t('chatViewUnavailableHint')} className="w-full max-w-md" /></div>
      </div>
    )
  }

  // ── the list, with day separators, the "new messages" line and grouping by sender
  const rows = []
  let prev = null
  let dividerDone = !unreadFrom
  for (const m of messages) {
    const newDay = !prev || !sameDay(prev.createdAt, m.createdAt)
    if (newDay) rows.push(<div key={`d-${m.id}`} className="flex justify-center my-3"><span className="text-[11px] font-medium text-ink-muted bg-surface border border-border rounded-full px-3 py-0.5 shadow-card">{dayLabel(m.createdAt)}</span></div>)
    let divider = false
    if (!dividerDone && m.kind === 'TEXT' && m.senderId !== me && !m.pending && new Date(m.createdAt) > new Date(unreadFrom)) {
      dividerDone = true
      divider = true
      rows.push(<div key={`u-${m.id}`} className="flex items-center gap-2 my-2 px-4"><span className="flex-1 h-px bg-danger-200" /><span className="text-[11px] font-semibold text-danger-500 uppercase tracking-wide">{t('chatViewNewMessages')}</span><span className="flex-1 h-px bg-danger-200" /></div>)
    }
    const grouped = !!prev && !newDay && !divider && prev.kind === 'TEXT' && m.kind === 'TEXT' && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_GAP_MS
    rows.push(
      <MessageItem
        key={m.id} m={m} me={me} meName={meName} grouped={grouped}
        receipt={m.senderId === me ? receiptOf(m) : null} seenBy={m.senderId === me ? seenByOf(m) : null} compact={compact}
        canModerate={!!channel?.canModerate} canPin={canPin(channel)} canPost={canPost}
        selected={selectedId === m.id} highlighted={highlightId === m.id}
        onSelect={setSelectedId} onReply={(x) => { setEditing(null); setReplyTo(x) }} onEdit={(x) => { setReplyTo(null); setEditing(x) }}
        onDelete={remove} onReact={react} onPin={pin} onRetry={(x) => send(null, x)} onJump={jumpTo}
      />,
    )
    prev = m
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header */}
      <div className={clsx('shrink-0 border-b border-border flex items-center bg-surface', compact ? 'h-12 gap-1.5 px-1.5' : 'h-14 gap-2 px-2 sm:px-3')}>
        <button type="button" onClick={onBack} aria-label={t('chatViewBackToChats')} className={clsx('w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg', !compact && 'md:hidden')}><ArrowLeft className="w-5 h-5" /></button>
        {draftPeer ? <Avatar name={draftPeer.name} size={compact ? 32 : 36} /> : channel && <ChannelAvatar channel={channel} size={compact ? 32 : 36} />}
        <button type="button" disabled={!channelId} onClick={() => setInfo({ open: true, tab: channel?.type === 'DIRECT' ? 'settings' : 'members' })} className="min-w-0 flex-1 text-start">
          <span className="block text-sm font-semibold text-ink truncate">{title}</span>
          <span className={clsx('block text-xs truncate', typing.length ? 'text-brand-600' : 'text-ink-muted')}>{subtitle}</span>
        </button>
        {channelId && (
          <>
            {pinnedList.length > 0 && (
              <button type="button" title={t('chatViewPinnedMessages')} onClick={() => setInfo({ open: true, tab: 'pinned' })} className="h-9 px-2 rounded-md flex items-center gap-1 text-ink-muted hover:bg-bg hover:text-ink text-xs">
                <Pin className="w-4 h-4" />{pinnedList.length}
              </button>
            )}
            <button type="button" title={channel?.me?.muted ? t('chatViewUnmute') : t('chatViewMute')} aria-label={channel?.me?.muted ? t('chatViewUnmute') : t('chatViewMute')} onClick={toggleMute} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink">
              {channel?.me?.muted ? <BellOff className="w-[18px] h-[18px]" /> : <Bell className="w-[18px] h-[18px]" />}
            </button>
            <button type="button" title={t('chatViewInfo')} aria-label={t('chatViewInfo')} onClick={() => setInfo((i) => ({ open: true, tab: i.tab }))} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><Info className="w-[18px] h-[18px]" /></button>
          </>
        )}
      </div>

      {pinnedList[0] && (
        <button type="button" onClick={() => jumpTo(pinnedList[0].id)} className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-1.5 border-b border-border bg-brand-50/60 text-start">
          <Pin className="w-3.5 h-3.5 text-brand-600 shrink-0" />
          <span className="min-w-0 text-xs text-ink truncate"><span className="font-medium">{pinnedList[0].senderName}:</span> {pinnedList[0].text || pinnedList[0].student?.display || t('chatAttachment')}</span>
        </button>
      )}

      {/* messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto scroll-thin bg-bg pb-3">
          {loadingOlder && <p className="py-2 text-center text-xs text-ink-muted flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('chatViewEarlier')}</p>}
          {!hasMore && !loading && messages.length > 0 && <p className="pt-4 pb-1 text-center text-[11px] text-ink-faint">{t('chatViewStart')}</p>}
          {loading && <p className="py-10 text-center text-sm text-ink-muted flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('chatViewLoadingMessages')}</p>}
          {loadError && <p className="py-10 text-center text-sm text-danger-500">{loadError}</p>}
          {!loading && !loadError && !messages.length && (
            <div className="py-16 px-6 text-center">
              <MessagesSquare className="w-6 h-6 mx-auto mb-2 text-ink-faint" />
              <p className="text-sm font-medium text-ink">{draftPeer ? t('chatViewStartWith', { name: draftPeer.name }) : t('chatViewNoMessages')}</p>
              <p className="text-xs text-ink-muted mt-1">{draftPeer ? t('chatViewCreatedOnSend') : t('chatViewSayHello')}</p>
            </div>
          )}
          {rows}
        </div>
        {!atBottom && (
          <button type="button" onClick={toBottom} className="absolute end-4 bottom-4 h-9 ps-3 pe-3.5 rounded-full bg-surface border border-border shadow-pop text-xs font-medium text-ink flex items-center gap-1.5 hover:bg-bg">
            <ArrowDown className="w-4 h-4" />{newBelow > 0 ? t('chatViewNewCount', { n: newBelow }) : t('chatViewLatest')}
          </button>
        )}
      </div>

      <Composer
        channelId={channelId} draftKey={draftPeer ? `to:${draftPeer.id}` : channelId} ensureChannel={draftPeer ? ensureDirect : undefined} canPost={canPost} disabledReason={disabledReason} isDirect={isDirect}
        canModerate={!!channel?.canModerate} canAttachStudent={!!listMeta?.canAttachStudent}
        replyTo={replyTo} editing={editing}
        onCancelReply={() => setReplyTo(null)} onCancelEdit={() => setEditing(null)}
        onSend={(d) => send(d)} onSaveEdit={saveEdit} onTyping={onTyping} onEditLast={editLast}
      />

      {channelId && detail && (
        <ChannelInfo open={info.open} tab={info.tab} onTab={(tab) => setInfo((i) => ({ ...i, tab }))} onClose={() => setInfo((i) => ({ ...i, open: false }))}
          channel={detail} me={me} onJump={jumpTo} onUnpin={pin} onLeft={onLeft} />
      )}
    </div>
  )
}
