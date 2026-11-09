import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessagesSquare } from 'lucide-react'
import { fetchChatChannels } from '../../api/comms'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { CHANNELS_KEY, openDock, unreadTotal } from './chat/chatStore'

/**
 * Header button next to the notification bell: opens (or closes) the floating dock on its Chat
 * tab, with the unread count. It reads the same cached chat list the dock keeps live.
 */
export default function ChatHeaderButton() {
  const { t } = useTranslation('comms')
  const user = useAuthUser()
  const allowed = hasPermission('comms.chat.view') && !user?.superadmin && !(user?.kind && user.kind !== 'TENANT')
  const { data } = useQuery({ queryKey: CHANNELS_KEY, queryFn: fetchChatChannels, enabled: allowed && !!user?.user?.id, staleTime: 30_000 })
  if (!allowed) return null
  const unread = unreadTotal(data?.channels)
  const label = unread ? `${t('chatTitle')}, ${t('dockUnreadCount', { count: unread })}` : t('chatTitle')
  return (
    <button type="button" data-dock-toggle onClick={() => openDock({ tab: 'chat', toggle: true })} aria-label={label} title={t('chatTitle')}
      className="w-9 h-9 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink relative">
      <MessagesSquare className="w-[18px] h-[18px]" />
      {unread > 0 && <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-500 text-white text-[10px] font-semibold leading-4 text-center ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
    </button>
  )
}
