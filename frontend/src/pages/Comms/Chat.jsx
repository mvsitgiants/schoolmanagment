import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { MessagesSquare } from 'lucide-react'
import { EmptyState, PageContainer } from '../../components/system'
import ChannelList from '../../components/comms/chat/ChannelList'
import ChannelView from '../../components/comms/chat/ChannelView'
import ChatSettingsModal from '../../components/comms/chat/ChatSettingsModal'
import PeopleModal from '../../components/comms/chat/PeopleModal'
import { CHANNELS_KEY, channelKey, errText } from '../../components/comms/chat/chatStore'
import { createChatGroup, fetchChatChannels, findDirectChat } from '../../api/comms'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useSnackbar } from '../../context/SnackbarContext'

// Staff chat & call bell › Staff chat. Two panes on a desktop (chats | the open chat); on a
// phone (< 768 px) two screens — the list, then the chat with a back arrow.
// /comms/chat/:channelId opens a chat; ?to=<userId> opens a direct chat that is created with
// its first message; ?m=<messageId> scrolls to a message (search results).
export default function Chat() {
  const { t } = useTranslation(['comms', 'common'])
  const { channelId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const me = useAuthUser()
  const meId = me?.user?.id
  const allowed = hasPermission('comms.chat.view')
  const toUser = params.get('to')
  const focusMessageId = params.get('m')
  const [people, setPeople] = useState(null) // 'direct' | 'group'
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: CHANNELS_KEY, queryFn: fetchChatChannels, enabled: allowed, staleTime: 30_000 })
  const { data: direct } = useQuery({ queryKey: ['chat', 'direct', toUser], queryFn: () => findDirectChat(toUser), enabled: allowed && !!toUser && !channelId, retry: false })

  // a direct chat that already exists opens as itself
  useEffect(() => {
    if (direct?.channel?.id) {
      qc.setQueryData(channelKey(direct.channel.id), direct.channel)
      navigate(`/comms/chat/${direct.channel.id}`, { replace: true })
    }
  }, [direct, navigate, qc])

  const open = (c) => navigate(`/comms/chat/${c.id}`)
  const back = () => navigate('/comms/chat')
  const listEntry = data?.channels?.find((c) => c.id === channelId) ?? null
  const draftPeer = !channelId && toUser && direct && !direct.channel ? direct.peer : null
  const showing = !!channelId || !!draftPeer

  const startDirect = async (p) => {
    setPeople(null)
    const existing = data?.channels?.find((c) => c.type === 'DIRECT' && c.peer?.id === p.id)
    if (existing) return navigate(`/comms/chat/${existing.id}`)
    return navigate(`/comms/chat?to=${p.id}`)
  }
  const createGroup = async (body) => {
    setBusy(true)
    try {
      const c = await createChatGroup(body)
      qc.setQueryData(channelKey(c.id), c)
      qc.invalidateQueries({ queryKey: CHANNELS_KEY })
      setPeople(null)
      navigate(`/comms/chat/${c.id}`)
    } catch (e) { showError(errText(e)) } finally { setBusy(false) }
  }

  if (!allowed) {
    return <PageContainer><EmptyState icon={MessagesSquare} title={t('chatNotPartOfRole')} hint={t('chatRoleHint')} /></PageContainer>
  }

  return (
    <PageContainer wide className="!gap-0 !min-h-0">
      {/* phone: fills the screen between the header and the bottom tab bar */}
      <div className="h-[calc(100dvh-10.5rem)] lg:h-[calc(100dvh-6.5rem)] min-h-[420px] flex rounded-xl border border-border bg-surface shadow-card overflow-hidden">
        <aside className={clsx('w-full md:w-80 lg:w-96 shrink-0 md:border-e border-border min-h-0 flex-col', showing ? 'hidden md:flex' : 'flex')}>
          <ChannelList
            data={data} loading={isLoading} activeId={channelId} me={meId}
            onOpen={open} onNewChat={() => setPeople('direct')} onNewGroup={() => setPeople('group')} onSettings={() => setSettingsOpen(true)}
            onSearchResult={(m) => navigate(`/comms/chat/${m.channelId}?m=${m.id}`)}
          />
        </aside>
        <section className={clsx('flex-1 min-w-0 min-h-0 flex-col', showing ? 'flex' : 'hidden md:flex')}>
          <ChannelView
            key={channelId ?? `draft-${toUser ?? ''}`}
            channelId={channelId ?? null} draftPeer={draftPeer} listEntry={listEntry} listMeta={data}
            me={meId} meName={me?.user?.name} focusMessageId={focusMessageId}
            onBack={back} onCreated={(id) => navigate(`/comms/chat/${id}`, { replace: true })} onLeft={back}
          />
        </section>
      </div>

      <PeopleModal open={people === 'direct' || people === 'group'} mode={people ?? 'direct'} busy={busy} onClose={() => setPeople(null)} onPick={startDirect} onCreate={createGroup} />
      <ChatSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </PageContainer>
  )
}
