import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BellOff, Layers, Loader2, MessageSquarePlus, Pin, School, Settings2, Users, UsersRound } from 'lucide-react'
import { Avatar, SearchInput } from '../../system'
import { searchChat } from '../../../api/comms'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useFormat } from '../../../context/SettingsContext'
import { useRealtime } from '../../../context/RealtimeContext'

const SECTIONS = [
  { id: 'INSTITUTION', types: ['INSTITUTION'] },
  { id: 'DEPARTMENT', types: ['DEPARTMENT'] },
  { id: 'GROUP', types: ['GROUP'] },
  { id: 'DIRECT', types: ['DIRECT'] },
]
const TYPE_TILE = {
  INSTITUTION: { icon: School, cls: 'bg-brand-500 text-white' },
  DEPARTMENT: { icon: Layers, cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  GROUP: { icon: UsersRound, cls: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200' },
}

/** Avatar for a chat: the person for a direct chat, else a coloured icon tile. Online dot for people. */
export function ChannelAvatar({ channel, size = 40 }) {
  const { t } = useTranslation('comms')
  const { isOnline } = useRealtime()
  if (channel.type === 'DIRECT') {
    const online = channel.peer && isOnline(channel.peer.id)
    return (
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <Avatar name={channel.name} size={size} />
        {online && <span className="absolute bottom-0 end-0 w-3 h-3 rounded-full bg-success-500 ring-2 ring-surface" title={t('online')} />}
      </span>
    )
  }
  const tile = TYPE_TILE[channel.type] ?? { icon: Users, cls: 'bg-brand-50 text-brand-700' }
  const Icon = tile.icon
  return (
    <span className={clsx('shrink-0 rounded-xl flex items-center justify-center', tile.cls)} style={{ width: size, height: size }}>
      <Icon className="w-[45%] h-[45%]" />
    </span>
  )
}

export function useWhen() {
  const { t } = useTranslation('comms')
  const { time, date } = useFormat()
  return (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const today = new Date()
    if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) return time(iso)
    const y = new Date(today.getTime() - 86_400_000)
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return t('chatYesterday')
    return date(iso)
  }
}

export function ChannelRow({ c, active, me, onOpen }) {
  const { t } = useTranslation('comms')
  const when = useWhen()
  const last = c.lastMessage
  const youLabel = t('chatYou')
  const who = last && c.type !== 'DIRECT' && last.senderName ? `${last.senderId === me ? youLabel : last.senderName.split(' ')[0]}: ` : last?.senderId === me ? `${youLabel}: ` : ''
  const unread = c.me?.muted ? c.unreadMentions : c.unread
  return (
    <button type="button" onClick={() => onOpen(c)}
      className={clsx('w-full flex items-center gap-2.5 px-2.5 py-2 text-start rounded-lg transition-colors', active ? 'bg-brand-50' : 'hover:bg-bg')}>
      <ChannelAvatar channel={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={clsx('truncate text-sm', unread ? 'font-semibold text-ink' : 'font-medium text-ink')}>{c.name}</span>
          {c.me?.pinned && <Pin className="w-3 h-3 text-ink-faint shrink-0" aria-label={t('chatChannelInfoPinnedTab')} />}
          {c.me?.muted && <BellOff className="w-3 h-3 text-ink-faint shrink-0" aria-label={t('chatListMuted')} />}
          <span className={clsx('ms-auto text-[11px] shrink-0', unread ? 'text-brand-600 font-medium' : 'text-ink-faint')}>{when(last?.at ?? c.lastMessageAt)}</span>
        </span>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className={clsx('truncate text-xs', unread ? 'text-ink' : 'text-ink-muted')}>
            {c.archived ? t('closed') : last ? `${who}${last.preview || ''}` : c.type === 'DIRECT' ? (c.peer?.designation || t('chatListSayHello')) : t('chatMemberCount', { count: c.memberCount ?? 0 })}
          </span>
          {c.unreadMentions > 0 && <span className="ms-auto shrink-0 text-[11px] font-semibold text-brand-600">@</span>}
          {unread > 0 && (
            <span className={clsx('shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-[18px] text-center text-white', c.me?.muted ? 'bg-ink-faint' : 'bg-brand-500', c.unreadMentions > 0 ? '' : 'ms-auto')}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

export default function ChannelList({ data, loading, activeId, me, onOpen, onNewChat, onNewGroup, onSettings, onSearchResult }) {
  const { t } = useTranslation('comms')
  const [q, setQ] = useState('')
  const query = useDebouncedValue(q.trim(), 300)
  const channels = data?.channels ?? []
  const filtered = useMemo(() => {
    if (!q.trim()) return channels
    const needle = q.trim().toLowerCase()
    return channels.filter((c) => c.name?.toLowerCase().includes(needle) || c.peer?.designation?.toLowerCase().includes(needle))
  }, [channels, q])
  const { data: hits = [], isFetching } = useQuery({ queryKey: ['chat', 'search', query], queryFn: () => searchChat(query), enabled: query.length >= 2, staleTime: 15_000 })
  const when = useWhen()

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center gap-1">
          <h1 className="font-display text-base font-semibold text-ink flex-1">{t('chatTitle')}</h1>
          {data?.canCreate && (
            <>
              <button type="button" onClick={onNewChat} title={t('newChat')} aria-label={t('newChat')} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><MessageSquarePlus className="w-[18px] h-[18px]" /></button>
              <button type="button" onClick={onNewGroup} title={t('newGroup')} aria-label={t('newGroup')} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><UsersRound className="w-[18px] h-[18px]" /></button>
            </>
          )}
          {data?.canManage && (
            <button type="button" onClick={onSettings} title={t('chatSettings')} aria-label={t('chatSettings')} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><Settings2 className="w-[18px] h-[18px]" /></button>
          )}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder={t('chatListSearchPlaceholder')} className="sm:w-full" />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-1.5 py-1.5">
        {loading && <p className="px-3 py-6 text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('chatListLoading')}</p>}
        {!loading && !channels.length && <p className="px-3 py-6 text-sm text-ink-muted">{t('chatListEmpty')}</p>}
        {SECTIONS.map((s) => {
          const rows = filtered.filter((c) => s.types.includes(c.type))
          if (!rows.length) return null
          return (
            <section key={s.id} className="mb-1.5">
              <h2 className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t(`chatListSections.${s.id}`)}</h2>
              {rows.map((c) => <ChannelRow key={c.id} c={c} me={me} active={c.id === activeId} onOpen={onOpen} />)}
            </section>
          )
        })}
        {query.length >= 2 && (
          <section className="mt-1 border-t border-border pt-2">
            <h2 className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint flex items-center gap-2">{t('chatListMessages')} {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}</h2>
            {!isFetching && !hits.length && <p className="px-3 py-2 text-xs text-ink-muted">{t('chatListNoMatch', { query })}</p>}
            {hits.map((m) => (
              <button key={m.id} type="button" onClick={() => onSearchResult(m)} className="w-full text-start px-3 py-2 rounded-lg hover:bg-bg flex gap-2.5">
                <Avatar name={m.senderName} size={28} soft />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-xs"><span className="font-medium text-ink truncate">{m.channelName}</span><span className="ms-auto text-ink-faint shrink-0">{when(m.createdAt)}</span></span>
                  <span className="block text-xs text-ink-muted line-clamp-2 mt-0.5"><span className="text-ink">{m.senderName}:</span> {m.text}</span>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
