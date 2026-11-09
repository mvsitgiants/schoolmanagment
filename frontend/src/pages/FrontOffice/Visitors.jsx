import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, CalendarRange, QrCode, Clock, ConciergeBell, DoorOpen, LogOut, Phone, Search, UserPlus, Users } from 'lucide-react'
import { FO_ID_TYPES, FO_VISIT_PURPOSES, foDurationLabel } from '@schoolgiant/shared'
import {
  CodeBadge, ColumnBars, DataTable, Drawer, EmptyState, FactGrid, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, PersonCell,
  SearchInput, SegmentedControl, Select, StatCardRow, StatusPill, Tabs, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { ChipPicker, Face, PhotoCapture, PurposeChip, StaffSelect, StudentFinder, useFoLabels } from '../../components/frontoffice/FoKit'
import { checkInVisitor, checkOutVisitor, enquiryFromVisit, fetchAllVisitors, fetchVisitor, fetchVisitorDesk, fetchVisitors, lookupVisitor } from '../../api/frontOffice'
import { fetchAcademicLookup } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'
import { printQrCards } from '../../components/scan/printPoster'
import useUrlSearch from '../../hooks/useUrlSearch'
import { useSearchParams } from 'react-router-dom'

const EMPTY = { name: '', mobile: '', purpose: 'MEET_STAFF', purposeNote: '', from: '', people: 1, hostId: '', student: null, idType: '', idNumber: '', photo: '', badgeNo: '', vehicleNo: '', note: '' }
const PAGE = 50
const fieldsOf = (e) => e?.response?.data?.details?.fields ?? {}

/** The check-in form: mobile first (a returning visitor fills in), purpose, whom to meet, ID and a photo. */
function CheckInDrawer({ open, onClose }) {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [known, setKnown] = useState(null)
  useEffect(() => { if (open) { setF(EMPTY); setErrors({}); setKnown(null) } }, [open])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const lookup = async () => {
    if (String(f.mobile).replace(/\D/g, '').length < 10) return
    try {
      const v = await lookupVisitor(f.mobile)
      setKnown(v)
      if (v) setF((x) => ({ ...x, name: x.name || v.name, from: x.from || v.from || '', idType: x.idType || v.idType || '', idNumber: x.idNumber || v.idNumber || '' }))
    } catch { /* a lookup is only a help */ }
  }
  const save = useMutation({
    mutationFn: () => checkInVisitor({
      name: f.name, mobile: f.mobile, purpose: f.purpose, purposeNote: f.purposeNote, from: f.from, people: Number(f.people) || 1,
      hostId: f.hostId || undefined, studentId: f.student?.id, idType: f.idType, idNumber: f.idNumber, photo: f.photo, badgeNo: f.badgeNo, vehicleNo: f.vehicleNo, note: f.note,
    }),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: ['frontoffice', 'visitors'] }); showSuccess(t('frontoffice.visitors.checkedIn', { name: v.name, badge: v.badgeNo })); onClose() },
    onError: (e) => { setErrors(fieldsOf(e)); showError(e.message) },
  })
  const needsHost = ['MEET_STAFF', 'PARENT_MEETING'].includes(f.purpose)
  return (
    <Drawer open={open} onClose={onClose} title={t('frontoffice.visitors.checkInTitle')} subtitle={t('frontoffice.visitors.checkInSubtitle')} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>{t('frontoffice.common.cancel')}</Button><Button icon={BadgeCheck} loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>{t('frontoffice.visitors.checkIn')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('frontoffice.visitors.mobile')} error={errors.mobile} hint={known ? t('frontoffice.visitors.knownVisitor', { count: known.visits, date: known.lastDate }) : undefined}>
            <Input inputMode="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} onBlur={lookup} placeholder={t('frontoffice.visitors.mobilePlaceholder')} />
          </FormField>
          <FormField label={t('frontoffice.visitors.name')} required error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></FormField>
        </div>
        <ChipPicker label={t('frontoffice.visitors.purpose')} required options={FO_VISIT_PURPOSES.map((p) => ({ value: p.value, label: L.purpose(p.value) }))} value={f.purpose} onChange={(v) => set('purpose', v)} />
        {f.purpose === 'ADMISSION_ENQUIRY' && <Note tone="info">{t('frontoffice.visitors.enquiryHint')}</Note>}
        {(f.purpose === 'OTHER' || f.purpose === 'VENDOR') && (
          <FormField label={t('frontoffice.visitors.purposeNote')}><Input value={f.purposeNote} onChange={(e) => set('purposeNote', e.target.value)} /></FormField>
        )}
        {needsHost && <StaffSelect label={t('frontoffice.visitors.host')} required={f.purpose === 'MEET_STAFF'} error={errors.hostId} value={f.hostId} onChange={(v) => set('hostId', v)} />}
        {f.purpose === 'PARENT_MEETING' && <StudentFinder label={t('frontoffice.visitors.parentOf')} value={f.student} onChange={(s) => set('student', s)} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('frontoffice.visitors.from')} className="sm:col-span-2"><Input value={f.from} onChange={(e) => set('from', e.target.value)} placeholder={t('frontoffice.visitors.fromPlaceholder')} /></FormField>
          <FormField label={t('frontoffice.visitors.people')}><Input type="number" min={1} max={50} value={f.people} onChange={(e) => set('people', e.target.value)} /></FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('frontoffice.visitors.idType')}>
            <Select value={f.idType} onChange={(e) => set('idType', e.target.value)}><option value="">{t('frontoffice.visitors.noId')}</option>{FO_ID_TYPES.map((x) => <option key={x.value} value={x.value}>{L.idType(x.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('frontoffice.visitors.idNumber')}><Input value={f.idNumber} onChange={(e) => set('idNumber', e.target.value)} disabled={!f.idType} /></FormField>
          <FormField label={t('frontoffice.visitors.badge')} hint={t('frontoffice.visitors.badgeHint')} error={errors.badgeNo}><Input value={f.badgeNo} onChange={(e) => set('badgeNo', e.target.value)} /></FormField>
          <FormField label={t('frontoffice.visitors.vehicle')}><Input value={f.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())} /></FormField>
        </div>
        <PhotoCapture value={f.photo} onChange={(v) => set('photo', v)} label={t('frontoffice.visitors.photo')} />
        <FormField label={t('frontoffice.visitors.note')}><Textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} /></FormField>
      </div>
    </Drawer>
  )
}

/** An admission-enquiry visit → an enquiry in Admissions. */
function EnquiryModal({ visitor, onClose }) {
  const { t } = useTranslation('frontoffice')
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState({ childName: '', classId: '', note: '' })
  const { data: lookup } = useQuery({ queryKey: ['academics', 'lookup'], queryFn: fetchAcademicLookup, staleTime: 300_000 })
  const make = useMutation({
    mutationFn: () => enquiryFromVisit(visitor.id, f),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['frontoffice', 'visitors'] }); showSuccess(t('frontoffice.visitors.enquiryMade', { no: r.enquiry.enquiryNo })); onClose() },
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('frontoffice.visitors.enquiryTitle', { name: visitor.name })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('frontoffice.common.cancel')}</Button><Button icon={UserPlus} loading={make.isPending} disabled={f.childName.trim().length < 2} onClick={() => make.mutate()}>{t('frontoffice.visitors.makeEnquiry')}</Button></>}>
      <div className="space-y-3">
        <FormField label={t('frontoffice.visitors.childName')} required><Input autoFocus value={f.childName} onChange={(e) => setF({ ...f, childName: e.target.value })} /></FormField>
        <FormField label={t('frontoffice.visitors.classWanted')}>
          <Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">—</option>{(lookup?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </FormField>
        <FormField label={t('frontoffice.visitors.note')}><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>
      </div>
    </Modal>
  )
}

function VisitorDrawer({ id, onClose, onCheckOut }) {
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const { dateTime } = useFormat()
  const [enquiry, setEnquiry] = useState(false)
  const { data: v } = useQuery({ queryKey: ['frontoffice', 'visitors', 'one', id], queryFn: () => fetchVisitor(id), enabled: !!id })
  return (
    <Drawer open={!!id} onClose={onClose} title={v?.name ?? ''} subtitle={v ? L.purpose(v.purpose) : ''}
      footer={v?.inside && hasPermission('frontoffice.visitors.checkout') && <Button icon={LogOut} onClick={() => onCheckOut(v)}>{t('frontoffice.visitors.checkOut')}</Button>}>
      {v && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Face photo={v.photo} name={v.name} size={88} />
            <div className="space-y-1.5">
              <PurposeChip value={v.purpose} />
              <div className="flex items-center gap-2"><CodeBadge>{v.badgeNo ?? '—'}</CodeBadge>{v.inside ? <StatusPill tone="success">{t('frontoffice.visitors.inside')}</StatusPill> : <StatusPill tone="neutral">{t('frontoffice.visitors.left')}</StatusPill>}</div>
              <p className="text-xs text-ink-muted">{foDurationLabel(v.minutes)}</p>
            </div>
          </div>
          <FactGrid cols={2} items={[
            { label: t('frontoffice.visitors.mobile'), value: v.mobile, icon: Phone },
            { label: t('frontoffice.visitors.host'), value: v.hostName },
            { label: t('frontoffice.visitors.from'), value: v.from },
            { label: t('frontoffice.visitors.people'), value: v.people },
            { label: t('frontoffice.visitors.parentOf'), value: v.studentName },
            { label: t('frontoffice.visitors.idType'), value: v.idType ? `${L.idType(v.idType)}${v.idNumber ? ` · ${v.idNumber}` : ''}` : null },
            { label: t('frontoffice.visitors.vehicle'), value: v.vehicleNo, mono: true },
            { label: t('frontoffice.visitors.purposeNote'), value: v.purposeNote },
            { label: t('frontoffice.visitors.inAt'), value: `${dateTime(v.inAt)} · ${v.checkedInBy ?? ''}` },
            { label: t('frontoffice.visitors.outAt'), value: v.outAt ? `${dateTime(v.outAt)} · ${v.checkedOutBy ?? ''}` : null },
            { label: t('frontoffice.visitors.note'), value: v.note, span: 'full', text: true },
          ]} />
          {v.purpose === 'ADMISSION_ENQUIRY' && (v.enquiryNo
            ? <Note tone="success">{t('frontoffice.visitors.enquiryDone', { no: v.enquiryNo })}</Note>
            : hasPermission('admissions.enquiries.create') && <Note tone="info" actions={<Button size="sm" icon={UserPlus} onClick={() => setEnquiry(true)}>{t('frontoffice.visitors.makeEnquiry')}</Button>}>{t('frontoffice.visitors.enquiryOffer')}</Note>)}
        </div>
      )}
      {enquiry && v && <EnquiryModal visitor={v} onClose={() => setEnquiry(false)} />}
    </Drawer>
  )
}

/** "In the building now": a card per visitor — face, purpose, host, badge, how long — like a bed board. */
function InsideBoard({ rows, onOpen, onCheckOut }) {
  const { t } = useTranslation('frontoffice')
  const { time } = useFormat()
  if (!rows.length) return <EmptyState icon={DoorOpen} title={t('frontoffice.visitors.nobodyInside')} hint={t('frontoffice.visitors.nobodyInsideHint')} />
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {rows.map((v) => {
        const long = v.minutes >= 120
        return (
          <div key={v.id} className={`rounded-xl border bg-surface p-3 ${long ? 'border-amber-300' : 'border-border'}`}>
            <button type="button" onClick={() => onOpen(v.id)} className="flex w-full items-start gap-3 text-start">
              <Face photo={v.photo} name={v.name} size={56} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-ink">{v.name}</span>
                  <CodeBadge>{v.badgeNo ?? '—'}</CodeBadge>
                </span>
                <span className="mt-1 block"><PurposeChip value={v.purpose} /></span>
                <span className="mt-1 block truncate text-xs text-ink-muted">{v.hostName ? t('frontoffice.visitors.meeting', { name: v.hostName }) : v.from ?? ''}</span>
              </span>
            </button>
            <div className="mt-2 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              <span className="text-xs text-ink-muted tabular-nums">{t('frontoffice.visitors.since', { time: time(v.inAt), length: foDurationLabel(v.minutes) })}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]"><span className={`block h-full rounded-full ${long ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (v.minutes / 180) * 100)}%` }} /></span>
              {hasPermission('frontoffice.visitors.checkout') && <Button size="sm" variant="secondary" icon={LogOut} onClick={() => onCheckOut(v)}>{t('frontoffice.visitors.checkOut')}</Button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One page of the log; the CSV export fetches every row of the filter (exportAll). */
function LogTable({ rows, loading, onOpen, withDate = false, pagination, exportAll }) {
  const { t } = useTranslation('frontoffice')
  const { time, date } = useFormat()
  return (
    <DataTable rows={rows} loading={loading} onRowClick={(v) => onOpen(v.id)} exportable exportName="visitors" exportAll={exportAll} pagination={pagination} emptyIcon={Users} emptyTitle={t('frontoffice.visitors.emptyLog')}
      columns={[
        { key: 'name', header: t('frontoffice.visitors.name'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.mobile, r.from].filter(Boolean).join(' · ') || undefined} /> },
        { key: 'purpose', header: t('frontoffice.visitors.purpose'), render: (v) => <PurposeChip value={v} /> },
        { key: 'hostName', header: t('frontoffice.visitors.host'), mobileHidden: true, render: (v, r) => v ?? r.studentName ?? '—' },
        { key: 'badgeNo', header: t('frontoffice.visitors.badge'), mobileHidden: true, render: (v) => <CodeBadge>{v ?? '—'}</CodeBadge> },
        { key: 'inAt', header: t('frontoffice.visitors.inAt'), render: (v, r) => <span className="tabular-nums">{withDate ? `${date(r.date)} · ` : ''}{time(v)}</span> },
        { key: 'outAt', header: t('frontoffice.visitors.outAt'), render: (v, r) => (v ? <span className="tabular-nums">{time(v)} <span className="text-ink-faint">· {foDurationLabel(r.minutes)}</span></span> : <StatusPill tone="success">{t('frontoffice.visitors.inside')}</StatusPill>) },
      ]} />
  )
}

/** Front office › Visitor log: check visitors in and out; who is in the building now; today's and this week's numbers. */
/** Numbered visitor badges with a QR (VB-<no>): hand one out at check-in (the badge field); the gate scans it on the way out. */
function BadgeCards({ onClose }) {
  const { t } = useTranslation('frontoffice')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(30)
  const n = Math.max(0, Math.min(200, Number(to) - Number(from) + 1))
  return (
    <Modal open onClose={onClose} size="sm" title={t('frontoffice.visitors.badgeCards')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('frontoffice.common.cancel')}</Button>
      <Button icon={QrCode} disabled={!n} onClick={() => { printQrCards({ title: t('frontoffice.visitors.badgeCards'), heading: t('frontoffice.visitors.badgeHeading'), items: Array.from({ length: n }, (_, i) => ({ code: `VB-${Number(from) + i}`, label: String(Number(from) + i) })) }); onClose() }}>{t('frontoffice.visitors.printBadges', { count: n })}</Button>
    </>}>
      <p className="text-sm text-ink-muted mb-3">{t('frontoffice.visitors.badgeCardsHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('frontoffice.visitors.badgeFrom')}><Input type="number" min="1" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField label={t('frontoffice.visitors.badgeTo')}><Input type="number" min="1" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

export default function FrontOfficeVisitors() {
  const [badges, setBadges] = useState(false)
  const { t } = useTranslation('frontoffice')
  const L = useFoLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(null)
  const { data: desk, isLoading, error, refetch } = useQuery({ queryKey: ['frontoffice', 'visitors', 'desk'], queryFn: fetchVisitorDesk, refetchInterval: 60_000 })
  // the log, a page at a time (today's, or a search across dates); a new tab, range, purpose or search starts at page 1
  const [page, setPage] = useState(1)
  // opened from the header search: the search tab, from the visitor's day
  const [urlParams] = useSearchParams()
  const [search, setSearch, fromUrl] = useUrlSearch()
  const [tab, setTab] = useState(fromUrl ? 'SEARCH' : 'TODAY')
  const [range, setRange] = useState({ from: urlParams.get('date') ?? '', to: '' })
  const [purpose, setPurpose] = useState('')
  const paged = (set) => (v) => { set(v); setPage(1) }
  const q = useDebouncedValue(search.trim(), 300)
  const params = tab === 'TODAY' ? { from: desk?.date, to: desk?.date } : { from: range.from || desk?.weekStart, to: range.to || desk?.date, purpose, search: q }
  const log = useQuery({
    queryKey: ['frontoffice', 'visitors', 'log', params, page], queryFn: () => fetchVisitors({ ...params, page, pageSize: PAGE }),
    enabled: !!desk, placeholderData: (prev) => prev, refetchInterval: tab === 'TODAY' ? 60_000 : false,
  })
  const logPages = log.data && log.data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: log.data.total, totalPages: Math.ceil(log.data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined
  const out = useMutation({
    mutationFn: (v) => checkOutVisitor(v.id),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: ['frontoffice', 'visitors'] }); showSuccess(t('frontoffice.visitors.checkedOut', { name: v.name })) },
    onError: (e) => showError(e.message),
  })
  const checkOut = async (v) => {
    if (await confirm({ title: t('frontoffice.visitors.checkOutConfirm', { name: v.name }), message: v.badgeNo ? t('frontoffice.visitors.collectBadge', { badge: v.badgeNo }) : undefined, confirmLabel: t('frontoffice.visitors.checkOut') })) out.mutate(v)
  }
  const s = desk?.stats
  const purposeBars = useMemo(() => FO_VISIT_PURPOSES.map((p) => ({ id: p.value, label: L.purpose(p.value), value: s?.byPurpose?.[p.value] ?? 0, tone: p.tone })), [s, L])
  return (
    <PageContainer>
      <PageHeader icon={ConciergeBell} title={t('frontoffice.visitors.title')} subtitle={t('frontoffice.visitors.subtitle')}
        actions={<>
          {hasPermission('frontoffice.visitors.create') && <Button variant="secondary" icon={QrCode} onClick={() => setBadges(true)}>{t('frontoffice.visitors.badgeCards')}</Button>}
          {hasPermission('frontoffice.visitors.create') && <Button icon={UserPlus} onClick={() => setAdding(true)}>{t('frontoffice.visitors.checkIn')}</Button>}
        </>} />
      {badges && <BadgeCards onClose={() => setBadges(false)} />}
      {error && <EmptyState error={error} onRetry={refetch} />}
      {s && <StatCardRow items={[
        { icon: DoorOpen, tone: s.inside ? 'success' : 'neutral', label: t('frontoffice.visitors.statInside'), value: s.inside },
        { icon: Users, tone: 'brand', label: t('frontoffice.visitors.statToday'), value: s.today, sub: t('frontoffice.visitors.statTodaySub', { count: s.out }) },
        { icon: CalendarRange, tone: 'violet', label: t('frontoffice.visitors.statWeek'), value: s.week },
        { icon: Clock, tone: 'sky', label: t('frontoffice.visitors.statAvg'), value: s.avgMinutes ? foDurationLabel(s.avgMinutes) : '—' },
      ]} />}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t('frontoffice.visitors.insideTitle')} subtitle={t('frontoffice.visitors.insideSubtitle')} icon={DoorOpen} iconTone="success">
          {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-black/[0.04]" /> : <InsideBoard rows={desk?.inside ?? []} onOpen={setOpen} onCheckOut={checkOut} />}
        </Panel>
        <div className="grid gap-4">
          <ColumnBars title={t('frontoffice.visitors.byPurpose')} subtitle={t('frontoffice.visitors.today')} items={purposeBars} activeId={purpose} onPick={(it) => { setPurpose(it?.id ?? ''); setTab('SEARCH'); setPage(1) }} />
          <ColumnBars title={t('frontoffice.visitors.byHour')} subtitle={t('frontoffice.visitors.today')} items={(s?.byHour ?? []).map((h) => ({ id: h.hour, label: `${h.hour}:00`, short: h.hour, value: h.count, tone: 'brand' }))} />
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card space-y-3">
        <Tabs value={tab} onChange={paged(setTab)} tabs={[{ value: 'TODAY', label: t('frontoffice.visitors.tabToday') }, { value: 'SEARCH', label: t('frontoffice.visitors.tabSearch'), icon: Search }]} />
        {tab === 'TODAY' ? <LogTable rows={log.data?.rows ?? []} loading={isLoading || log.isLoading} onOpen={setOpen} pagination={logPages} exportAll={() => fetchAllVisitors(params)} /> : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <FormField label={t('frontoffice.common.from')}><Input type="date" value={range.from || desk?.weekStart || ''} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1) }} /></FormField>
              <FormField label={t('frontoffice.common.to')}><Input type="date" value={range.to || desk?.date || ''} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1) }} /></FormField>
              <SegmentedControl value={purpose} onChange={paged(setPurpose)} options={[{ value: '', label: t('frontoffice.common.all') }, ...FO_VISIT_PURPOSES.map((p) => ({ value: p.value, label: L.purpose(p.value) }))]} />
              <div className="w-64"><SearchInput value={search} onChange={paged(setSearch)} placeholder={t('frontoffice.visitors.search')} /></div>
            </div>
            <LogTable rows={log.data?.rows ?? []} loading={log.isLoading} onOpen={setOpen} withDate pagination={logPages} exportAll={() => fetchAllVisitors(params)} />
          </>
        )}
      </div>
      <CheckInDrawer open={adding} onClose={() => setAdding(false)} />
      <VisitorDrawer id={open} onClose={() => setOpen(null)} onCheckOut={async (v) => { await checkOut(v); setOpen(null) }} />
    </PageContainer>
  )
}
