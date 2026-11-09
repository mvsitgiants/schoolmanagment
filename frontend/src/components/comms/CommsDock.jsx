import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BellRing, MessagesSquare, PhoneCall, X } from 'lucide-react'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import useChatKeeper from './chat/useChatKeeper'
import { DOCK_EVENT } from './chat/chatStore'
import useMyCalls from './dock/useMyCalls'
import CallTab from './dock/CallTab'
import ChatTab from './dock/ChatTab'

// The floating Call / Chat button, bottom right on every signed-in staff screen (AppLayout
// mounts it once; the parent app, public pages and the platform console never have it). It
// opens a small panel — a sheet above the phone tab bar on a phone — with two tabs:
//   Call — Urgent / Normal, pick a person, Call; answers come back as live status cards.
//   Chat — recent chats and people, and the conversation itself in the same panel.
// The badge is unread chat; the ring pulses while one of my calls is waiting for an answer or
// a call ringing me is unanswered (the IncomingCalls overlay still handles answering). It also
// keeps the chat list live for the whole app (useChatKeeper). Open it from code with
// openDock({ tab: 'chat', channelId }) (chatStore) — the header chat button does.

const TAB_KEY = 'hx_dock_tab'
const readTab = () => { try { return localStorage.getItem(TAB_KEY) || 'call' } catch { return 'call' } }
const saveTab = (t) => { try { localStorage.setItem(TAB_KEY, t) } catch { /* private mode */ } }

/** A dialog / sheet / alert that sits above the dock — clicks and Esc there are not for us. */
const inOverlay = (el) => !!el?.closest?.('[role="dialog"]:not([data-dock]),[role="alertdialog"],[aria-modal="true"]')
const modalOpen = () => !!document.querySelector('[aria-modal="true"]')

export default function CommsDock() {
  const { t } = useTranslation(['comms', 'common'])
  const user = useAuthUser()
  const me = user?.user?.id
  const meName = user?.user?.name
  const canCall = hasPermission('comms.calls.create')
  const chat = useChatKeeper()
  const calls = useMyCalls(me)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(readTab)
  const [target, setTarget] = useState(null) // the chat open in the Chat tab
  const panelRef = useRef(null)
  const fabRef = useRef(null)
  // the full chat screen has its own composer bottom right: no floating button over it (the header button still opens the dock)
  const onChatPage = useLocation().pathname.startsWith('/comms/chat')

  const tabs = [canCall && 'call', chat.allowed && 'chat'].filter(Boolean)
  const current = tabs.includes(tab) ? tab : tabs[0]
  const pick = (k) => { setTab(k); saveTab(k) }

  /** Unsent text in the open chat: keep the panel open rather than lose the thread. */
  const hasDraft = () => !!panelRef.current?.querySelector('textarea')?.value.trim()

  const close = useCallback((focusFab) => {
    setOpen(false)
    if (focusFab) fabRef.current?.focus()
  }, [])

  // openDock({ tab, channelId, toggle }) from anywhere (a chat notification, the header button…)
  useEffect(() => {
    const onOpen = (e) => {
      const d = e.detail ?? {}
      const k = d.channelId ? 'chat' : d.tab
      if (k) { setTab(k); saveTab(k) }
      if (d.channelId) setTarget({ channelId: d.channelId })
      setOpen((o) => (d.toggle && !d.channelId ? !o : true))
    }
    window.addEventListener(DOCK_EVENT, onOpen)
    return () => window.removeEventListener(DOCK_EVENT, onOpen)
  }, [])

  // Esc and a click outside close it — not over a dialog, and not with a message half written
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || modalOpen() || inOverlay(e.target)) return
      if (hasDraft() && panelRef.current?.contains(document.activeElement)) return
      close(true)
    }
    const onDown = (e) => {
      const el = e.target
      if (panelRef.current?.contains(el) || fabRef.current?.contains(el) || el?.closest?.('[data-dock-toggle]') || inOverlay(el) || modalOpen()) return
      if (hasDraft()) return
      close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open, close])

  // move focus into the panel when it opens (keyboard users land on the tabs)
  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus())
  }, [open])

  if (user?.superadmin || (user?.kind && user.kind !== 'TENANT') || !tabs.length) return null

  const unread = chat.unread
  const ringing = calls.incoming > 0
  const live = calls.active.length > 0
  // pulse while a call of mine is still waiting for someone to say "on my way"
  const waiting = calls.active.some((c) => !(c.recipients ?? []).some((r) => r.status === 'ACKNOWLEDGED'))
  const label = [t('dockCallOrChat'), unread ? t('dockUnreadCount', { count: unread }) : null, live ? t('dockCallsInProgress', { count: calls.active.length }) : null].filter(Boolean).join(', ')
  const FabIcon = open ? X : live ? PhoneCall : MessagesSquare

  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = tabs.indexOf(current)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    pick(next)
    requestAnimationFrame(() => panelRef.current?.querySelector(`#dock-tab-${next}`)?.focus())
  }

  return (
    <div className="hx-comms-dock contents">
      {/* phone: dim the page behind the sheet — but never the bottom tab bar (a tap here is an outside click) */}
      {open && <div className="sm:hidden fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[45] bg-navy-900/40" aria-hidden="true" />}

      {open && (
        <div ref={panelRef} id="comms-dock" role="dialog" aria-modal="false" aria-label={t('dockCallOrChat')} data-dock
          className={clsx(
            'fixed z-[46] flex flex-col bg-surface border border-border shadow-pop overflow-hidden',
            // phone: a sheet that stops above the bottom tab bar
            'inset-x-0 top-[8dvh] bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-2xl',
            'sm:top-auto sm:inset-x-auto sm:start-auto sm:end-4 sm:bottom-[calc(8.75rem+env(safe-area-inset-bottom))] sm:w-[380px] sm:h-[560px] sm:max-h-[calc(100dvh-13.5rem-env(safe-area-inset-bottom))] sm:rounded-xl',
            'lg:end-6 lg:bottom-[5.75rem] lg:max-h-[calc(100dvh-10.25rem)]',
          )}>
          <div className="sm:hidden flex justify-center pt-1.5"><span className="w-10 h-1 rounded-full bg-border" /></div>
          <div className="shrink-0 flex items-center gap-1.5 p-1.5 border-b border-border">
            <div role="tablist" aria-label={t('dockCallOrChat')} className="flex-1 grid gap-1 p-1 rounded-lg bg-bg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} onKeyDown={onTabKey}>
              {tabs.map((k) => {
                const on = k === current
                const Icon = k === 'call' ? BellRing : MessagesSquare
                return (
                  <button key={k} id={`dock-tab-${k}`} type="button" role="tab" aria-selected={on} aria-controls="dock-panel" tabIndex={on ? 0 : -1} onClick={() => pick(k)}
                    className={clsx('h-9 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors', on ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink')}>
                    <Icon className={clsx('w-[18px] h-[18px]', on && (k === 'call' ? 'text-danger-500' : 'text-brand-600'))} />
                    {k === 'call' ? t('call') : t('chatTab')}
                    {k === 'call' && live && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-white text-[10px] leading-[18px]">{calls.active.length}</span>}
                    {k === 'chat' && unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[10px] leading-[18px]">{unread > 99 ? '99+' : unread}</span>}
                  </button>
                )
              })}
            </div>
            <button type="button" aria-label={t('common:actions.close')} onClick={() => close(true)} className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
          <div id="dock-panel" role="tabpanel" aria-labelledby={`dock-tab-${current}`} className="flex-1 min-h-0">
            {current === 'call'
              ? <CallTab calls={calls.calls} onSent={calls.add} onUpdate={calls.add} onDismiss={calls.dismiss} />
              : <ChatTab data={chat.data} loading={chat.allowed && !chat.data} me={me} meName={meName} target={target} onTarget={setTarget} onClose={() => close(false)} />}
          </div>
        </div>
      )}

      {/* above the phone tab bar (h-16) on small screens; bottom right on a desktop */}
      <button ref={fabRef} type="button" onClick={() => (open ? close(false) : setOpen(true))}
        aria-label={label} title={t('dockCallOrChat')} aria-expanded={open} aria-controls="comms-dock" aria-haspopup="dialog"
        className={clsx(
          'fixed z-[46] end-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:end-6 lg:bottom-6',
          'w-14 h-14 rounded-full bg-brand-500 text-white shadow-pop flex items-center justify-center',
          'hover:bg-brand-600 active:bg-brand-700 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30',
          open && 'max-sm:hidden',
          onChatPage && !open && 'hidden',
        )}>
        {(ringing || waiting) && !open && (
          <span aria-hidden="true" className={clsx('absolute inset-0 rounded-full animate-ping opacity-60', ringing ? 'bg-danger-500' : 'bg-brand-400')} />
        )}
        <FabIcon className="relative w-6 h-6" />
        {unread > 0 && !open && (
          <span className="absolute -top-1 -end-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-danger-500 text-white text-[11px] font-bold leading-[22px] text-center ring-2 ring-surface">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  )
}
