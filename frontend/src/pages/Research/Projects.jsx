import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, Banknote, Briefcase, CalendarRange, FlaskConical, GraduationCap, HandCoins, Plus, Trash2, UserRound, Users, Wallet } from 'lucide-react'
import {
  RESEARCH_AGENCIES, RESEARCH_PROJECT_STATUS, RESEARCH_SCHOLAR_MODES, RESEARCH_SCHOLAR_STATUS, projectUtilisation,
} from '@schoolgiant/shared'
import {
  DateInput, ColorChip, DataTable, FormField, HeaderButton, Input, KanbanBoard, KanbanCard, Modal, Money, Note, PageContainer, PageHeader, PersonCell, PillRow, RankBars,
  SearchInput, Select, StackedBar, StatCardRow, Tabs, Textarea, pillClass, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { deleteProject, deleteScholar, fetchProjects, fetchScholars, saveProject, saveScholar } from '../../api/research'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import {
  PeopleStack, ProjectPill, StaffChips, StaffSelect, paiseOf, rupeesOf, useResearchLabels, useResearchMeta,
} from '../../components/research/ResearchKit'

const PRJ = 'research.projects'

/** Received and utilised against what was sanctioned, as one bar: utilised (solid) inside received (light). */
function UtilisationBar({ p }) {
  const { t } = useTranslation('research')
  if (!p.sanctioned) return <span className="text-ink-faint">—</span>
  const rec = Math.min(100, (p.received / p.sanctioned) * 100)
  const used = Math.min(100, (p.utilised / p.sanctioned) * 100)
  return (
    <span className="inline-flex w-36 flex-col gap-1" title={t('research.projects.utilisationTip', { received: p.receivedPct, utilised: p.utilisedPct })}>
      <span className="relative h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <span className="absolute inset-y-0 start-0 rounded-full bg-brand-200" style={{ width: `${rec}%` }} />
        <span className="absolute inset-y-0 start-0 rounded-full bg-brand-500" style={{ width: `${used}%` }} />
      </span>
      <span className="flex justify-between text-[11px] tabular-nums text-ink-faint">
        <span>{t('research.projects.usedPct', { pct: p.utilisedPct })}</span>
        <span>{t('research.projects.recPct', { pct: p.receivedPct })}</span>
      </span>
    </span>
  )
}

function ProjectForm({ project, onClose, onSaved }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useResearchMeta()
  const [form, setForm] = useState({
    title: project?.title ?? '', piId: project?.piId ?? '', coPiIds: project?.coPiIds ?? [], agency: project?.agency ?? 'DST', agencyName: project?.agencyName ?? '',
    scheme: project?.scheme ?? '', referenceNo: project?.referenceNo ?? '', departmentId: project?.departmentId ?? '',
    sanctioned: rupeesOf(project?.sanctioned), received: rupeesOf(project?.received), utilised: rupeesOf(project?.utilised),
    appliedOn: project?.appliedOn ?? '', sanctionedOn: project?.sanctionedOn ?? '', startDate: project?.startDate ?? '', endDate: project?.endDate ?? '',
    status: project?.status ?? 'APPLIED', notes: project?.notes ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const money = { sanctioned: paiseOf(form.sanctioned), received: paiseOf(form.received), utilised: paiseOf(form.utilised) }
  const u = projectUtilisation(money)
  const save = useMutation({
    mutationFn: () => saveProject(project?.id, { ...form, ...money, departmentId: form.departmentId || null, coPiIds: form.coPiIds }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const staff = meta?.staff ?? []
  return (
    <Modal open onClose={onClose} size="lg" title={project ? t('research.projects.editTitle') : t('research.projects.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.title.trim().length < 3 || !form.piId} onClick={() => save.mutate()}>{t('research.projects.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('research.projects.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} /></FormField>
        <PillRow>
          {Object.keys(RESEARCH_PROJECT_STATUS).map((s) => (
            <button key={s} type="button" aria-pressed={form.status === s} className={pillClass(form.status === s)} onClick={() => setForm((f) => ({ ...f, status: s }))}>{L.project(s)}</button>
          ))}
        </PillRow>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('research.projects.pi')} required error={errors.piId}>
            <StaffSelect value={form.piId} staff={staff} exclude={form.coPiIds} placeholder={t('research.projects.pickPi')} onChange={(piId) => setForm((f) => ({ ...f, piId: piId ?? '' }))} />
          </FormField>
          <FormField label={t('research.projects.department')} error={errors.departmentId} hint={project ? undefined : t('research.projects.departmentHint')}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('research.projects.piDepartment')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('research.projects.coPis')} error={errors.coPiIds} className="sm:col-span-2">
            <StaffChips value={form.coPiIds} staff={staff} exclude={form.piId ? [form.piId] : []} placeholder={t('research.projects.addCoPi')} onChange={(coPiIds) => setForm((f) => ({ ...f, coPiIds }))} />
          </FormField>
          <FormField label={t('research.projects.agency')} required>
            <Select value={form.agency} onChange={set('agency')}>{RESEARCH_AGENCIES.map((a) => <option key={a.value} value={a.value}>{L.agency(a.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('research.projects.agencyName')} hint={t('research.projects.agencyNameHint')}><Input value={form.agencyName} onChange={set('agencyName')} /></FormField>
          <FormField label={t('research.projects.scheme')}><Input value={form.scheme} onChange={set('scheme')} /></FormField>
          <FormField label={t('research.projects.referenceNo')}><Input value={form.referenceNo} onChange={set('referenceNo')} /></FormField>
        </div>
        <div className="rounded-xl border border-border p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t('research.projects.sanctioned')} error={errors.sanctioned}><Input type="number" min="0" step="0.01" value={form.sanctioned} onChange={set('sanctioned')} /></FormField>
            <FormField label={t('research.projects.received')} error={errors.received}><Input type="number" min="0" step="0.01" value={form.received} onChange={set('received')} /></FormField>
            <FormField label={t('research.projects.utilised')} error={errors.utilised}><Input type="number" min="0" step="0.01" value={form.utilised} onChange={set('utilised')} /></FormField>
          </div>
          {money.sanctioned > 0 && <UtilisationBar p={{ ...money, ...u }} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('research.projects.appliedOn')}><DateInput value={form.appliedOn} onChange={set('appliedOn')} /></FormField>
          <FormField label={t('research.projects.sanctionedOn')}><DateInput value={form.sanctionedOn} onChange={set('sanctionedOn')} /></FormField>
          <FormField label={t('research.projects.startDate')}><DateInput value={form.startDate} onChange={set('startDate')} /></FormField>
          <FormField label={t('research.projects.endDate')} error={errors.endDate}><DateInput value={form.endDate} onChange={set('endDate')} /></FormField>
        </div>
        <FormField label={t('research.projects.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
      </div>
    </Modal>
  )
}

function ProjectsTab({ onEdit }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const { date } = useFormat()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [status, setStatus] = useState('')
  const [agency, setAgency] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const params = { status, agency, search: q }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['research', 'projects', params], queryFn: () => fetchProjects(params) })
  const all = useQuery({ queryKey: ['research', 'projects', {}], queryFn: () => fetchProjects({}) }).data
  const remove = useMutation({ mutationFn: deleteProject, onSuccess: () => { qc.invalidateQueries({ queryKey: ['research'] }); showSuccess(t('research.projects.deleted')) }, onError: (e) => showError(e.message) })
  const s = all?.summary
  const view = data?.summary
  return (
    <div className="space-y-4">
      {s && <StatCardRow items={[
        { icon: FlaskConical, label: t('research.projects.total'), value: s.total, segments: s.byStatus.filter((x) => x.n).map((x) => ({ label: L.project(x.status), value: x.n, tone: RESEARCH_PROJECT_STATUS[x.status].tone })) },
        { icon: Banknote, label: t('research.projects.sanctionedTotal'), value: <Money value={s.sanctioned} paise compact />, sub: t('research.projects.fundedN', { count: s.funded }) },
        { icon: HandCoins, label: t('research.projects.receivedTotal'), value: <Money value={s.received} paise compact />, progress: s.sanctioned ? (s.received / s.sanctioned) * 100 : undefined },
        { icon: Wallet, label: t('research.projects.utilisedTotal'), value: <Money value={s.utilised} paise compact />, progress: s.received ? (s.utilised / s.received) * 100 : undefined },
      ]} />}
      {s && s.total > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <RankBars title={t('research.projects.byAgency')} subtitle={t('research.projects.byAgencySub')} rows={s.byAgency.map((a) => ({ key: a.agency, label: L.agency(a.agency), value: a.amount }))}
            valueFormat={(v) => <Money value={v} paise compact />} />
          <div className="ui-panel bg-surface border border-border/80 rounded-2xl shadow-card p-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t('research.projects.pipeline')}</p>
            <StackedBar segments={s.byStatus.filter((x) => x.n).map((x) => ({ label: L.project(x.status), value: x.n, color: { info: '#3B82F6', violet: '#8B5CF6', brand: '#0E7C86', success: '#10B981', neutral: '#94A3B8' }[RESEARCH_PROJECT_STATUS[x.status].tone] }))} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('research.projects.search')} /></div>
        <div className="w-44"><Select value={agency} onChange={(e) => setAgency(e.target.value)} aria-label={t('research.projects.agency')}>
          <option value="">{t('research.projects.allAgencies')}</option>{RESEARCH_AGENCIES.map((a) => <option key={a.value} value={a.value}>{L.agency(a.value)}</option>)}
        </Select></div>
        <PillRow>
          <button type="button" aria-pressed={!status} className={pillClass(!status)} onClick={() => setStatus('')}>{t('research.projects.allStatus')}</button>
          {Object.keys(RESEARCH_PROJECT_STATUS).map((x) => (
            <button key={x} type="button" aria-pressed={status === x} className={pillClass(status === x)} onClick={() => setStatus(status === x ? '' : x)}>
              {L.project(x)}<span className="text-ink-faint">{s?.byStatus.find((b) => b.status === x)?.n ?? 0}</span>
            </button>
          ))}
        </PillRow>
      </div>
      {s && !s.total && <Note>{t('research.projects.emptyHint')}</Note>}
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} emptyTitle={t('research.projects.empty')}
        onRowClick={hasPermission(`${PRJ}.edit`) ? onEdit : undefined}
        totals={view && view.total > 1 ? { sanctioned: <Money value={view.sanctioned} paise compact />, utilisation: <Money value={view.utilised} paise compact /> } : undefined}
        columns={[
          { key: 'title', header: t('research.projects.title'), mobilePrimary: true, render: (v, r) => (
            <span className="block min-w-[200px]">
              <span className="font-medium text-ink line-clamp-2">{v}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <ColorChip label={L.agency(r.agency)} seed={`agency-${r.agency}`} />
                {r.scheme && <span className="text-xs text-ink-faint truncate">{r.scheme}</span>}
              </span>
            </span>
          ) },
          { key: 'pi', header: t('research.projects.team'), render: (v, r) => (
            <span className="flex items-center gap-2">
              <PersonCell name={v?.name} sub={r.department?.code ?? v?.designation} size={28} />
              {r.coPis.length > 0 && <PeopleStack people={r.coPis} size={22} max={3} />}
            </span>
          ) },
          { key: 'sanctioned', header: t('research.projects.sanctioned'), align: 'right', render: (v) => <Money value={v} paise compact /> },
          { key: 'utilisation', header: t('research.projects.utilisation'), mobileHidden: true, render: (_, r) => <UtilisationBar p={r} />, sortAccessor: (r) => r.utilisedPct },
          { key: 'startDate', header: t('research.projects.period'), mobileHidden: true, render: (v, r) => (v || r.endDate ? <span className="inline-flex items-center gap-1 text-xs text-ink-muted whitespace-nowrap"><CalendarRange className="w-3.5 h-3.5" />{v ? date(v) : '…'} → {r.endDate ? date(r.endDate) : '…'}</span> : '—') },
          { key: 'status', header: t('research.projects.status'), render: (v) => <ProjectPill status={v} /> },
          { key: 'id', header: '', align: 'right', width: 50, render: (_, r) => hasPermission(`${PRJ}.delete`) && (
            <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('research.delete')}
              onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: t('research.projects.deleteConfirm', { title: r.title }), confirmLabel: t('research.delete'), tone: 'danger' })) remove.mutate(r.id) }} />
          ) },
        ]} />
    </div>
  )
}

function ScholarForm({ scholar, onClose, onSaved }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const { data: meta } = useResearchMeta()
  const [form, setForm] = useState({
    name: scholar?.name ?? '', enrolmentNo: scholar?.enrolmentNo ?? '', email: scholar?.email ?? '', guideId: scholar?.guideId ?? '', coGuideId: scholar?.coGuideId ?? '',
    departmentId: scholar?.departmentId ?? '', topic: scholar?.topic ?? '', mode: scholar?.mode ?? 'FULL_TIME', registrationDate: scholar?.registrationDate ?? '',
    status: scholar?.status ?? 'REGISTERED', awardedOn: scholar?.awardedOn ?? '', fellowship: scholar?.fellowship ?? '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => saveScholar(scholar?.id, { ...form, coGuideId: form.coGuideId || null, departmentId: form.departmentId || null, awardedOn: form.awardedOn || null, email: form.email || null }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const remove = useMutation({ mutationFn: () => deleteScholar(scholar.id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['research'] }); showSuccess(t('research.scholars.deleted')); onClose() }, onError: (e) => showError(e.message) })
  const staff = meta?.staff ?? []
  return (
    <Modal open onClose={onClose} size="lg" title={scholar ? t('research.scholars.editTitle', { name: scholar.name }) : t('research.scholars.newTitle')} footer={<>
      {scholar && hasPermission(`${PRJ}.delete`) && <Button variant="ghost" icon={Trash2} className="me-auto"
        onClick={async () => { if (await confirm({ title: t('research.scholars.deleteConfirm', { name: scholar.name }), confirmLabel: t('research.delete'), tone: 'danger' })) remove.mutate() }}>{t('research.delete')}</Button>}
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.guideId || !form.registrationDate} onClick={() => save.mutate()}>{t('research.scholars.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('research.scholars.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField>
          <FormField label={t('research.scholars.enrolmentNo')}><Input value={form.enrolmentNo} onChange={set('enrolmentNo')} /></FormField>
          <FormField label={t('research.scholars.guide')} required error={errors.guideId}>
            <StaffSelect value={form.guideId} staff={staff} placeholder={t('research.scholars.pickGuide')} onChange={(v) => setForm((f) => ({ ...f, guideId: v ?? '' }))} />
          </FormField>
          <FormField label={t('research.scholars.coGuide')} error={errors.coGuideId}>
            <StaffSelect value={form.coGuideId} staff={staff} exclude={form.guideId ? [form.guideId] : []} placeholder={t('research.scholars.noCoGuide')} onChange={(v) => setForm((f) => ({ ...f, coGuideId: v ?? '' }))} />
          </FormField>
          <FormField label={t('research.scholars.topic')} className="sm:col-span-2"><Input value={form.topic} onChange={set('topic')} /></FormField>
          <FormField label={t('research.scholars.registrationDate')} required error={errors.registrationDate}><DateInput value={form.registrationDate} onChange={set('registrationDate')} /></FormField>
          <FormField label={t('research.scholars.mode')}>
            <Select value={form.mode} onChange={set('mode')}>{RESEARCH_SCHOLAR_MODES.map((m) => <option key={m.value} value={m.value}>{L.mode(m.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('research.scholars.status')}>
            <Select value={form.status} onChange={set('status')}>{Object.keys(RESEARCH_SCHOLAR_STATUS).map((s) => <option key={s} value={s}>{L.scholar(s)}</option>)}</Select>
          </FormField>
          {form.status === 'AWARDED' && <FormField label={t('research.scholars.awardedOn')} required error={errors.awardedOn}><DateInput value={form.awardedOn} onChange={set('awardedOn')} /></FormField>}
          <FormField label={t('research.scholars.department')} error={errors.departmentId}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('research.scholars.guideDepartment')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('research.scholars.fellowship')} hint={t('research.scholars.fellowshipHint')}><Input value={form.fellowship} onChange={set('fellowship')} /></FormField>
          <FormField label={t('research.scholars.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
        </div>
      </div>
    </Modal>
  )
}

function ScholarsTab({ onEdit }) {
  const { t } = useTranslation('research')
  const L = useResearchLabels()
  const { date } = useFormat()
  const [guideId, setGuideId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const params = { guideId, search: q }
  const { data, isLoading } = useQuery({ queryKey: ['research', 'scholars', params], queryFn: () => fetchScholars(params) })
  const guides = useQuery({ queryKey: ['research', 'scholars', {}], queryFn: () => fetchScholars({}) })
  const s = data?.summary
  const n = (status) => s?.byStatus.find((x) => x.status === status)?.n ?? 0
  const active = s ? s.total - n('AWARDED') - n('DISCONTINUED') : 0
  return (
    <div className="space-y-4">
      {s && <StatCardRow items={[
        { icon: Users, label: t('research.scholars.active'), value: active, sub: t('research.scholars.totalN', { count: s.total }) },
        { icon: Award, label: t('research.scholars.awarded'), value: n('AWARDED') },
        { icon: UserRound, label: t('research.scholars.guides'), value: s.byGuide.length },
        { icon: Briefcase, label: t('research.scholars.submitted'), value: n('SUBMITTED') },
      ]} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('research.scholars.search')} /></div>
            <div className="w-56"><Select value={guideId} onChange={(e) => setGuideId(e.target.value)} aria-label={t('research.scholars.guide')}>
              <option value="">{t('research.scholars.allGuides')}</option>
              {(guides.data?.summary.byGuide ?? []).map((g) => <option key={g.guideId} value={g.guideId}>{g.name}</option>)}
            </Select></div>
          </div>
          <KanbanBoard loading={isLoading} minColumnWidth={220} emptyText={t('research.scholars.emptyColumn')}
            columns={Object.keys(RESEARCH_SCHOLAR_STATUS).map((st) => ({ key: st, label: L.scholar(st), tone: RESEARCH_SCHOLAR_STATUS[st].tone }))}
            items={data?.rows ?? []} columnOf={(r) => r.status}
            onCardClick={hasPermission(`${PRJ}.edit`) ? onEdit : undefined}
            renderCard={(r) => (
              <KanbanCard title={r.name} subtitle={r.topic} tag={r.department?.code ?? L.mode(r.mode)} tagTone={r.mode === 'PART_TIME' ? 'violet' : 'brand'}
                meta={r.status === 'AWARDED' && r.awardedOn ? t('research.scholars.awardedMeta', { date: date(r.awardedOn) }) : t('research.scholars.regMeta', { date: date(r.registrationDate), guide: r.guide?.name ?? '—' })}
                avatar={r.name} />
            )} />
        </div>
        {s && s.byGuide.length > 0 && (
          <RankBars title={t('research.scholars.byGuide')} subtitle={t('research.scholars.byGuideSub')} max={12}
            rows={s.byGuide.map((g) => ({ key: g.guideId, label: g.name, value: g.n }))} />
        )}
      </div>
      {s && !s.total && !q && <Note>{t('research.scholars.emptyHint')}</Note>}
    </div>
  )
}

/** Research › Projects & grants: funded projects with their money and utilisation; Ph.D. scholars on the second tab. */
export default function Projects() {
  const { t } = useTranslation('research')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const [tab, setTab] = useState('projects')
  const [project, setProject] = useState(null)
  const [scholar, setScholar] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['research'] })
  return (
    <PageContainer>
      <PageHeader icon={FlaskConical} title={t('research.projects.pageTitle')} subtitle={t('research.projects.pageSubtitle')}
        actions={tab === 'projects'
          ? <HeaderButton icon={Plus} variant="primary" requires={`${PRJ}.create`} onClick={() => setProject('new')}>{t('research.projects.new')}</HeaderButton>
          : <HeaderButton icon={GraduationCap} variant="primary" requires={`${PRJ}.create`} onClick={() => setScholar('new')}>{t('research.scholars.new')}</HeaderButton>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'projects', label: t('research.projects.tab') },
        { value: 'scholars', label: t('research.scholars.tab') },
      ]} />
      {tab === 'projects' ? <ProjectsTab onEdit={(r) => setProject(r)} /> : <ScholarsTab onEdit={(r) => setScholar(r)} />}
      {project && <ProjectForm project={project === 'new' ? null : project} onClose={() => setProject(null)}
        onSaved={() => { setProject(null); refresh(); showSuccess(t('research.projects.saved')) }} />}
      {scholar && <ScholarForm scholar={scholar === 'new' ? null : scholar} onClose={() => setScholar(null)}
        onSaved={() => { setScholar(null); refresh(); showSuccess(t('research.scholars.saved')) }} />}
    </PageContainer>
  )
}
