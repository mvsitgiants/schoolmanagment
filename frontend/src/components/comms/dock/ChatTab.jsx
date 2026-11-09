import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Search, UsersRound } from 'lucide-react'
import { Avatar, Input } from '../../system'
import { createChatGroup, fetchChatPeople } from '../../../api/comms'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useRealtime } from '../../../context/RealtimeContext'
import { useSnackbar } from '../../../context/SnackbarContext'
import { ChannelRow } from '../chat/ChannelList'
import ChannelView from '../chat/ChannelView'
import PeopleModal from '../chat/PeopleModal'
import { CHANNELS_KEY, channelKey, errText } from '../chat/chatStore'

// The dock's Chat tab — a messenger mini window: recent chats (unread first), a search that
// also finds people to start a chat with, and the conversation itself in the same panel.
// `target` is { channelId } or { peer } (a direct chat created by its first message).

function PersonRow({ p, online, onOpen }) {
  const { t } = useTranslation('comms')
  return (
    <button type="button" onClick={() => onOpen(p)} className="w-full flex items-center gap-2.5 px-2.5 py-2 text-start rounded-lg hover:bg-bg">
      <span className="relative shrink-0">
        <Avatar name={p.name} size={40} />
        {online && <span className="absolute bottom-0 end-0 w-3 h-3 rounded-full bg-success-500 ring-2 ring-surface" title={t('online')} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink truncate">{p.name}</span>
        <span className="block text-xs text-ink-muted truncate">{[p.designation, ...(p.departments ?? [])].filter(Boolean).join(' · ') || t('chatTabStartChat')}</span>
      </span>
    </button>
  )
}

export default function ChatTab({ data, loading, me, meName, target, onTarget, onClose }) {
  const { t } = useTranslation('comms')
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const { connected, isOnline } = useRealtime()
  const [q, setQ] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const search = useDebouncedValue(q.trim(), 250)
  const channels = data?.channels ?? []

  // unread first, then the newest
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = needle ? channels.filter((c) => c.name?.toLowerCase().includes(needle) || c.peer?.designation?.toLowerCase().includes(needle)) : channels
    const unread = (c) => (c.me?.muted ? c.unreadMentions : c.unread) || 0
    return [...rows].sort((a, b) => Number(unread(b) > 0) - Number(unread(a) > 0) || new Date(b.lastMessageAt ?? 0) - new Date(a.lastMessageAt ?? 0))
  }, [channels, q])

  // people: the matches for a search, or everyone when there are no chats yet
  const wantPeople = !!search || (!loading && !channels.length)
  const { data: people = [], isFetching } = useQuery({ queryKey: ['chat', 'people', search], queryFn: () => fetchChatPeople(search), enabled: wantPeople, staleTime: 30_000 })
  const dmPeers = useMemo(() => new Set(channels.filter((c) => c.type === 'DIRECT' && c.peer?.id).map((c) => c.peer.id)), [channels])
  const newPeople = wantPeople ? people.filter((p) => !dmPeers.has(p.id)) : []

  const openPerson = (p) => {
    const existing = channels.find((c) => c.type === 'DIRECT' && c.peer?.id === p.id)
    onTarget(existing ? { channelId: existing.id } : { peer: { id: p.id, name: p.name, designation: p.designation } })
  }

  const createGroup = async (body) => {
    setBusy(true)
    try {
      const c = await createChatGroup(body)
      qc.setQueryData(channelKey(c.id), c)
      qc.invalidateQueries({ queryKey: CHANNELS_KEY })
      setGroupOpen(false)
      onTarget({ channelId: c.id })
    } catch (e) { showError(errText(e)) } finally { setBusy(false) }
  }

  if (target) {
    const listEntry = target.channelId ? channels.find((c) => c.id === target.channelId) ?? null : null
    return (
      <ChannelView
        key={target.channelId ?? `draft-${target.peer?.id}`}
        compact
        channelId={target.channelId ?? null} draftPeer={target.channelId ? null : target.peer ?? null}
        listEntry={listEntry} listMeta={data} me={me} meName={meName}
        onBack={() => onTarget(null)} onCreated={(id) => onTarget({ channelId: id })} onLeft={() => onTarget(null)}
      />
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 px-3 pt-2.5 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chatTabSearchPlaceholder')} className="ps-9" aria-label={t('chatTabSearchPlaceholder')} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-1.5 pb-2">
        {loading && <p className="px-3 py-6 text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('chatListLoading')}</p>}
        {list.map((c) => <ChannelRow key={c.id} c={c} me={me} onOpen={(x) => onTarget({ channelId: x.id })} />)}
        {q.trim() && !list.length && !newPeople.length && !isFetching && <p className="px-3 py-6 text-sm text-ink-muted text-center">{t('chatTabNoMatch', { query: q.trim() })}</p>}
        {wantPeople && (newPeople.length > 0 || isFetching) && (
          <section className="mt-1">
            <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint flex items-center gap-2">
              {channels.length ? t('chatTabStartChat') : t('chatTabSayHelloColleague')} {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
            </h3>
            {newPeople.map((p) => <PersonRow key={p.id} p={p} online={connected ? isOnline(p.id) : !!p.online} onOpen={openPerson} />)}
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 flex items-center justify-between text-xs pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {data?.canCreate
          ? <button type="button" onClick={() => setGroupOpen(true)} className="text-brand-600 hover:underline inline-flex items-center gap-1"><UsersRound className="w-3.5 h-3.5" /> {t('newGroup')}</button>
          : <span />}
        <Link to="/comms/chat" onClick={onClose} className="text-ink-muted hover:text-ink hover:underline inline-flex items-center gap-1">{t('chatTabOpenFull')} <ExternalLink className="w-3 h-3" /></Link>
      </div>

      <PeopleModal open={groupOpen} mode="group" busy={busy} onClose={() => setGroupOpen(false)} onCreate={createGroup} />
    </div>
  )
}
