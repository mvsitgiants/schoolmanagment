import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CarFront, Clock, LogIn, LogOut, ParkingSquare, ScanQrCode, Search, SquareParking, UserRound } from 'lucide-react'
import { PARKING_PARKERS, PARKING_VEHICLE_KINDS, areaTakes } from '@schoolgiant/shared'
import {
  DataTable, DateInput, EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SearchInput, SegmentedControl, Select,
  StatCardRow, StatusPill, Tabs, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { AreaFill, KindIcon, Plate, STATE_TONE, useParkingLabels, useStay } from '../../components/parking/ParkingKit'
import { fetchGate, fetchGateLog, gateLookup, parkIn, parkOut } from '../../api/parking'
import { hasPermission } from '../../api/auth'
import GateScanner from '../../components/parking/GateScanner'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const PAGE = 50

/** In, asking first when the area is already full (the server says AREA_FULL). */
function useParkIn(onDone) {
  const { t } = useTranslation('parking')
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  return useMutation({
    mutationFn: async (body) => {
      try { return await parkIn(body) } catch (e) {
        const d = e?.response?.data?.details
        if (d?.code !== 'AREA_FULL') throw e
        const ok = await confirm({ title: t('parking.gate.fullTitle', { area: d.area }), message: t('parking.gate.fullMessage', { inside: d.inside, capacity: d.capacity }), confirmLabel: t('parking.gate.parkAnyway'), tone: 'danger' })
        if (!ok) return null
        return parkIn({ ...body, overFull: true })
      }
    },
    onSuccess: (e) => { if (e) { showSuccess(t('parking.gate.inDone', { plate: e.plate })); onDone?.(e) } },
    onError: (e) => showError(e.message),
  })
}

/** A visitor's vehicle (or one whose pass has lapsed): plate, driver, why, where. */
function VisitorModal({ start, areas, onClose, onDone }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const [f, setF] = useState({ plate: start?.plate ?? '', kind: start?.kind ?? 'CAR', name: start?.name ?? '', mobile: start?.mobile ?? '', purpose: '', areaId: '' })
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const fits = areas.filter((a) => areaTakes(a, 'VISITOR', f.kind))
  const go = useParkIn(() => { onDone(); onClose() })
  return (
    <Modal open onClose={onClose} title={t('parking.visitor.title')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('parking.common.cancel')}</Button><Button icon={LogIn} loading={go.isPending} disabled={!f.plate.trim() || !f.name.trim()} onClick={() => go.mutate({ ...f, areaId: fits.some((a) => a.id === f.areaId) ? f.areaId : (fits[0]?.id ?? '') })}>{t('parking.gate.markIn')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('parking.form.plate')} required><Input autoFocus value={f.plate} onChange={(e) => set({ plate: e.target.value.toUpperCase() })} className="font-mono uppercase tracking-wider" data-typein="off" autoComplete="off" /></FormField>
        <FormField label={t('parking.form.kind')}><SegmentedControl value={f.kind} onChange={(kind) => set({ kind })} options={PARKING_VEHICLE_KINDS.map((k) => ({ value: k.value, label: L.kind(k.value) }))} /></FormField>
        <FormField label={t('parking.visitor.name')} required><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></FormField>
        <FormField label={t('parking.form.mobile')}><Input inputMode="tel" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} /></FormField>
        <FormField label={t('parking.visitor.purpose')} className="sm:col-span-2"><Input value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder={t('parking.visitor.purposeHint')} /></FormField>
        <FormField label={t('parking.form.area')} className="sm:col-span-2" hint={!fits.length ? t('parking.visitor.noArea') : undefined}>
          <Select value={fits.some((a) => a.id === f.areaId) ? f.areaId : (fits[0]?.id ?? '')} onChange={(e) => set({ areaId: e.target.value })}>
            {!fits.length && <option value="">{t('parking.form.anyArea')}</option>}
            {fits.map((a) => <option key={a.id} value={a.id}>{a.name}{a.capacity ? ` · ${t('parking.area.freeShort', { count: a.free })}` : ''}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  )
}

/** What the plate or pass number typed at the gate found: the pass, and In / Out. */
function LookupResult({ found, areas, onPick, onVisitor, onChanged }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const stay = useStay()
  const { date, time } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const v = found.vehicle
  const [areaId, setAreaId] = useState(v?.areaId ?? '')
  const goIn = useParkIn(onChanged)
  const goOut = useMutation({ mutationFn: () => parkOut(found.inside.id), onSuccess: (e) => { showSuccess(t('parking.gate.outDone', { plate: e.plate })); onChanged() }, onError: (e) => showError(e.message) })
  const may = hasPermission('parking.gate.create')
  if (!v && found.matches?.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">{t('parking.gate.several')}</p>
        <div className="flex flex-wrap gap-2">{found.matches.map((m) => <button key={m.id} type="button" onClick={() => onPick(m.passNo)} className="rounded-lg border border-border px-2 py-1.5 hover:border-brand-300"><Plate plate={m.plate} /> <span className="text-xs text-ink-muted">{m.ownerName}</span></button>)}</div>
      </div>
    )
  }
  if (!v) {
    return (
      <Note tone={found.inside ? 'info' : 'warning'} actions={found.inside ? (may && <Button size="sm" icon={LogOut} loading={goOut.isPending} onClick={() => goOut.mutate()}>{t('parking.gate.markOut')}</Button>) : (may && <Button size="sm" icon={UserRound} onClick={() => onVisitor({ plate: found.plate })}>{t('parking.gate.asVisitor')}</Button>)}>
        {found.inside ? t('parking.gate.visitorInside', { plate: found.inside.plate, name: found.inside.name ?? '', time: time(found.inside.inAt) }) : t('parking.gate.noPass', { plate: found.plate })}
      </Note>
    )
  }
  const fits = areas.filter((a) => areaTakes(a, v.ownerKind, v.kind))
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <KindIcon kind={v.kind} className="h-6 w-6 text-ink-muted" />
        <Plate plate={v.plate} size="lg" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{v.ownerName}</p>
          <p className="text-xs text-ink-muted">{[L.owner(v.ownerKind), v.ownerKind === 'GUARDIAN' ? v.studentName : null, v.classLabel, v.model, v.colour].filter(Boolean).join(' · ')}</p>
        </div>
        <StatusPill tone={STATE_TONE[v.state]} className="ms-auto">{v.state === 'ACTIVE' ? t('parking.gate.validTill', { date: date(v.validTo) }) : L.state(v.state)}</StatusPill>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {found.inside ? (
          <>
            <p className="text-sm text-ink">{t('parking.gate.insideSince', { time: time(found.inside.inAt), length: stay(found.inside.minutes), area: found.inside.areaName ?? '—' })}</p>
            {may && <Button icon={LogOut} className="ms-auto" loading={goOut.isPending} onClick={() => goOut.mutate()}>{t('parking.gate.markOut')}</Button>}
          </>
        ) : v.state === 'ACTIVE' ? (may && (
          <>
            <Select value={fits.some((a) => a.id === areaId) ? areaId : ''} onChange={(e) => setAreaId(e.target.value)} className="w-56">
              <option value="">{t('parking.form.anyArea')}</option>
              {fits.map((a) => <option key={a.id} value={a.id}>{a.name}{a.capacity ? ` · ${t('parking.area.freeShort', { count: a.free })}` : ''}</option>)}
            </Select>
            <Button icon={LogIn} loading={goIn.isPending} onClick={() => goIn.mutate({ vehicleId: v.id, areaId })}>{t('parking.gate.markIn')}</Button>
          </>
        )) : (
          <>
            <p className="text-sm text-amber-700">{v.state === 'EXPIRED' ? t('parking.gate.expired', { date: date(v.validTo) }) : t('parking.gate.revoked')}</p>
            {may && <Button variant="secondary" icon={UserRound} className="ms-auto" onClick={() => onVisitor({ plate: v.plate, kind: v.kind, name: v.ownerName, mobile: v.ownerMobile })}>{t('parking.gate.asVisitor')}</Button>}
          </>
        )}
      </div>
    </div>
  )
}

function ParkedTable({ rows, loading, withDate, onOut, pagination, empty }) {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const stay = useStay()
  const { date, time } = useFormat()
  return (
    <DataTable rows={rows} loading={loading} pagination={pagination} emptyIcon={CarFront} emptyTitle={empty}
      columns={[
        { key: 'plate', header: t('parking.form.plate'), mobilePrimary: true, render: (v, r) => <span className="flex items-center gap-2"><KindIcon kind={r.kind} /><Plate plate={v} /></span> },
        { key: 'name', header: t('parking.gate.who'), render: (v, r) => <span><span className="block font-medium text-ink">{v ?? '—'}</span><span className="block text-xs text-ink-muted">{[L.owner(r.parker), r.purpose].filter(Boolean).join(' · ')}</span></span> },
        { key: 'areaName', header: t('parking.form.area'), mobileHidden: true, render: (v, r) => <span className="flex items-center gap-1.5">{v ?? '—'}{r.overFull && <StatusPill tone="warning">{t('parking.gate.overFull')}</StatusPill>}</span> },
        { key: 'inAt', header: t('parking.gate.in'), render: (v, r) => <span className="tabular-nums">{withDate ? `${date(r.date)} · ` : ''}{time(v)}</span> },
        { key: 'outAt', header: t('parking.gate.out'), render: (v, r) => (v ? <span className="tabular-nums">{time(v)} <span className="text-ink-faint">· {stay(r.minutes)}</span></span>
          : <span className="flex items-center gap-2"><StatusPill tone={r.long ? 'warning' : 'success'}>{r.long ? t('parking.gate.longStay', { length: stay(r.minutes) }) : stay(r.minutes)}</StatusPill>
            {onOut && hasPermission('parking.gate.create') && <Button size="sm" variant="secondary" icon={LogOut} onClick={(e) => { e.stopPropagation(); onOut(r) }}>{t('parking.gate.markOut')}</Button>}</span>) },
      ]} />
  )
}

/** Parking › Gate: find a vehicle by plate or sticker, mark it in or out, note visitors' vehicles, and see each area's fill. */
export default function ParkingGate() {
  const { t } = useTranslation('parking')
  const L = useParkingLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [text, setText] = useState('')
  const q = useDebouncedValue(text.trim(), 300)
  const [visitor, setVisitor] = useState(null) // { plate … } prefill, or {} — null: closed
  const [scanning, setScanning] = useState(false)
  const [area, setArea] = useState('')
  const [tab, setTab] = useState('NOW')
  const [range, setRange] = useState({ from: '', to: '' })
  const [parker, setParker] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const s2 = useDebouncedValue(search.trim(), 300)
  const { data: desk, isLoading, error, refetch } = useQuery({ queryKey: ['parking', 'gate'], queryFn: fetchGate, refetchInterval: 30_000 })
  const { data: found, isFetching: looking } = useQuery({ queryKey: ['parking', 'lookup', q], queryFn: () => gateLookup(q), enabled: q.length >= 3 })
  const logParams = { from: range.from || desk?.date, to: range.to || desk?.date, parker, search: s2 }
  const log = useQuery({ queryKey: ['parking', 'log', logParams, page], queryFn: () => fetchGateLog({ ...logParams, page, pageSize: PAGE }), enabled: tab === 'LOG' && !!desk, placeholderData: (p) => p })
  const refresh = () => qc.invalidateQueries({ queryKey: ['parking'] })
  const out = useMutation({ mutationFn: (r) => parkOut(r.id), onSuccess: (e) => { refresh(); showSuccess(t('parking.gate.outDone', { plate: e.plate })) }, onError: (e) => showError(e.message) })
  const s = desk?.stats
  const inside = (desk?.inside ?? []).filter((r) => !area || r.areaId === area)
  const logPages = log.data && log.data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: log.data.total, totalPages: Math.ceil(log.data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined
  return (
    <PageContainer>
      <PageHeader icon={SquareParking} title={t('parking.gate.title')} subtitle={t('parking.gate.subtitle')}
        actions={<>
          {hasPermission('parking.gate.create') && <Button variant="secondary" icon={ScanQrCode} onClick={() => setScanning(true)}>{t('parking.gate.scan')}</Button>}
          {hasPermission('parking.gate.create') && <Button icon={UserRound} onClick={() => setVisitor({})}>{t('parking.gate.visitor')}</Button>}
        </>} />
      {error && <EmptyState error={error} onRetry={refetch} />}
      {s && <StatCardRow items={[
        { icon: ParkingSquare, tone: 'brand', label: t('parking.gate.statInside'), value: s.inside },
        { icon: UserRound, tone: s.longStay ? 'warning' : 'neutral', label: t('parking.gate.statVisitors'), value: s.visitorsInside, sub: s.longStay ? t('parking.gate.statLong', { count: s.longStay, hours: desk.visitorHours }) : undefined },
        { icon: LogIn, tone: 'violet', label: t('parking.gate.statToday'), value: s.today, sub: t('parking.gate.statTodaySub', { count: s.todayVisitors }) },
        { icon: AlertTriangle, tone: s.fullAreas ? 'danger' : 'neutral', label: t('parking.gate.statFull'), value: s.fullAreas },
      ]} />}
      <Panel title={t('parking.gate.findTitle')} subtitle={t('parking.gate.findSubtitle')} icon={Search}>
        <div className="space-y-3">
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder={t('parking.gate.findPlaceholder')} className="h-12 ps-10 font-mono text-lg uppercase tracking-wider" data-typein="off" autoComplete="off" />
          </div>
          {q.length >= 3 && (looking && !found ? <p className="text-sm text-ink-muted">{t('parking.form.searching')}</p>
            : found && <LookupResult key={`${found.query}${found.vehicle?.id}${found.inside?.id}`} found={found} areas={desk?.areas ?? []} onPick={setText} onVisitor={setVisitor} onChanged={() => { refresh(); setText('') }} />)}
        </div>
      </Panel>
      {!!desk?.areas?.length && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {desk.areas.map((a) => <AreaFill key={a.id} area={a} active={area === a.id} onClick={() => setArea((x) => (x === a.id ? '' : a.id))} />)}
        </div>
      )}
      {desk && !desk.areas.length && <Note tone="info">{t('parking.gate.noAreas')}</Note>}
      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1) }} tabs={[{ value: 'NOW', label: t('parking.gate.tabNow', { count: inside.length }), icon: Clock }, { value: 'LOG', label: t('parking.gate.tabLog'), icon: Search }]} />
        {tab === 'NOW' ? <ParkedTable rows={inside} loading={isLoading} onOut={(r) => out.mutate(r)} empty={t('parking.gate.nothingParked')} /> : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <FormField label={t('parking.common.from')}><DateInput value={range.from || desk?.date || ''} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1) }} /></FormField>
              <FormField label={t('parking.common.to')}><DateInput value={range.to || desk?.date || ''} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1) }} /></FormField>
              <SegmentedControl value={parker} onChange={(v) => { setParker(v); setPage(1) }} options={[{ value: '', label: t('parking.common.all') }, ...PARKING_PARKERS.map((p) => ({ value: p.value, label: L.owner(p.value) }))]} />
              <div className="w-full sm:w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('parking.gate.logSearch')} /></div>
            </div>
            <ParkedTable rows={log.data?.rows ?? []} loading={log.isLoading} withDate pagination={logPages} empty={t('parking.gate.emptyLog')} />
          </>
        )}
      </div>
      <GateScanner open={scanning} onClose={() => setScanning(false)} onChanged={refresh} onVisitor={(start) => { setScanning(false); setVisitor(start) }} />
      {visitor && <VisitorModal start={visitor} areas={desk?.areas ?? []} onClose={() => setVisitor(null)} onDone={() => { refresh(); setText('') }} />}
    </PageContainer>
  )
}
