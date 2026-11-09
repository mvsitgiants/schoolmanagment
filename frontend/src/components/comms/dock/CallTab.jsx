import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Loader2, MapPin, PhoneCall, Search, Siren, Users, X } from 'lucide-react'
import { Avatar, Input, Select } from '../../system'
import { createPageCall, closePageCall, fetchChatChannels, fetchPagingMeta, searchPagingDirectory } from '../../../api/comms'
import { hasPermission } from '../../../api/auth'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { useRealtime } from '../../../context/RealtimeContext'
import { useSnackbar } from '../../../context/SnackbarContext'
import { CHANNELS_KEY } from '../chat/chatStore'
import { CallTile, CodeTile, PriorityPill, answerSummary, errText, sinceText } from '../PagingBits'

// The dock's Call tab — three taps: Urgent / Normal, a person, Call. Answers come back live as
// status cards. A team (department / role) and, for those allowed, an emergency alert are one
// small link away; the full form stays on the Call bell page.

const firstName = (name = '') => name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/)[0] || name

// ───────────────────────────────────────────────────────── status cards

function personLine(r, t) {
  switch (r.status) {
    case 'ACKNOWLEDGED': return { tone: 'text-success-600', dot: 'bg-success-500', text: r.etaMinutes !== undefined && r.etaMinutes !== null ? t('callTabOnMyWayEta', { min: r.etaMinutes }) : t('callTabOnMyWay') }
    case 'BUSY': return { tone: 'text-danger-600', dot: 'bg-danger-500', text: r.reason ? t('callTabBusyReason', { reason: r.reason }) : t('incomingCallBusy') }
    case 'MISSED': return { tone: 'text-ink-muted', dot: 'bg-border', text: t('callTabNoAnswer') }
    default: return { tone: 'text-amber-600', dot: 'bg-amber-400 animate-pulse', text: r.rings > 1 ? t('callTabRingingAgain') : t('callTabRinging') }
  }
}

const ENDED = { CLOSED: 'closed', EXPIRED: 'callTabEndedExpired', ALL_CLEAR: 'allClear' }

function CallCard({ call, now, onDismiss, onUpdate }) {
  const { t } = useTranslation(['comms', 'common'])
  const { showError } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const live = call.status === 'ACTIVE'
  const people = call.recipients ?? []
  const ringing = people.filter((r) => r.status === 'RINGING')
  const answered = people.some((r) => r.status === 'ACKNOWLEDGED')
  const title = live && ringing.length && !answered
    ? t('callTabCalling', { name: call.target?.label ?? t('callTabColleagues') })
    : call.priority === 'CODE' ? [call.codeLabel, call.location?.label].filter(Boolean).join(' · ') : call.target?.label ?? t('call')
  const lastStep = call.escalation?.step > 0 ? call.escalation.history?.[call.escalation.history.length - 1] : null
  const cancel = async () => {
    setBusy(true)
    try { onUpdate(await closePageCall(call.id, t('callTabCancelledNote'))) } catch (e) { showError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <div className={clsx('rounded-lg border border-border bg-surface p-2 border-s-4', live ? (call.priority === 'URGENT' || call.priority === 'CODE' ? 'border-s-danger-500' : 'border-s-brand-500') : 'border-s-border opacity-90')}>
      <div className="flex items-start gap-2">
        <CallTile call={call} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate" title={title}>{title}</p>
          <p className="text-[11px] text-ink-faint flex items-center gap-1.5 mt-0.5">
            <PriorityPill call={call} className="!py-0 !text-[10px]" />
            <span>{sinceText(call.createdAt, now)}</span>
            {!live && <span className="font-medium text-ink-muted">· {ENDED[call.status] ? t(ENDED[call.status]) : call.status}</span>}
          </p>
        </div>
        {live && hasPermission('comms.calls.view') ? (
          <button type="button" disabled={busy} onClick={cancel} className="h-7 px-2.5 rounded-md border border-border text-xs font-medium text-ink-muted hover:bg-bg hover:text-ink disabled:opacity-50 shrink-0">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('common:actions.cancel')}
          </button>
        ) : !live && (
          <button type="button" aria-label={t('common:actions.close')} title={t('common:actions.close')} onClick={() => onDismiss(call.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink shrink-0"><X className="w-4 h-4" /></button>
        )}
      </div>
      {people.length > 0 && people.length <= 3 && (
        <ul className="mt-1.5 space-y-0.5">
          {people.map((r) => {
            const l = personLine(r, t)
            return (
              <li key={`${r.userId}-${r.step ?? 0}`} className="flex items-center gap-1.5 text-xs min-w-0">
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', l.dot)} />
                {people.length > 1 && <span className="text-ink truncate max-w-[45%]">{firstName(r.name)}</span>}
                <span className={clsx('font-medium truncate', l.tone)}>{l.text}</span>
              </li>
            )
          })}
        </ul>
      )}
      {people.length > 3 && <p className="mt-1.5 text-xs text-ink-muted">{answerSummary(call.counts, t)}</p>}
      {lastStep && live && <p className="mt-1 text-[11px] text-amber-600 truncate">{t('callTabPassedOn', { who: lastStep.label ?? lastStep.note ?? t('callTabNextInLine') })}</p>}
    </div>
  )
}

// ───────────────────────────────────────────────────────── people

function PersonRow({ p, online, picked, onPick }) {
  const { t } = useTranslation(['comms', 'common'])
  return (
    <button type="button" onClick={() => onPick(p)} aria-pressed={picked}
      className={clsx('w-full flex items-center gap-2.5 px-2.5 py-1.5 text-start rounded-lg transition-colors', picked ? 'bg-brand-50' : 'hover:bg-bg')}>
      <span className="relative shrink-0">
        <Avatar name={p.name} size={34} />
        <span className={clsx('absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full ring-2 ring-surface', online ? 'bg-success-500' : 'bg-border')} title={online ? t('online') : t('offline')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink truncate">{p.name}</span>
        <span className="block text-[11px] text-ink-muted truncate">{[p.designation, ...(p.departments ?? [])].filter(Boolean).join(' · ') || (online ? t('online') : '—')}</span>
      </span>
      {picked && <span className="w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></span>}
    </button>
  )
}

const Section = ({ label, children }) => (
  <section className="mb-1">
    <h3 className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</h3>
    {children}
  </section>
)

/** People I called or chatted with lately: single-person calls first, then direct chats. */
function useRecentPeople(meta) {
  const chatOn = hasPermission('comms.chat.view')
  const { data: chats } = useQuery({ queryKey: CHANNELS_KEY, queryFn: fetchChatChannels, enabled: chatOn, staleTime: 30_000 })
  return useMemo(() => {
    const out = new Map()
    for (const t of meta?.recentTargets ?? []) {
      if (t.type === 'USER' && t.ids?.length === 1 && !out.has(t.ids[0])) out.set(t.ids[0], { id: t.ids[0], name: t.label })
    }
    const dms = (chats?.channels ?? []).filter((c) => c.type === 'DIRECT' && c.peer?.id && c.lastMessageAt)
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    for (const c of dms) {
      const prev = out.get(c.peer.id)
      out.set(c.peer.id, { id: c.peer.id, name: prev?.name ?? c.name, designation: c.peer.designation })
    }
    return [...out.values()].slice(0, 8)
  }, [meta, chats])
}

// ───────────────────────────────────────────────────────── team & alert

function TeamPicker({ meta, value, onChange }) {
  const { t } = useTranslation(['comms', 'common'])
  const kinds = [
    { value: 'DEPARTMENT', label: t('targetShort.DEPARTMENT') },
    { value: 'ROLE', label: t('targetShort.ROLE') },
  ]
  return (
    <div className="p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {kinds.map((k) => (
          <button key={k.value} type="button" onClick={() => onChange({ type: k.value, key: '' })}
            className={clsx('h-9 rounded-lg border text-sm font-medium', value.type === k.value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border text-ink hover:bg-bg')}>
            {k.label}
          </button>
        ))}
      </div>
      {value.type === 'DEPARTMENT' && (
        <Select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} aria-label={t('targetShort.DEPARTMENT')}>
          <option value="">{t('pickDepartment')}</option>
          {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      )}
      {value.type === 'ROLE' && (
        <Select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} aria-label={t('targetShort.ROLE')}>
          <option value="">{t('pickRole')}</option>
          {(meta?.roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      )}
      <p className="text-xs text-ink-muted">{t('callTabTeamHint')}</p>
    </div>
  )
}

const teamTarget = (team) => (team.key ? { type: team.type, ids: [team.key] } : null)

function CodePicker({ meta, value, onChange }) {
  const { t } = useTranslation(['comms', 'common'])
  const codes = (meta?.codes ?? []).filter((c) => c.enabled)
  return (
    <div className="p-3 space-y-2.5">
      <p className="text-xs text-ink-muted">{t('callTabCodeHint')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {codes.map((c) => (
          <button key={c.code} type="button" onClick={() => onChange({ ...value, code: c.code })}
            className={clsx('flex items-start gap-2 rounded-lg border p-2 text-start transition-colors', value.code === c.code ? 'border-ink bg-bg ring-1 ring-ink' : 'border-border hover:bg-bg')}>
            <CodeTile color={c.color} size={26} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink truncate">{c.label}</span>
              <span className="block text-[11px] text-ink-muted line-clamp-2">{c.meaning}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="relative">
        <MapPin className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input value={value.place} onChange={(e) => onChange({ ...value, place: e.target.value })} maxLength={120} className="ps-9" placeholder={t('callTabWherePlaceholder')} aria-label={t('where')} />
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────── the tab

export default function CallTab({ calls, onSent, onUpdate, onDismiss }) {
  const { t } = useTranslation(['comms', 'common'])
  const { showError } = useSnackbar()
  const { connected, isOnline } = useRealtime()
  const [priority, setPriority] = useState('ROUTINE')
  const [mode, setMode] = useState('person') // person · team · code
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([]) // [{ id, name }]
  const [multi, setMulti] = useState(false)
  const [note, setNote] = useState('')
  const [team, setTeam] = useState({ type: 'DEPARTMENT', key: '' })
  const [code, setCode] = useState({ code: '', place: '' })
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const search = useDebouncedValue(q.trim(), 250)

  const { data: meta } = useQuery({ queryKey: ['paging', 'meta'], queryFn: fetchPagingMeta, staleTime: 60_000 })
  const { data: people = [], isFetching } = useQuery({ queryKey: ['paging', 'directory', 'all', search], queryFn: () => searchPagingDirectory(search, { all: true }), staleTime: 15_000 })
  const recent = useRecentPeople(meta)
  const canCode = !!meta?.canBroadcast || hasPermission('comms.calls.broadcast')

  useEffect(() => {
    if (!calls.length) return undefined
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [calls.length])
  useEffect(() => { if (mode === 'code' && !code.code) setCode((c) => ({ ...c, code: (meta?.codes ?? []).find((x) => x.enabled)?.code ?? '' })) }, [mode, meta, code.code])

  const onlineOf = (p) => (connected ? isOnline(p.id) : !!p.online)
  const pickedIds = new Set(picked.map((p) => p.id))
  const pick = (p) => {
    const entry = { id: p.id, name: p.name }
    if (multi) setPicked((xs) => (xs.some((x) => x.id === p.id) ? xs.filter((x) => x.id !== p.id) : [...xs, entry].slice(0, 10)))
    else setPicked((xs) => (xs.length === 1 && xs[0].id === p.id ? [] : [entry]))
  }

  // no search: online now → recent → everyone; with a search: the matches, online first
  const sections = useMemo(() => {
    if (search) return [{ label: t('callTabPeople'), rows: [...people].sort((a, b) => Number(onlineOf(b)) - Number(onlineOf(a))) }]
    const seen = new Set()
    const take = (rows) => rows.filter((p) => !seen.has(p.id) && seen.add(p.id))
    const byId = new Map(people.map((p) => [p.id, p]))
    const online = take(people.filter(onlineOf))
    const rec = take(recent.map((r) => ({ ...byId.get(r.id), ...r, designation: r.designation ?? byId.get(r.id)?.designation, departments: byId.get(r.id)?.departments })))
    const rest = take(people)
    return [{ label: t('callTabOnlineNow'), rows: online }, { label: t('callTabRecent'), rows: rec }, { label: t('callTabEveryone'), rows: rest }].filter((s) => s.rows.length)
  }, [search, people, recent, connected, isOnline, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const target = mode === 'person' ? (picked.length ? { type: 'USER', ids: picked.map((p) => p.id) } : null)
    : mode === 'team' ? teamTarget(team)
      : { type: 'EVERYONE', ids: [] }
  const ready = mode === 'code' ? !!code.code && !!code.place.trim() : !!target

  const send = async () => {
    if (!ready || sending) return
    setSending(true)
    try {
      const body = mode === 'code'
        ? { target, priority: 'CODE', code: code.code, location: { text: code.place.trim() } }
        : { target, priority, location: {}, message: note.trim() || undefined }
      const call = await createPageCall(body)
      onSent(call)
      setPicked([]); setNote(''); setQ(''); setMulti(false)
      if (mode !== 'person') { setMode('person'); setTeam({ type: 'DEPARTMENT', key: '' }); setCode({ code: '', place: '' }) }
    } catch (e) {
      showError(errText(e))
    } finally {
      setSending(false)
    }
  }

  const pickedCode = (meta?.codes ?? []).find((c) => c.code === code.code)
  const label = mode === 'code'
    ? t('callTabSendCodeToEveryone', { label: pickedCode?.label ?? t('callTabCodeFallback') })
    : mode === 'team' ? t('callTabCallTeam')
      : picked.length === 1 ? t('callTabCallName', { name: picked[0].name }) : picked.length > 1 ? t('callTabCallPeople', { n: picked.length }) : t('callTabPickSomeone')
  const urgent = priority === 'URGENT' || mode === 'code'

  return (
    <div className="h-full flex flex-col min-h-0">
      {calls.length > 0 && (
        <div className="shrink-0 max-h-[40%] overflow-y-auto scroll-thin p-2 space-y-1.5 border-b border-border bg-bg" aria-live="polite">
          {calls.map((c) => <CallCard key={c.id} call={c} now={now} onDismiss={onDismiss} onUpdate={onUpdate} />)}
        </div>
      )}

      {mode !== 'code' && (
        <div className="shrink-0 px-3 pt-2.5 pb-2 space-y-2">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('howUrgent')}>
            <button type="button" role="radio" aria-checked={priority === 'URGENT'} onClick={() => setPriority('URGENT')}
              className={clsx('h-10 rounded-lg border-2 text-sm font-semibold transition-colors', priority === 'URGENT' ? 'border-danger-500 bg-danger-500 text-white' : 'border-border text-danger-600 hover:bg-danger-50')}>
              {t('priorities.URGENT')}
            </button>
            <button type="button" role="radio" aria-checked={priority === 'ROUTINE'} onClick={() => setPriority('ROUTINE')}
              className={clsx('h-10 rounded-lg border-2 text-sm font-semibold transition-colors', priority === 'ROUTINE' ? 'border-ink bg-bg text-ink' : 'border-border text-ink-muted hover:bg-bg')}>
              {t('priorities.ROUTINE')}
            </button>
          </div>
          {mode === 'person' && (
            <div className="relative">
              <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('callTabSearchPlaceholder')} className="ps-9" aria-label={t('findPersonAria')} />
            </div>
          )}
          {mode === 'person' && picked.length > 0 && multi && (
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 h-6 ps-0.5 pe-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium">
                  <Avatar name={p.name} size={20} />
                  {firstName(p.name)}
                  <button type="button" aria-label={t('callComposerRemovePerson', { name: p.name })} onClick={() => pick(p)} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-brand-100"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
        {mode === 'person' && (
          <div className="px-1.5 pb-2">
            {isFetching && !people.length && <p className="px-3 py-4 text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('looking')}</p>}
            {!isFetching && !sections.length && <p className="px-3 py-4 text-sm text-ink-muted">{search ? t('nobodyFound') : t('callTabNoColleagues')}</p>}
            {sections.map((s) => (
              <Section key={s.label} label={s.label}>
                {s.rows.map((p) => <PersonRow key={p.id} p={p} online={onlineOf(p)} picked={pickedIds.has(p.id)} onPick={pick} />)}
              </Section>
            ))}
          </div>
        )}
        {mode === 'team' && <TeamPicker meta={meta} value={team} onChange={setTeam} />}
        {mode === 'code' && <CodePicker meta={meta} value={code} onChange={setCode} />}
      </div>

      <div className="shrink-0 border-t border-border p-2.5 space-y-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {mode !== 'code' && (
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('callTabNotePlaceholder')} aria-label={t('callTabNoteAria')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />
        )}
        <button type="button" onClick={send} disabled={!ready || sending}
          className={clsx('w-full h-11 rounded-lg text-white text-base font-semibold flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed',
            urgent ? 'bg-danger-500 hover:bg-danger-600 disabled:bg-danger-300' : 'bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300')}>
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'code' ? <Siren className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
          <span className="truncate">{label}</span>
        </button>
        <div className="flex items-center justify-between gap-2 text-xs">
          {mode === 'person' ? (
            <>
              <button type="button" onClick={() => { setMulti((m) => !m); if (multi) setPicked((xs) => xs.slice(0, 1)) }} className="text-brand-600 hover:underline">
                {multi ? t('callTabJustOne') : t('callTabAddMore')}
              </button>
              <span className="flex items-center gap-3">
                <button type="button" onClick={() => setMode('team')} className="text-brand-600 hover:underline inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t('callTabCallATeam')}</button>
                {canCode && <button type="button" onClick={() => setMode('code')} className="text-danger-600 hover:underline inline-flex items-center gap-1"><Siren className="w-3.5 h-3.5" /> {t('priorities.CODE')}</button>}
              </span>
            </>
          ) : (
            <button type="button" onClick={() => setMode('person')} className="text-brand-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> {t('callTabBackToPeople')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
