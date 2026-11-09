import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, MapPin, Minimize2, Phone, Send } from 'lucide-react'
import { PAGE_BUSY_REASONS, PAGE_ETAS } from '@schoolgiant/shared'
import { Avatar, Input } from '../system'
import i18n from '../../i18n'
import { fetchIncomingCalls } from '../../api/comms'
import { useRealtime, useRealtimeEvent } from '../../context/RealtimeContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { PriorityPill, busyReasonKey, errText, sendAnswer, sinceText } from './PagingBits'
import { startRinging, unlockAudio } from './ringer'

// The incoming-call screen, mounted once in the signed-in app layout. Calls ringing this
// person stack up: an emergency alert takes the whole screen, urgent and normal calls are
// cards (bottom of the screen on a phone, for one hand; top right on a desktop). Emergency and
// urgent calls ring (Web Audio) and vibrate until answered; a normal call chimes once. While the
// tab is in the background it raises a browser notification.

const ASKED_KEY = 'hx_notify_asked'

function askNotificationPermission() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'default') return
    if (localStorage.getItem(ASKED_KEY)) return
    localStorage.setItem(ASKED_KEY, '1')
    Notification.requestPermission().catch(() => {})
  } catch { /* not supported / private mode */ }
}

function systemNotify(call) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const t = i18n.t
    const from = call.from?.name ?? t('comms:incomingCallAColleague')
    const title = call.priority === 'CODE'
      ? [call.codeLabel, call.location?.label].filter(Boolean).join(' — ')
      : call.priority === 'URGENT'
        ? t('comms:incomingCallUrgentFrom', { name: from })
        : t('comms:incomingCallFrom', { name: from })
    const n = new Notification(title, {
      body: [call.message, call.priority !== 'CODE' && call.location?.label].filter(Boolean).join(' · ') || t('comms:incomingCallNotifyBody'),
      tag: `page-${call.id}`,
      renotify: true,
      requireInteraction: call.priority !== 'ROUTINE',
    })
    n.onclick = () => { window.focus(); n.close() }
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}

const isGone = (e) => ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(e?.code) || [403, 404, 409].includes(e?.response?.status)

/** On my way (ETA) / Busy (reason) / Call back — the same block for cards and the alert screen. */
function Answer({ call, onDone, big }) {
  const { t } = useTranslation(['comms', 'common'])
  const realtime = useRealtime()
  const { showError } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const answer = async (body) => {
    setPending(true)
    try {
      await sendAnswer(realtime, call.id, body)
      onDone(call.id)
    } catch (e) {
      showError(errText(e))
      if (isGone(e)) onDone(call.id)
    } finally {
      setPending(false)
    }
  }
  const h = big ? 'h-12 text-base' : 'h-10 text-sm'
  return (
    <div className="space-y-2">
      {!busy ? (
        <>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">{t('incomingCallOnMyWayIn')}</p>
          <div className="grid grid-cols-4 gap-2">
            {PAGE_ETAS.map((m) => (
              <button key={m} type="button" disabled={pending} onClick={() => answer({ action: 'ACK', etaMinutes: m })}
                className={clsx(h, 'rounded-lg bg-success-500 text-white font-semibold hover:bg-success-600 disabled:opacity-60')}>
                {t('minAgo', { m })}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => setBusy(true)} className={clsx(h, 'flex-1 min-w-[6rem] rounded-lg border border-danger-500/40 text-danger-600 font-semibold hover:bg-danger-50 disabled:opacity-60')}>{t('incomingCallBusy')}</button>
            {call.from?.phone && (
              <a href={`tel:${call.from.phone.replace(/(?!^\+)[^\d]/g, '')}`} className={clsx(h, 'flex-1 min-w-[6rem] rounded-lg border border-border text-ink font-semibold hover:bg-bg inline-flex items-center justify-center gap-1.5')}>
                <Phone className="w-4 h-4" /> {t('incomingCallCallBack')}
              </a>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">{t('incomingCallBusyWhy')}</p>
          <div className="flex flex-wrap gap-1.5">
            {PAGE_BUSY_REASONS.map((r) => {
              const label = t(busyReasonKey(r), { defaultValue: r })
              return (
                <button key={r} type="button" disabled={pending} onClick={() => answer({ action: 'BUSY', reason: label })}
                  className="h-9 px-3 rounded-full border border-border bg-surface text-sm text-ink hover:bg-bg disabled:opacity-60">{label}</button>
              )
            })}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) answer({ action: 'BUSY', reason: reason.trim() }) }}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('incomingCallReasonPlaceholder')} aria-label={t('incomingCallReasonAria')} />
            <button type="submit" disabled={pending || !reason.trim()} aria-label={t('incomingCallSendAria')} className="h-9 w-10 shrink-0 rounded-md bg-danger-500 text-white flex items-center justify-center disabled:opacity-50"><Send className="w-4 h-4" /></button>
          </form>
          <button type="button" onClick={() => setBusy(false)} className="text-xs text-brand-600 hover:underline">{t('common:actions.back')}</button>
        </>
      )}
    </div>
  )
}

function Details({ call, inverse }) {
  const muted = inverse ? 'text-white/85' : 'text-ink-muted'
  return (
    <div className={clsx('space-y-1 text-sm', inverse ? 'text-white' : 'text-ink')}>
      {call.location?.label && <p className="flex items-start gap-1.5"><MapPin className={clsx('w-4 h-4 shrink-0 mt-0.5', muted)} /><span className="font-medium">{call.location.label}</span></p>}
      {call.message && <p className="whitespace-pre-line break-words">{call.message}</p>}
    </div>
  )
}

/** Urgent / normal call (and an alert someone tucked away): a card. */
function CallCard({ call, now, onDone, onExpand }) {
  const { t } = useTranslation(['comms', 'common'])
  const code = call.priority === 'CODE'
  const from = call.from?.name ?? t('incomingCallAColleagueCap')
  return (
    <div role="alertdialog" aria-label={t('incomingCallFromAria', { name: call.from?.name ?? t('incomingCallAColleague') })}
      className={clsx('pointer-events-auto rounded-xl border bg-surface shadow-pop p-3 space-y-2.5 border-s-4',
        code ? 'border-danger-500' : call.priority === 'URGENT' ? 'border-amber-400' : 'border-brand-500')}>
      <div className="flex items-start gap-2.5">
        <span className={clsx('relative shrink-0 rounded-full', call.priority !== 'ROUTINE' && 'ring-2 ring-offset-2 ring-offset-surface', code ? 'ring-danger-500' : 'ring-amber-400')}>
          <Avatar name={from} size={40} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityPill call={call} />
            {call.escalation?.step > 0 && <span className="text-[11px] font-medium text-amber-600">{t('incomingCallEscalatedToYou')}</span>}
            {call.rering && <span className="text-[11px] font-medium text-ink-faint">{t('incomingCallRingingAgain')}</span>}
          </div>
          <p className="text-sm font-semibold text-ink mt-1 truncate">{from}{call.from?.designation ? <span className="font-normal text-ink-muted"> · {call.from.designation}</span> : null}</p>
          <p className="text-[11px] text-ink-faint">{call.callNo} · {sinceText(call.createdAt, now)}{call.target?.label ? ` · ${t('incomingCallToTarget', { label: call.target.label })}` : ''}</p>
        </div>
        {code && <button type="button" onClick={() => onExpand(call.id)} className="text-xs text-brand-600 hover:underline shrink-0">{t('incomingCallFullScreen')}</button>}
      </div>
      <Details call={call} />
      <Answer call={call} onDone={onDone} />
    </div>
  )
}

/** Emergency alert: the whole screen, in the alert's colour. */
function CodeScreen({ calls, index, setIndex, now, onDone, onHide }) {
  const { t } = useTranslation(['comms', 'common'])
  const call = calls[Math.min(index, calls.length - 1)]
  if (!call) return null
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="code-title" className="fixed inset-0 z-[70] flex flex-col bg-surface">
      <div className="px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1.25rem)] pb-5 sm:pb-8 text-white" style={{ backgroundColor: call.codeColor || '#B42318' }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-white/85">{t('incomingCallEmergencyCodeNo', { callNo: call.callNo })}</p>
            <div className="flex items-center gap-1">
              {calls.length > 1 && (
                <>
                  <button type="button" aria-label={t('incomingCallPrevCode')} onClick={() => setIndex((index - 1 + calls.length) % calls.length)} className="w-9 h-9 rounded-md hover:bg-white/15 flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></button>
                  <span className="text-xs font-semibold">{t('incomingCallIndex', { n: index + 1, total: calls.length })}</span>
                  <button type="button" aria-label={t('incomingCallNextCode')} onClick={() => setIndex((index + 1) % calls.length)} className="w-9 h-9 rounded-md hover:bg-white/15 flex items-center justify-center"><ChevronRight className="w-5 h-5" /></button>
                </>
              )}
              <button type="button" aria-label={t('incomingCallShowAsCard')} title={t('incomingCallShowAsCardHint')} onClick={() => onHide(call.id)} className="w-9 h-9 rounded-md hover:bg-white/15 flex items-center justify-center"><Minimize2 className="w-5 h-5" /></button>
            </div>
          </div>
          <h1 id="code-title" className="font-display text-4xl sm:text-6xl font-bold leading-tight mt-2">{call.codeLabel}</h1>
          {call.location?.label && <p className="text-xl sm:text-3xl font-semibold mt-1 break-words">{call.location.label}</p>}
          <p className="text-sm text-white/85 mt-2">{t('incomingCallFromName', { name: call.from?.name ?? t('incomingCallAColleague') })} · {sinceText(call.createdAt, now)}{call.escalation?.step > 0 ? ` · ${t('incomingCallEscalated')}` : ''}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-8 space-y-4">
          {call.message && <Details call={{ ...call, location: null }} />}
        </div>
      </div>
      <div className="border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto p-4 sm:p-6">
          <Answer call={call} onDone={onDone} big />
        </div>
      </div>
    </div>
  )
}

export default function IncomingCalls() {
  const { t } = useTranslation(['comms', 'common'])
  const realtime = useRealtime()
  const navigate = useNavigate()
  const { showInfo, showSuccess, showWarning } = useSnackbar()
  const [calls, setCalls] = useState([]) // ringing me, newest first
  const [hidden, setHidden] = useState(() => new Set()) // alerts shown as cards
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [ringSeq, setRingSeq] = useState(0) // a new call re-rings (a normal call chimes once per call)

  const add = useCallback((call) => setCalls((prev) => [call, ...prev.filter((c) => c.id !== call.id)]), [])
  const remove = useCallback((id) => setCalls((prev) => prev.filter((c) => c.id !== id)), [])

  // calls still ringing after a reload, and after the connection comes back
  useEffect(() => {
    fetchIncomingCalls().then((rows) => setCalls(rows ?? [])).catch(() => {})
  }, [realtime.connected])

  useRealtimeEvent('page:ring', ({ call } = {}) => {
    if (!call?.id) return
    add(call)
    setRingSeq((n) => n + 1)
    if (call.priority === 'CODE') { setHidden((h) => { const n = new Set(h); n.delete(call.id); return n }); setIndex(0) }
    if (document.hidden) systemNotify(call)
  })
  useRealtimeEvent('page:stop', ({ id, reason, label } = {}) => {
    remove(id)
    if (reason === 'ALL_CLEAR') showSuccess(label || t('incomingCallAllClear'))
    else if (reason === 'missed') showWarning(label || t('incomingCallMissed'))
    else if (reason === 'escalated') showInfo(label || t('incomingCallPassedOn'))
  })
  useRealtimeEvent('page:update', ({ call } = {}) => { if (call?.id && call.status !== 'ACTIVE') remove(call.id) })
  // the caller hears each answer wherever they are in the app
  useRealtimeEvent('page:answer', (a = {}) => {
    if (a.status === 'ACKNOWLEDGED') {
      showSuccess(a.etaMinutes
        ? t('incomingCallAnsweredOnWayEta', { name: a.name, min: a.etaMinutes, callNo: a.callNo })
        : t('incomingCallAnsweredOnWay', { name: a.name, callNo: a.callNo }))
    } else if (a.status === 'BUSY') {
      showWarning(a.reason
        ? t('incomingCallAnsweredBusyReason', { name: a.name, reason: a.reason, callNo: a.callNo })
        : t('incomingCallAnsweredBusy', { name: a.name, callNo: a.callNo }))
    }
  })

  // audio is locked until the first tap / key; ask for notifications on that same gesture
  useEffect(() => {
    const once = () => { unlockAudio(); askNotificationPermission() }
    window.addEventListener('pointerdown', once, { once: true })
    window.addEventListener('keydown', once, { once: true })
    return () => { window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once) }
  }, [])

  // emergency / urgent: a loud ring that repeats until every such call is answered; normal: one chime
  const tone = calls.some((c) => c.priority === 'CODE') ? 'CODE' : calls.some((c) => c.priority === 'URGENT') ? 'URGENT' : calls.length ? 'ROUTINE' : null
  useEffect(() => (tone ? startRinging(tone) : undefined), [tone, ringSeq])

  useEffect(() => {
    if (!calls.length) return undefined
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [calls.length])

  if (!calls.length) return null
  const codes = calls.filter((c) => c.priority === 'CODE' && !hidden.has(c.id))
  const cards = calls.filter((c) => c.priority !== 'CODE' || hidden.has(c.id))
  const done = (id) => remove(id)
  const hide = (id) => setHidden((h) => new Set(h).add(id))
  const expand = (id) => { setHidden((h) => { const n = new Set(h); n.delete(id); return n }); setIndex(0) }

  return createPortal(
    <>
      {cards.length > 0 && (
        <div className="fixed z-[65] inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:top-16 sm:end-4 sm:w-[25rem] max-h-[100dvh] overflow-y-auto scroll-hide p-3 sm:p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] flex flex-col gap-2 pointer-events-none">
          {cards.slice(0, 3).map((c) => <CallCard key={c.id} call={c} now={now} onDone={done} onExpand={expand} />)}
          {cards.length > 3 && (
            <div className="pointer-events-auto rounded-lg border border-border bg-surface shadow-pop px-3 py-2 text-xs text-ink-muted flex items-center justify-between">
              <span>{t('incomingCallMoreRinging', { count: cards.length - 3 })}</span>
              <button type="button" onClick={() => navigate('/comms/calls')} className="text-brand-600 hover:underline inline-flex items-center gap-1">{t('incomingCallOpenCalls')} <ChevronRight className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}
      {codes.length > 0 && <CodeScreen calls={codes} index={index} setIndex={setIndex} now={now} onDone={done} onHide={hide} />}
    </>,
    document.body,
  )
}
