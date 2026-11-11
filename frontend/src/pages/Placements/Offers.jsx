import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Ban, Briefcase, Download, Gauge as GaugeIcon, Medal, Plus, TrendingUp, Trophy, Undo2, Users, XCircle } from 'lucide-react'
import { OFFER_STATUS, formatLpa } from '@schoolgiant/shared'
import {
  DateInput, Attachments, ColorChip, ColumnBars, DataTable, DateCell, Drawer, FactGrid, Fact, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, PersonCell, RankBars,
  SearchInput, SegmentedControl, Select, StatCardRow, Textarea, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { createOffer, decideOffer, exportOffers, fetchOfferStats, fetchOffers } from '../../api/placements'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CompanyLogo, CtcChip, OfferStatusPill, StudentFinder, lakhsToPaise, usePlacementLabels, usePlacementsMeta } from '../../components/placements/PlacementsKit'

const PAGE = 50

function NewOffer({ onClose, onSaved }) {
  const { t } = useTranslation('placements')
  const { showError } = useSnackbar()
  const { data: meta } = usePlacementsMeta()
  const [student, setStudent] = useState(null)
  const [f, setF] = useState({ companyId: '', ctc: '', role: '', location: '', joiningDate: '', offeredOn: '', note: '' })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => createOffer({ ...f, studentId: student?.id, ctc: lakhsToPaise(f.ctc) }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('placements.offers.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!student || !f.companyId || !(Number(f.ctc) > 0)} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-3">
        <StudentFinder value={student} onPick={setStudent} error={errors.studentId} />
        <FormField label={t('placements.offers.company')} required error={errors.companyId}>
          <Select value={f.companyId} onChange={set('companyId')}><option value="">{t('placements.driveForm.pickCompany')}</option>{(meta?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('placements.select.ctc')} required error={errors.ctc}><Input type="number" min="0" step="0.1" value={f.ctc} onChange={set('ctc')} /></FormField>
          <FormField label={t('placements.select.role')}><Input value={f.role} onChange={set('role')} /></FormField>
          <FormField label={t('placements.offers.offeredOn')}><DateInput value={f.offeredOn} onChange={set('offeredOn')} /></FormField>
          <FormField label={t('placements.select.joining')}><DateInput value={f.joiningDate} onChange={set('joiningDate')} /></FormField>
        </div>
        <FormField label={t('placements.select.location')}><Input value={f.location} onChange={set('location')} /></FormField>
        <FormField label={t('placements.offers.note')}><Textarea rows={2} value={f.note} onChange={set('note')} /></FormField>
        <p className="text-xs text-ink-muted">{t('placements.offers.offCampusHint')}</p>
      </div>
    </Modal>
  )
}

function OfferDrawer({ offer: o, onClose, onDecide, canDecide }) {
  const { t } = useTranslation('placements')
  const { date } = useFormat()
  return (
    <Drawer open onClose={onClose} size="lg" title={o.student.name} subtitle={o.company?.name}
      footer={canDecide && <DecisionButtons offer={o} onDecide={onDecide} />}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <CompanyLogo name={o.company?.name} size={52} />
          <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{o.role ?? '—'}</p><p className="text-sm text-ink-muted">{o.company?.name}{o.drive ? ` · ${o.drive.title}` : ` · ${t('placements.offers.offCampus')}`}</p></div>
          <OfferStatusPill status={o.status} />
        </div>
        <FactGrid>
          <Fact label={t('placements.offers.ctc')} value={formatLpa(o.ctc)} />
          <Fact label={t('placements.offers.offeredOn')} value={date(o.offeredOn)} />
          <Fact label={t('placements.select.joining')} value={o.joiningDate ? date(o.joiningDate) : '—'} />
          <Fact label={t('placements.select.location')} value={o.location ?? '—'} />
          <Fact label={t('placements.candidates.program')} value={[o.student.program ?? o.student.classShort, o.student.batch].filter(Boolean).join(' · ') || '—'} />
          <Fact label={t('placements.offers.decidedOn')} value={o.decidedOn ? date(o.decidedOn) : '—'} />
        </FactGrid>
        {o.note && <p className="whitespace-pre-line rounded-xl bg-black/[0.03] p-3 text-sm text-ink">{o.note}</p>}
        <Attachments entityType="placement_offer" entityId={o.id} category="OTHER" label={t('placements.offers.letter')} canAdd={hasPermission('placements.offers.create') && o.status !== 'REVOKED'} />
      </div>
    </Drawer>
  )
}

function DecisionButtons({ offer: o, onDecide }) {
  const { t } = useTranslation('placements')
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {o.status === 'OFFERED' && <Button size="sm" variant="secondary" icon={BadgeCheck} onClick={() => onDecide(o, 'ACCEPTED')}>{t('placements.offers.accept')}</Button>}
      {o.status === 'OFFERED' && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => onDecide(o, 'DECLINED')}>{t('placements.offers.decline')}</Button>}
      {['OFFERED', 'ACCEPTED'].includes(o.status) && <Button size="sm" variant="ghost" icon={Ban} onClick={() => onDecide(o, 'REVOKED')}>{t('placements.offers.revoke')}</Button>}
      {['DECLINED', 'REVOKED'].includes(o.status) && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => onDecide(o, 'OFFERED')}>{t('placements.offers.reopen')}</Button>}
    </div>
  )
}

/** Placements › Offers: every offer (from drives and off campus) with accept / decline, the offer letters, and the year's statistics. */
export default function PlacementsOffers() {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = usePlacementsMeta()
  const [yearId, setYearId] = useState('')
  const [status, setStatus] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [programId, setProgramId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const year = yearId || meta?.currentYearId || undefined
  const params = { yearId: year, status: status || undefined, companyId: companyId || undefined, programId: programId || undefined, search: q || undefined, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['placements', 'offers', params], queryFn: () => fetchOffers(params), enabled: !!meta })
  const { data: stats } = useQuery({ queryKey: ['placements', 'stats', year], queryFn: () => fetchOfferStats({ yearId: year }), enabled: !!meta })
  const refresh = () => qc.invalidateQueries({ queryKey: ['placements'] })
  const decide = useMutation({
    mutationFn: ({ o, status: s, note }) => decideOffer(o.id, { status: s, note }),
    onSuccess: (o) => { refresh(); setOpen(o); showSuccess(t('placements.offers.decided', { status: L.offer(o.status) })) },
    onError: (e) => showError(e.message),
  })
  const onDecide = async (o, s) => {
    if (s === 'ACCEPTED') return decide.mutate({ o, status: s })
    const note = await prompt({ title: t(`placements.offers.ask.${s}`, { name: o.student.name, company: o.company?.name }), label: t('placements.offers.why'), required: s === 'REVOKED' })
    if (note === null || note === undefined) return
    decide.mutate({ o, status: s, note: note || undefined })
  }
  const canDecide = hasPermission('placements.offers.create')
  const tot = stats?.totals ?? {}
  const ctc = stats?.ctc ?? {}
  const rows = data?.data ?? []
  return (
    <PageContainer>
      <PageHeader icon={Trophy} title={t('placements.offers.title')} subtitle={t('placements.offers.subtitle')}
        actions={<>
          <HeaderButton icon={Download} requires="placements.offers.export" onClick={() => exportOffers({ ...params, page: undefined, pageSize: undefined }).catch((e) => showError(e.message))}>{t('placements.offers.export')}</HeaderButton>
          <HeaderButton icon={Plus} variant="primary" requires="placements.offers.create" onClick={() => setAdding(true)}>{t('placements.offers.new')}</HeaderButton>
        </>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40"><Select value={year ?? ''} onChange={(e) => { setYearId(e.target.value); setPage(1) }}>{(meta?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select></div>
        {stats?.year && <span className="text-sm text-ink-muted">{t('placements.offers.yearNote', { year: stats.year.name })}</span>}
      </div>
      <StatCardRow items={[
        { icon: Users, label: t('placements.offers.placed'), value: `${tot.placedPct ?? 0}%`, sub: t('placements.offers.placedSub', { placed: tot.placed ?? 0, pool: tot.pool ?? 0 }), tone: 'success', progress: tot.placedPct ?? 0 },
        { icon: Medal, label: t('placements.offers.highest'), value: formatLpa(ctc.highest), tone: 'orange' },
        { icon: GaugeIcon, label: t('placements.offers.median'), value: formatLpa(ctc.median), tone: 'violet' },
        { icon: TrendingUp, label: t('placements.offers.average'), value: formatLpa(ctc.average), tone: 'info' },
        { icon: Briefcase, label: t('placements.offers.offersMade'), value: tot.offers ?? 0, tone: 'brand', segments: [
          { label: L.offer('ACCEPTED'), value: tot.accepted ?? 0, tone: 'success' }, { label: L.offer('OFFERED'), value: tot.pending ?? 0, tone: 'info' },
        ] },
      ]} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <RankBars title={t('placements.offers.byCompany')} subtitle={t('placements.offers.byCompanyHint')} rows={(stats?.byCompany ?? []).map((c) => ({ key: c.id, label: c.name, value: c.offers }))} empty={t('placements.offers.noStats')} />
        <ColumnBars title={t('placements.offers.byProgram')} subtitle={t('placements.offers.byProgramHint')} activeId={programId} onPick={(it) => { setProgramId(it?.id ?? ''); setPage(1) }}
          items={(stats?.byProgram ?? []).filter((p) => p.id !== 'NONE').map((p) => ({ id: p.id, label: `${p.code} (${p.placed}/${p.pool})`, short: p.code, value: p.pct }))} />
        <ColumnBars title={t('placements.offers.bands')} subtitle={t('placements.offers.bandsHint')} items={(stats?.bands ?? []).map((b) => ({ id: b.id, label: `${b.label} LPA`, short: b.label, value: b.value }))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: t('placements.offers.all') }, ...Object.keys(OFFER_STATUS).map((s) => ({ value: s, label: L.offer(s) }))]} />
        <div className="w-48"><Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1) }}><option value="">{t('placements.offers.allCompanies')}</option>{(meta?.companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div className="w-full sm:w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('placements.offers.search')} /></div>
      </div>
      <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} onRowClick={setOpen} emptyIcon={Trophy} emptyTitle={t('placements.offers.empty')}
        columns={[
          { key: 'student', header: t('placements.candidates.student'), mobilePrimary: true, render: (s) => <PersonCell name={s.name} sub={[s.admissionNo, s.batch].filter(Boolean).join(' · ')} /> },
          { key: 'program', header: t('placements.candidates.program'), mobileHidden: true, render: (_, o) => <ColorChip label={o.student.program ?? o.student.classShort} /> },
          { key: 'company', header: t('placements.offers.company'), render: (c, o) => <span className="flex items-center gap-2"><CompanyLogo name={c?.name} size={28} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{c?.name}</span><span className="block truncate text-xs text-ink-faint">{o.role ?? (o.offCampus ? t('placements.offers.offCampus') : o.drive?.title)}</span></span></span> },
          { key: 'ctc', header: t('placements.offers.ctc'), align: 'right', sortAccessor: (o) => o.ctc, render: (v) => <CtcChip value={v} dream={meta?.settings?.dreamCtc} /> },
          { key: 'offeredOn', header: t('placements.offers.offeredOn'), mobileHidden: true, render: (v) => <DateCell value={v} /> },
          { key: 'status', header: t('placements.offers.status'), render: (v) => <OfferStatusPill status={v} /> },
          ...(canDecide ? [{ key: 'id', header: '', align: 'right', width: 200, render: (_, o) => <span onClick={(e) => e.stopPropagation()} role="presentation"><DecisionButtons offer={o} onDecide={onDecide} /></span> }] : []),
        ]}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined} />
      {open && <OfferDrawer offer={open} onClose={() => setOpen(null)} onDecide={onDecide} canDecide={canDecide} />}
      {adding && <NewOffer onClose={() => setAdding(false)} onSaved={(o) => { setAdding(false); refresh(); setOpen(o); showSuccess(t('placements.offers.saved')) }} />}
    </PageContainer>
  )
}
