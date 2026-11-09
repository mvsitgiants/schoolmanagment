import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BellRing, CheckCircle2, Download, PhoneCall, Plus, Siren, Timer, XCircle } from 'lucide-react'
import { PAGE_CALL_STATUSES, PAGE_PRIORITIES } from '@schoolgiant/shared'
import {
  Avatar, DataTable, DateRangeChip, Drawer, Field, HeaderButton, PageContainer, PageHeader, Panel, PhoneLink, SearchInput, Select, StatCardRow, Tabs,
  presetRange, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { CallModal } from '../../components/comms/CallComposer'
import { CallStatusPill, CallTile, CodeTile, PriorityPill, RecipientStatusPill, answerSummary, errText, secondsText, sinceText } from '../../components/comms/PagingBits'
import { closePageCall, exportCallLog, fetchActiveCalls, fetchCallLog, fetchPageCall, fetchPagingMeta } from '../../api/comms'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { downloadBlob } from '../../utils/download'
import { useFormat } from '../../context/SettingsContext'
import { useRealtime, useRealtimeEvent } from '../../context/RealtimeContext'
import { useSnackbar } from '../../context/SnackbarContext'

const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)

/** Can I close this call? The caller, anyone on the way, or whoever may send alerts. */
function canClose(call, me) {
  if (!call || call.status !== 'ACTIVE') return false
  if (call.from?.userId === me) return true
  if (call.recipients?.some((r) => r.userId === me && r.status === 'ACKNOWLEDGED')) return true
  return hasPermission('comms.calls.broadcast')
}

function useCloseCall() {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  return async (call) => {
    const code = call.priority === 'CODE'
    const note = await prompt({
      title: code ? t('allClearConfirmTitle', { label: call.codeLabel }) : t('closeCallConfirmTitle', { callNo: call.callNo }),
      label: t('noteOptional'),
      placeholder: code ? t('codeNotePlaceholder') : '',
      confirmLabel: code ? t('allClear') : t('closeCall'),
    })
    if (note === null || note === undefined) return
    try {
      const out = await closePageCall(call.id, note)
      qc.setQueryData(['paging', 'active'], (prev = []) => prev.filter((c) => c.id !== out.id))
      qc.setQueryData(['paging', 'call', out.id], out)
      qc.invalidateQueries({ queryKey: ['paging', 'log'] })
      showSuccess(code ? t('allClearSuccess', { label: call.codeLabel }) : t('callClosedSuccess', { callNo: call.callNo }))
    } catch (e) { showError(errText(e)) }
  }
}

function historyText(h, t) {
  if (h.action === 'ESCALATE') return t('escalateStep', { step: h.step, label: h.label ?? (h.to ? t(`escalateTo.${h.to}`, { defaultValue: h.to }) : ''), added: h.added ?? 0 })
  if (h.action === 'AUTO_CLOSE') return t('autoClosedNote', { note: h.note ?? '' })
  return t('stepNote', { step: h.step, note: h.note ?? '' })
}

function CallDrawer({ id, onClose, me }) {
  const { t } = useTranslation(['comms', 'common'])
  const { dateTime, time } = useFormat()
  const close = useCloseCall()
  const { data: c } = useQuery({ queryKey: ['paging', 'call', id], queryFn: () => fetchPageCall(id), enabled: !!id })
  const code = c?.priority === 'CODE'
  return (
    <Drawer open={!!id} onClose={onClose} size="lg" subtitle={c ? t('callNoTitle', { callNo: c.callNo }) : t('call')} title={c ? (code ? c.codeLabel : t('fromTo', { from: c.from?.name ?? '—', to: c.target?.label ?? '—' })) : '…'}
      footer={c && canClose(c, me) && (
        <div className="flex justify-end">
          <Button icon={code ? CheckCircle2 : XCircle} variant={code ? 'primary' : 'secondary'} onClick={() => close(c)}>{code ? t('allClear') : t('closeCall')}</Button>
        </div>
      )}>
      {c && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><CallTile call={c} size={28} /><PriorityPill call={c} /><CallStatusPill status={c.status} /></div>
          <div className="space-y-2">
            <Field label={t('from')}>
              <span className="inline-flex items-center gap-2 flex-wrap"><Avatar name={c.from?.name} size={22} soft />{c.from?.name}{c.from?.designation ? ` · ${c.from.designation}` : ''} {c.from?.phone && <PhoneLink number={c.from.phone} />}</span>
            </Field>
            <Field label={t('to')}>{c.target?.label}</Field>
            {c.location?.label && <Field label={t('where')}>{c.location.label}</Field>}
            {c.message && <Field label={t('message')}>{c.message}</Field>}
            <Field label={t('called')}>{dateTime(c.createdAt)}</Field>
            <Field label={t('firstAnswer')}>{c.firstAckAt ? `${time(c.firstAckAt)} · ${t('afterSeconds', { time: secondsText(c.firstAckSeconds, t) })}` : '—'}</Field>
            {c.closed && <Field label={c.status === 'ALL_CLEAR' ? t('allClear') : t('closed')}>{dateTime(c.closed.at)} · {c.closed.by}{c.closed.note ? ` — ${c.closed.note}` : ''}</Field>}
          </div>
          <Panel title={t('peopleRung', { count: c.recipients?.length ?? 0 })}>
            <ul className="divide-y divide-border -my-2">
              {(c.recipients ?? []).map((r) => (
                <li key={`${r.userId}-${r.step ?? 0}`} className="py-1.5 flex items-center gap-2.5">
                  <Avatar name={r.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink font-medium truncate">{r.name}{r.userId === me ? ` ${t('you')}` : ''}</span>
                    <span className="block text-[11px] text-ink-faint truncate">
                      {[r.designation, r.step ? t('escalationStepShort', { step: r.step }) : null, r.respondSeconds !== undefined && r.respondSeconds !== null ? t('answeredIn', { time: secondsText(r.respondSeconds, t) }) : null, r.reason].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <RecipientStatusPill r={r} />
                </li>
              ))}
            </ul>
          </Panel>
          {c.escalation?.history?.length > 0 && (
            <Panel title={t('escalation')}>
              <ul className="space-y-1.5 text-sm">
                {c.escalation.history.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink-faint font-mono-num shrink-0">{time(h.at)}</span>
                    <span className="text-ink">{historyText(h, t)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </Drawer>
  )
}

/** Call bell: what is ringing now, my calls, and the log with response times. */
export default function Calls() {
  const { t } = useTranslation(['comms', 'common'])
  const qc = useQueryClient()
  const realtime = useRealtime()
  const me = useAuthUser()?.user?.id
  const { dateTime } = useFormat()
  const { showError } = useSnackbar()
  const close = useCloseCall()
  const [tab, setTab] = useState('active')
  const [composeOpen, setComposeOpen] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [range, setRange] = useState(() => presetRange('last7'))
  const [priority, setPriority] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 300)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])

  const { data: meta } = useQuery({ queryKey: ['paging', 'meta'], queryFn: fetchPagingMeta, staleTime: 60_000 })
  const { data: active = [], isLoading } = useQuery({ queryKey: ['paging', 'active'], queryFn: fetchActiveCalls, refetchInterval: realtime.connected ? false : 20_000 })
  const today = useMemo(() => presetRange('today'), [])
  const { data: todayLog } = useQuery({ queryKey: ['paging', 'log', 'today', today.from], queryFn: () => fetchCallLog({ from: today.from, to: today.to }), staleTime: 30_000 })
  const params = {
    from: range.from, to: range.to, priority: priority || undefined, code: code || undefined, status: status || undefined,
    search: debounced || undefined, mine: tab === 'mine' ? 'true' : undefined,
  }
  // the log is paged (newest first); any change of filter goes back to the first page
  const [page, setPage] = useState(1)
  const filterKey = JSON.stringify(params)
  useEffect(() => setPage(1), [filterKey])
  const { data: log, isLoading: logLoading } = useQuery({ queryKey: ['paging', 'log', params, page], queryFn: () => fetchCallLog({ ...params, page, pageSize: 25 }), enabled: tab !== 'active', placeholderData: (p) => p })

  // live: alerts for everyone, every call for those who may send alerts; rooms are re-joined after a reconnect
  const { connected, emit } = realtime
  useEffect(() => {
    if (!connected) return undefined
    emit('page:watch').catch(() => {})
    return () => { emit('page:unwatch').catch(() => {}) }
  }, [connected, emit])
  const refreshLog = useRef(null)
  useRealtimeEvent('page:update', ({ call } = {}) => {
    if (!call?.id) return
    qc.setQueryData(['paging', 'active'], (prev = []) => {
      const rest = prev.filter((c) => c.id !== call.id)
      return call.status === 'ACTIVE' ? [call, ...rest].sort(byNewest) : rest
    })
    qc.setQueryData(['paging', 'call', call.id], call)
    clearTimeout(refreshLog.current)
    refreshLog.current = setTimeout(() => qc.invalidateQueries({ queryKey: ['paging', 'log'] }), 4000)
  })
  useEffect(() => () => clearTimeout(refreshLog.current), [])

  const download = async () => {
    try { downloadBlob({ data: await exportCallLog({ ...params, mine: undefined }) }, `calls-${range.from}-${range.to}.csv`) } catch (e) { showError(errText(e)) }
  }

  const tm = todayLog?.metrics
  const m = log?.metrics
  const codesActive = active.filter((c) => c.priority === 'CODE').length

  const callCol = {
    key: 'callNo', header: t('call'), mobilePrimary: true, sortable: true, sortAccessor: (r) => r.createdAt,
    render: (v, r) => (
      <div className="flex items-center gap-2.5 min-w-0">
        {r.priority === 'CODE' ? <CallTile call={r} size={32} /> : <Avatar name={r.from?.name} size={32} />}
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{r.priority === 'CODE' ? r.codeLabel : t('fromTo', { from: r.from?.name ?? '—', to: r.target?.label ?? '—' })}</p>
          <p className="text-[11px] text-ink-faint font-mono-num truncate">{v} · {dateTime(r.createdAt)}{r.priority === 'CODE' && r.from?.name ? ` · ${r.from.name}` : ''}</p>
        </div>
      </div>
    ),
  }

  return (
    <PageContainer>
      <PageHeader icon={BellRing} title={t('callsAndCodes')} subtitle={t('callsAndCodesSubtitle')}
        actions={<>
          {tab !== 'active' && <HeaderButton icon={Download} requires="comms.calls.export" onClick={download}>{t('exportCsv')}</HeaderButton>}
          <HeaderButton icon={Plus} variant="primary" requires="comms.calls.create" onClick={() => setComposeOpen(true)}>{t('newCall')}</HeaderButton>
        </>} />

      <StatCardRow items={[
        { icon: BellRing, label: t('activeNow'), value: active.length, tone: active.length ? 'info' : 'neutral', onClick: () => setTab('active') },
        { icon: Siren, label: t('codesRunning'), value: codesActive, tone: codesActive ? 'danger' : 'neutral' },
        { icon: PhoneCall, label: t('callsToday'), value: tm ? tm.calls : '—', sub: tm ? t('answeredCount', { count: tm.answered }) : undefined, tone: 'brand' },
        { icon: Timer, label: t('medianFirstAnswerToday'), value: tm ? secondsText(tm.medianFirstAckSeconds, t) : '—', tone: 'success' },
      ]} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'active', label: t('activeCount', { count: active.length }) },
        { value: 'mine', label: t('myCalls') },
        { value: 'log', label: t('logAndResponseTimes') },
      ]} />

      {tab === 'active' ? (
        <DataTable title={t('ringingAndInProgress')} rows={active} loading={isLoading} rowKey="id" onRowClick={(r) => setOpenId(r.id)}
          columns={[
            callCol,
            { key: 'priority', header: t('priority'), sortable: true, render: (_, r) => <PriorityPill call={r} /> },
            { key: 'location', header: t('where'), mobileHidden: true, sortAccessor: (r) => r.location?.label, render: (v) => <span className="line-clamp-2">{v?.label ?? '—'}</span> },
            { key: 'counts', header: t('answers'), render: (v, r) => (
              <div className="min-w-0">
                <p className="text-sm text-ink">{answerSummary(v, t)}</p>
                {r.firstResponder && <p className="text-[11px] text-success-600">{r.firstResponder.name}{r.firstResponder.etaMinutes !== undefined && r.firstResponder.etaMinutes !== null ? ` · ${t('minAgo', { m: r.firstResponder.etaMinutes })}` : ''}</p>}
              </div>
            ) },
            { key: 'createdAt', header: t('openFor'), sortable: true, mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{sinceText(v, now, t)}{r.escalation?.step ? ` · ${t('escalatedTimes', { n: r.escalation.step })}` : ''}</span> },
            { key: 'actions', header: '', render: (_, r) => canClose(r, me) && (
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant={r.priority === 'CODE' ? 'primary' : 'secondary'} icon={r.priority === 'CODE' ? CheckCircle2 : XCircle} onClick={() => close(r)}>{r.priority === 'CODE' ? t('allClear') : t('common:actions.close')}</Button>
              </div>
            ) },
          ]}
          emptyIcon={BellRing} emptyTitle={t('nothingRinging')} emptyHint={t('nothingRingingHint')}
          emptyAction={<Button icon={Plus} requires="comms.calls.create" onClick={() => setComposeOpen(true)}>{t('newCall')}</Button>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeChip value={range} onChange={setRange} align="left" />
            <div className="w-36"><Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={t('priority')}><option value="">{t('allPriorities')}</option>{PAGE_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{t(`priorities.${p.value}`)}</option>)}</Select></div>
            <div className="w-40"><Select value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('code')}><option value="">{t('allCodes')}</option>{(meta?.codes ?? []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</Select></div>
            <div className="w-36"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('status')}><option value="">{t('allStatuses')}</option>{Object.keys(PAGE_CALL_STATUSES).map((k) => <option key={k} value={k}>{t(`callStatuses.${k}`)}</option>)}</Select></div>
            <SearchInput value={search} onChange={setSearch} placeholder={t('searchCallsPlaceholder')} className="flex-1 min-w-[12rem] sm:max-w-xs" />
          </div>

          {tab === 'log' && m && (
            <>
              <StatCardRow items={[
                { icon: PhoneCall, label: t('callsTitle'), value: m.calls, sub: t('emergencyCodesCount', { count: m.codes ?? 0 }), tone: 'brand' },
                { icon: CheckCircle2, label: t('answered'), value: m.calls ? t('percent', { n: Math.round((m.answered / m.calls) * 100) }) : '—', sub: t('withoutAnAnswer', { count: m.unanswered ?? 0 }), tone: m.unanswered ? 'warning' : 'success' },
                { icon: Timer, label: t('medianFirstAnswer'), value: secondsText(m.medianFirstAckSeconds, t), sub: t('averageTime', { time: secondsText(m.avgFirstAckSeconds, t) }), tone: 'info' },
                { icon: Siren, label: t('medianCodeAnswer'), value: secondsText(m.codeMedianFirstAckSeconds, t), sub: t('averageTime', { time: secondsText(m.codeAvgFirstAckSeconds, t) }), tone: 'danger' },
              ]} />
              <div className="grid lg:grid-cols-2 gap-4">
                <DataTable title={t('responseByCode')} dense rows={m.byCode ?? []} rowKey="id"
                  columns={[
                    { key: 'label', header: t('code'), mobilePrimary: true, render: (v, r) => <span className="inline-flex items-center gap-2 font-medium text-ink"><CodeTile color={r.color} size={24} />{v}</span> },
                    { key: 'calls', header: t('callsTitle'), align: 'right', sortable: true },
                    { key: 'answered', header: t('answered'), align: 'right', sortable: true },
                    { key: 'medianFirstAckSeconds', header: t('median'), align: 'right', sortable: true, render: (v) => secondsText(v, t) },
                    { key: 'avgFirstAckSeconds', header: t('average'), align: 'right', sortable: true, render: (v) => secondsText(v, t) },
                  ]}
                  emptyIcon={Siren} emptyTitle={t('noEmergencyCodes')} emptyHint={t('noneInPeriod')} />
                <DataTable title={t('responseByPriority')} dense rows={m.byPriority ?? []} rowKey="id"
                  columns={[
                    { key: 'label', header: t('priority'), mobilePrimary: true, render: (v, r) => <span className="font-medium text-ink">{r.id && ['ROUTINE', 'URGENT', 'CODE'].includes(r.id) ? t(`priorities.${r.id}`) : v}</span> },
                    { key: 'calls', header: t('callsTitle'), align: 'right', sortable: true },
                    { key: 'answered', header: t('answered'), align: 'right', sortable: true },
                    { key: 'medianFirstAckSeconds', header: t('median'), align: 'right', sortable: true, render: (v) => secondsText(v, t) },
                    { key: 'avgFirstAckSeconds', header: t('average'), align: 'right', sortable: true, render: (v) => secondsText(v, t) },
                  ]}
                  emptyIcon={PhoneCall} emptyTitle={t('noCalls')} emptyHint={t('noneInPeriod')} />
              </div>
            </>
          )}

          <DataTable title={tab === 'mine' ? t('callsSentOrReceived') : t('allCalls')} rows={log?.rows ?? []} loading={logLoading} rowKey="id" onRowClick={(r) => setOpenId(r.id)}
            pagination={log?.meta && { page: log.meta.page - 1, size: log.meta.pageSize, totalElements: log.meta.total, totalPages: log.meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
            columns={[
              callCol,
              { key: 'priority', header: t('priority'), sortable: true, render: (_, r) => <PriorityPill call={r} /> },
              { key: 'location', header: t('where'), mobileHidden: true, sortAccessor: (r) => r.location?.label, render: (v) => <span className="line-clamp-2">{v?.label ?? '—'}</span> },
              { key: 'counts', header: t('answers'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{answerSummary(v, t)}</span> },
              { key: 'firstAckSeconds', header: t('firstAnswer'), sortable: true, align: 'right', render: (v, r) => <span className="font-mono-num">{secondsText(v, t)}{r.firstResponder ? <span className="block text-[11px] text-ink-faint font-sans">{r.firstResponder.name}</span> : null}</span> },
              { key: 'status', header: t('status'), sortable: true, render: (v) => <CallStatusPill status={v} /> },
            ]}
            emptyIcon={PhoneCall} emptyTitle={t('noCalls')} emptyHint={tab === 'mine' ? t('callsSentOrReceivedHint') : t('noCallsMatchFilters')} />
          {log?.truncated && <p className="text-xs text-ink-muted">{t('showingLatestCalls')}</p>}
        </>
      )}

      <CallModal open={composeOpen} onClose={() => setComposeOpen(false)} />
      <CallDrawer id={openId} onClose={() => setOpenId(null)} me={me} />
    </PageContainer>
  )
}
