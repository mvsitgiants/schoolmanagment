import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18n from '../../../i18n'
import { fetchChatChannels } from '../../../api/comms'
import { hasPermission } from '../../../api/auth'
import useAuthUser from '../../../hooks/useAuthUser'
import { useRealtime, useRealtimeEvent } from '../../../context/RealtimeContext'
import { playPop } from '../ringer'
import { CHANNELS_KEY, channelKey, isLooking, mentionsMe, openDock, patchChannel, sortChannels, unreadTotal } from './chatStore'
import { updateBadgeSource, flashTabNotification } from '../../../utils/tabBadge'

// The live keeper of the chat list (mounted once, by the floating Call / Chat dock): new
// messages bump unread counts and previews, a read on another device clears them, a changed
// membership reloads the list. While the tab is in the background a message that should
// alert (a direct message, an @mention, a group set to "all") pops and raises a browser
// notification — never for a muted chat unless it names you.

function shouldAlert(channel, message, me) {
  if (!channel || message.kind !== 'TEXT' || message.senderId === me) return false
  const prefs = channel.me ?? {}
  if (prefs.notify === 'NONE') return false
  const named = (message.mentions ?? []).includes(me)
  if (named) return true
  if (prefs.muted) return false
  if (message.mentionChannel) return true
  if (prefs.notify === 'MENTIONS') return false
  return channel.type === 'DIRECT' || channel.type === 'GROUP'
}

function systemNotify(channel, message) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const t = i18n.t
    const title = channel.type === 'DIRECT' ? message.senderName : `${message.senderName} · ${channel.name}`
    const body = message.text || (message.attachments?.length ? t('comms:notifySentAttachment') : message.student ? t('comms:notifyStudent', { name: message.student.display }) : t('comms:notifyNewMessage'))
    const n = new Notification(title, { body: body.slice(0, 160), tag: `chat-${channel.id}`, renotify: true })
    n.onclick = () => { window.focus(); openDock({ tab: 'chat', channelId: channel.id }); n.close() }
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}

/** Keeps the chat list live; returns { allowed, data, unread }. */
export default function useChatKeeper() {
  const me = useAuthUser()?.user?.id
  const allowed = hasPermission('comms.chat.view')
  const qc = useQueryClient()
  const { connected } = useRealtime()
  const { data } = useQuery({ queryKey: CHANNELS_KEY, queryFn: fetchChatChannels, enabled: allowed && !!me, staleTime: 30_000, refetchInterval: 120_000 })
  const wasConnected = useRef(connected)

  // back online: the list may have missed messages
  useEffect(() => {
    if (connected && !wasConnected.current && allowed) qc.invalidateQueries({ queryKey: CHANNELS_KEY })
    wasConnected.current = connected
  }, [connected, allowed, qc])

  useRealtimeEvent('chat:message', ({ channelId, message, preview } = {}) => {
    if (!allowed || !message) return
    const looking = isLooking(channelId)
    const mine = message.senderId === me
    const counts = message.kind === 'TEXT' && !mine && !looking
    let channel = null
    const found = patchChannel(qc, channelId, (c) => {
      channel = c
      return {
        lastMessage: { id: message.id, at: message.createdAt, senderId: message.senderId, senderName: message.senderName, preview: preview ?? message.text },
        lastMessageAt: message.createdAt,
        unread: counts ? (c.unread ?? 0) + 1 : mine ? 0 : c.unread,
        unreadMentions: counts && mentionsMe(message, me) ? (c.unreadMentions ?? 0) + 1 : mine ? 0 : c.unreadMentions,
      }
    })
    if (!found) { qc.invalidateQueries({ queryKey: CHANNELS_KEY }); return }
    sortChannels(qc)
    if (document.hidden && shouldAlert(channel, message, me)) {
      playPop()
      systemNotify(channel, message)
      flashTabNotification(`💬 ${message.senderName || i18n.t('comms:chatTitle')}: ${message.text || i18n.t('comms:notifyNewMessage')}`)
    }
  })

  useRealtimeEvent('chat:updated', ({ channelId, message } = {}) => {
    if (!message?.deleted) return
    patchChannel(qc, channelId, (c) => (c.lastMessage?.id === message.id ? { lastMessage: { ...c.lastMessage, preview: i18n.t('comms:chatMessageRemoved') } } : {}))
  })

  useRealtimeEvent('chat:read', ({ channelId, userId, lastReadAt } = {}) => {
    if (userId !== me) return
    patchChannel(qc, channelId, (c) => ({ unread: 0, unreadMentions: 0, me: c.me ? { ...c.me, lastReadAt } : c.me }))
  })

  useRealtimeEvent('chat:channel', ({ channelId } = {}) => {
    if (!allowed) return
    qc.invalidateQueries({ queryKey: CHANNELS_KEY })
    if (channelId) qc.invalidateQueries({ queryKey: channelKey(channelId) })
  })

  const unread = allowed ? unreadTotal(data?.channels) : 0

  useEffect(() => {
    updateBadgeSource('chat', unread)
  }, [unread])

  return { allowed, data, unread }
}
