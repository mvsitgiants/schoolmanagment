import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, CalendarDays, ClipboardList, Filter, GraduationCap, ListChecks, MapPin, Pencil, Plus, Rocket, Trophy, UserMinus, UserPlus, Users } from 'lucide-react'
import { DRIVE_FLOW, DRIVE_STATUS, formatLpa } from '@schoolgiant/shared'
import {
  BulkActionBar, ColorChip, DataTable, EmptyState, HeaderButton, LevelBar, Note, PageContainer, PageHeader, Panel, PersonCell, SearchInput, SegmentedControl,
  SideNav, SideNavLayout, SkeletonRows, StatCardRow, StatusPill, Tabs, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchDrive, fetchDriveEligible, fetchDrives, setDriveStatus, withdrawFromDrive } from '../../api/placements'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { CompanyLogo, CtcChip, DriveStatusPill, Funnel, RegStatusPill, ResultChip, ctcRange, usePlacementLabels, usePlacementsMeta } from '../../components/placements/PlacementsKit'
import DriveForm from '../../components/placements/DriveForm'
import { RegisterModal, RoundResultsModal, SelectModal } from '../../components/placements/DriveActions'

const STATUS_ICON = { OPEN: Rocket, IN_PROGRESS: ListChecks, COMPLETED: Award, DRAFT: Pencil, CANCELLED: UserMinus }

function Candidates({ drive, canEdit, onChanged }) {
  const { t } = useTranslation('placements')
  const confirm = useConfirm()
  const { data: meta } = usePlacementsMeta()
  const { showError, showSuccess } = useSnackbar()
  const [picked, setPicked] = useState([])
  const [selecting, setSelecting] = useState(null)
  const [show, setShow] = useState('ALL')
  const withdraw = useMutation({ mutationFn: (regId) => withdrawFromDrive(drive.id, regId), onSuccess: () => { showSuccess(t('placements.candidates.withdrawn')); onChanged() }, onError: (e) => showError(e.message) })
  const rows = drive.registrations.filter((g) => g.status !== 'WITHDRAWN' && (show === 'ALL' || g.status === show))
  const last = drive.rounds.at(-1)
  const selectable = (g) => g.status === 'REGISTERED' && (!last || g.rounds[last.id]?.result === 'PASS')
  const chosen = rows.filter((g) => picked.includes(g.id))
  return (
    <div className="space-y-3">
      <SegmentedControl value={show} onChange={setShow} options={['ALL', 'REGISTERED', 'SELECTED', 'REJECTED'].map((v) => ({ value: v, label: v === 'ALL' ? t('placements.candidates.all') : t(`placements.regStatus.${v}`) }))} />
      {picked.length > 0 && canEdit && (
        <BulkActionBar count={picked.length} onClear={() => setPicked([])}>
          <Button size="sm" icon={Trophy} onClick={() => { const ok = chosen.filter(selectable); if (!ok.length) showError(t('placements.candidates.noneSelectable', { round: last?.name ?? '' })); else setSelecting(ok) }}>{t('placements.candidates.selectOffer')}</Button>
        </BulkActionBar>
      )}
      <DataTable rows={rows} rowKey="id" selectable={canEdit} selectedIds={picked} onSelectionChange={setPicked} exportable exportName={`${drive.company?.name ?? 'drive'}-candidates`}
        emptyIcon={Users} emptyTitle={t('placements.candidates.empty')} emptyHint={t('placements.candidates.emptyHint')}
        rowTone={(g) => (g.status === 'SELECTED' ? 'success' : undefined)}
        columns={[
          { key: 'name', header: t('placements.candidates.student'), mobilePrimary: true, render: (v, g) => <PersonCell name={v} sub={[g.admissionNo, g.via === 'APP' ? t('placements.candidates.viaApp') : null].filter(Boolean).join(' · ')} /> },
          { key: 'program', header: t('placements.candidates.program'), mobileHidden: true, render: (v, g) => <ColorChip label={v ?? g.classShort} sub={g.batch ? String(g.batch) : undefined} /> },
          { key: 'cgpa', header: 'CGPA', mobileHidden: true, sortAccessor: (g) => g.cgpa ?? -1, render: (v, g) => (v == null ? <span className="text-ink-faint">—</span> : <LevelBar value={v} max={10} warnAt={drive.eligibility.minCgpa ?? 6} dangerAt={(drive.eligibility.minCgpa ?? 6) - 1} label={v.toFixed(2)} width="w-20" />) },
          { key: 'backlogs', header: t('placements.candidates.backlogs'), align: 'center', mobileHidden: true, render: (v) => (v == null ? '—' : <span className={v ? 'font-semibold text-rose-600' : 'text-ink-muted'}>{v}</span>) },
          ...drive.rounds.map((r, i) => ({ key: `r_${r.id}`, header: `${i + 1}. ${r.name}`, align: 'center', render: (_, g) => <ResultChip result={g.rounds[r.id]?.result} marks={g.rounds[r.id]?.marks} /> })),
          { key: 'status', header: t('placements.candidates.status'), render: (v, g) => (g.offer ? <span className="flex flex-col items-start gap-0.5"><CtcChip value={g.offer.ctc} dream={meta?.settings?.dreamCtc} /><span className="text-[11px] text-ink-faint">{t(`placements.offerStatus.${g.offer.status}`)}</span></span> : <RegStatusPill status={v} />) },
          ...(canEdit ? [{ key: 'id', header: '', align: 'right', width: 60, render: (id, g) => g.status !== 'SELECTED' && <Button size="sm" variant="ghost" icon={UserMinus} aria-label={t('placements.candidates.withdraw')} title={t('placements.candidates.withdraw')} onClick={async () => { if (await confirm({ title: t('placements.candidates.withdrawTitle', { name: g.name }), tone: 'danger' })) withdraw.mutate(id) }} /> }] : []),
        ]} />
      {selecting && <SelectModal drive={drive} candidates={selecting} onClose={() => setSelecting(null)} onDone={(r) => { setSelecting(null); setPicked([]); showSuccess(t('placements.select.done', { count: r.offers })); onChanged() }} />}
    </div>
  )
}

function Eligible({ drive, canEdit, onChanged }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['placements', 'eligible', drive.id], queryFn: () => fetchDriveEligible(drive.id) })
  const [picked, setPicked] = useState([])
  const [registering, setRegistering] = useState(null)
  const [show, setShow] = useState('ELIGIBLE')
  const rows = (data?.data ?? []).filter((s) => (show === 'ALL' ? true : show === 'ELIGIBLE' ? s.eligible && !s.blocked && !s.registered : show === 'REGISTERED' ? s.registered : !s.registered && (!s.eligible || s.blocked)))
  const s = data?.summary
  if (!drive.eligibility.programIds.length && !drive.eligibility.classIds.length) return <Note tone="warning">{t('placements.eligible.noPool')}</Note>
  return (
    <div className="space-y-3">
      {s && <StatCardRow items={[
        { icon: Users, label: t('placements.eligible.pool'), value: s.pool, tone: 'brand', onClick: () => setShow('ALL') },
        { icon: GraduationCap, label: t('placements.eligible.eligible'), value: s.eligible, tone: 'success', progress: s.pool ? (s.eligible / s.pool) * 100 : 0, onClick: () => setShow('ELIGIBLE') },
        { icon: ClipboardList, label: t('placements.eligible.registered'), value: s.registered, tone: 'info', onClick: () => setShow('REGISTERED') },
        { icon: Filter, label: t('placements.eligible.notEligible'), value: data.data.filter((x) => !x.registered && (!x.eligible || x.blocked)).length, tone: 'warning', onClick: () => setShow('NOT') },
      ]} />}
      {picked.length > 0 && canEdit && (
        <BulkActionBar count={picked.length} onClear={() => setPicked([])}>
          <Button size="sm" icon={UserPlus} onClick={() => setRegistering((data?.data ?? []).filter((x) => picked.includes(x.id) && !x.registered))}>{t('placements.eligible.register')}</Button>
        </BulkActionBar>
      )}
      <DataTable rows={rows} loading={isLoading} error={error} onRetry={refetch} rowKey="id" selectable={canEdit} selectedIds={picked} onSelectionChange={setPicked}
        emptyIcon={GraduationCap} emptyTitle={t('placements.eligible.empty')} exportable exportName="eligible-students"
        columns={[
          { key: 'name', header: t('placements.candidates.student'), mobilePrimary: true, render: (v, x) => <PersonCell name={v} sub={x.admissionNo} /> },
          { key: 'program', header: t('placements.candidates.program'), mobileHidden: true, render: (v, x) => <ColorChip label={v ?? x.classShort} sub={x.batch ? String(x.batch) : undefined} /> },
          { key: 'cgpa', header: 'CGPA', sortAccessor: (x) => x.cgpa ?? -1, render: (v) => (v == null ? <span className="text-ink-faint">—</span> : <LevelBar value={v} max={10} warnAt={drive.eligibility.minCgpa ?? 6} dangerAt={(drive.eligibility.minCgpa ?? 6) - 0.01} label={v.toFixed(2)} width="w-20" />) },
          { key: 'backlogs', header: t('placements.candidates.backlogs'), align: 'center', mobileHidden: true, render: (v) => (v == null ? '—' : <span className={v ? 'font-semibold text-rose-600' : 'text-ink-muted'}>{v}</span>) },
          { key: 'bestOffer', header: t('placements.eligible.holds'), mobileHidden: true, render: (v) => (v ? formatLpa(v) : '—') },
          { key: 'eligible', header: t('placements.eligible.verdict'), render: (v, x) => (x.registered ? <StatusPill tone="info">{t('placements.eligible.isRegistered')}</StatusPill> : v && !x.blocked ? <StatusPill tone="success">{t('placements.eligible.yes')}</StatusPill> : (
            <span className="flex flex-wrap gap-1">{[...x.reasons, ...(x.blocked ? [x.blocked] : [])].map((r) => <StatusPill key={r} tone={x.blocked === r ? 'warning' : 'danger'}>{L.reason(r)}</StatusPill>)}</span>
          )) },
        ]} />
      {registering && <RegisterModal drive={drive} students={registering} onClose={() => setRegistering(null)} onDone={(r) => {
        setRegistering(null); setPicked([]); refetch(); onChanged()
        if (r.skipped.length) showError(t('placements.register.partly', { added: r.added, skipped: r.skipped.length, why: r.skipped.map((x) => `${x.name ?? ''}: ${L.reason(x.reason)}`).slice(0, 3).join('; ') }))
        else showSuccess(t('placements.register.done', { count: r.added }))
      }} />}
    </div>
  )
}

function Details({ drive }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const { date } = useFormat()
  const e = drive.eligibility
  const crit = [
    e.minCgpa != null && t('placements.details.minCgpa', { v: e.minCgpa }), e.maxBacklogs != null && t('placements.details.maxBacklogs', { v: e.maxBacklogs }),
    e.min10th != null && t('placements.details.min10th', { v: e.min10th }), e.min12th != null && t('placements.details.min12th', { v: e.min12th }),
  ].filter(Boolean)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title={t('placements.details.roles')}>
        {!drive.roles.length ? <p className="text-sm text-ink-faint">—</p> : (
          <ul className="space-y-2">{drive.roles.map((r, i) => <li key={i} className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-ink">{r.title}</span><span className="text-ink-muted">{[r.openings != null && t('placements.details.openings', { count: r.openings }), r.ctc && formatLpa(r.ctc)].filter(Boolean).join(' · ')}</span></li>)}</ul>
        )}
      </Panel>
      <Panel title={t('placements.details.whoMayApply')}>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1.5">{drive.programs.map((p) => <ColorChip key={p.id} label={p.code} />)}{(e.batches ?? []).map((b) => <ColorChip key={b} label={String(b)} tone="neutral" />)}</div>
          {!drive.programs.length && !e.classIds.length && <p className="text-ink-faint">{t('placements.eligible.noPool')}</p>}
          {crit.length > 0 ? <ul className="list-inside list-disc text-ink-muted">{crit.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="text-ink-faint">{t('placements.details.noCriteria')}</p>}
          {e.note && <p className="text-ink-muted">{e.note}</p>}
        </div>
      </Panel>
      <Panel title={t('placements.details.rounds')} className="lg:col-span-2">
        {!drive.rounds.length ? <p className="text-sm text-ink-faint">{t('placements.driveForm.noRounds')}</p> : (
          <ol className="flex flex-wrap items-stretch gap-2">
            {drive.rounds.map((r, i) => (
              <li key={r.id} className={`flex min-w-[9rem] flex-1 flex-col rounded-xl border p-3 ${r.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-border'}`}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('placements.details.round', { n: i + 1 })} · {L.round(r.kind)}</span>
                <span className="mt-0.5 font-medium text-ink">{r.name}</span>
                <span className="text-xs text-ink-muted">{[r.date && date(r.date), r.maxMarks != null && t('placements.rounds.outOf', { max: r.maxMarks }), r.done && t('placements.details.done')].filter(Boolean).join(' · ') || '—'}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      {drive.description && <Panel title={t('placements.details.about')} className="lg:col-span-2"><p className="whitespace-pre-line text-sm text-ink">{drive.description}</p></Panel>}
    </div>
  )
}

function DriveView({ id, onEdit }) {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [tab, setTab] = useState('candidates')
  const [results, setResults] = useState(false)
  const { data: d, isLoading, error, refetch } = useQuery({ queryKey: ['placements', 'drive', id], queryFn: () => fetchDrive(id) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['placements'] })
  const move = useMutation({
    mutationFn: (status) => setDriveStatus(id, status),
    onSuccess: (r) => { refresh(); showSuccess(r.told ? t('placements.drives.openedTold', { count: r.told }) : t('placements.drives.moved', { status: L.drive(r.status) })) },
    onError: (e) => showError(e.message),
  })
  if (isLoading) return <SkeletonRows rows={8} />
  if (error) return <EmptyState error={error} onRetry={refetch} />
  const canEdit = hasPermission('placements.drives.edit')
  const next = DRIVE_FLOW[d.status] ?? []
  const live = d.registrations.filter((g) => g.status !== 'WITHDRAWN')
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CompanyLogo name={d.company?.name} size={52} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-semibold text-ink">{d.company?.name}</h2><DriveStatusPill status={d.status} />{d.status === 'OPEN' && <StatusPill tone={d.window === 'OPEN' ? 'success' : 'neutral'}>{L.window(d.window)}</StatusPill>}</div>
              <p className="text-sm text-ink-muted">{d.title}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Trophy className="h-3.5 w-3.5" />{ctcRange(d.ctcMin, d.ctcMax)}</span>
                {d.startDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{date(d.startDate)}{d.endDate && d.endDate !== d.startDate && ` – ${date(d.endDate)}`}</span>}
                {(d.registration?.opensOn || d.registration?.closesOn) && <span className="inline-flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" />{t('placements.drives.window', { from: d.registration.opensOn ? date(d.registration.opensOn) : '…', to: d.registration.closesOn ? date(d.registration.closesOn) : '…' })}</span>}
                {d.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{d.location} · {L.mode(d.mode)}</span>}
              </div>
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onEdit(d)}>{t('actions.edit')}</Button>
              {d.rounds.length > 0 && live.length > 0 && <Button size="sm" variant="secondary" icon={ListChecks} onClick={() => setResults(true)}>{t('placements.drives.enterResults')}</Button>}
              {next.map((s) => { const Icon = STATUS_ICON[s]; return <Button key={s} size="sm" variant={s === 'CANCELLED' ? 'ghost' : 'primary'} icon={Icon} loading={move.isPending && move.variables === s}
                onClick={async () => { if (s !== 'CANCELLED' || await confirm({ title: t('placements.drives.cancelTitle'), tone: 'danger' })) move.mutate(s) }}>{t(`placements.drives.to.${s}`)}</Button> })}
            </div>
          )}
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title={t('placements.drives.funnel')} subtitle={t('placements.drives.funnelHint')}><Funnel steps={d.funnel} /></Panel>
        <StatCardRow className="xl:grid-cols-1" items={[
          { icon: Users, label: t('placements.drives.registered'), value: live.length, tone: 'info' },
          { icon: Trophy, label: t('placements.drives.offers'), value: d.offers.made, tone: 'success', sub: t('placements.drives.acceptedSub', { count: d.offers.accepted }) },
        ]} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'candidates', label: t('placements.drives.tabs.candidates', { count: live.length }) },
        { value: 'eligible', label: t('placements.drives.tabs.eligible') },
        { value: 'details', label: t('placements.drives.tabs.details') },
      ]} />
      {tab === 'candidates' && <Candidates drive={d} canEdit={canEdit} onChanged={refresh} />}
      {tab === 'eligible' && <Eligible drive={d} canEdit={canEdit && !['COMPLETED', 'CANCELLED'].includes(d.status)} onChanged={refresh} />}
      {tab === 'details' && <Details drive={d} />}
      {results && <RoundResultsModal drive={d} onClose={() => setResults(false)} onDone={(r) => { setResults(false); refresh(); showSuccess(t('placements.rounds.saved', { count: r.saved })) }} />}
    </div>
  )
}

/** Placements › Drives: each company's drive — who may apply, registrations, the rounds and their shortlists, the funnel, and the selections that become offers. */
export default function PlacementsDrives() {
  const { t } = useTranslation('placements')
  const L = usePlacementLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const [id, setId] = useState(null)
  const [editing, setEditing] = useState(null)
  const params = { status: status || undefined, search: q || undefined }
  const { data, isLoading } = useQuery({ queryKey: ['placements', 'drives', params], queryFn: () => fetchDrives(params) })
  const drives = useMemo(() => data?.data ?? [], [data])
  useEffect(() => { if (drives.length && !drives.some((d) => d.id === id)) setId(drives[0].id) }, [drives, id])
  const sc = data?.statusCounts ?? {}
  return (
    <PageContainer>
      <PageHeader icon={Rocket} title={t('placements.drives.title')} subtitle={t('placements.drives.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="placements.drives.create" onClick={() => setEditing('new')}>{t('placements.drives.new')}</HeaderButton>} />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={status} onChange={setStatus} options={[{ value: '', label: t('placements.drives.all') }, ...Object.keys(DRIVE_STATUS).map((s) => ({ value: s, label: `${L.drive(s)}${sc[s] ? ` · ${sc[s]}` : ''}` }))]} />
        <div className="w-full sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('placements.drives.search')} /></div>
      </div>
      {isLoading ? <SkeletonRows rows={8} /> : !drives.length ? (
        <EmptyState icon={Rocket} title={t('placements.drives.empty')} hint={t('placements.drives.emptyHint')} />
      ) : (
        <SideNavLayout nav={<SideNav title={t('placements.drives.list')} value={id} onChange={setId} items={drives.map((d) => ({
          id: d.id, label: d.company?.name ?? d.title, hint: [d.title, d.startDate && date(d.startDate)].filter(Boolean).join(' · '),
          count: d.counts.registered, countTone: d.status === 'OPEN' ? 'warning' : undefined,
          progress: d.counts.registered ? { value: d.counts.selected, max: d.counts.registered, kind: 'done' } : undefined,
        }))} />}>
          {id && <DriveView key={id} id={id} onEdit={setEditing} />}
        </SideNavLayout>
      )}
      {editing && <DriveForm drive={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(d) => { setEditing(null); qc.invalidateQueries({ queryKey: ['placements'] }); setId(d.id); showSuccess(t('placements.drives.saved')) }} />}
    </PageContainer>
  )
}
