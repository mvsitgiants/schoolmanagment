import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarClock, CheckCheck, ClipboardList, Clock, MapPin, MessageSquare, Plus, ShieldCheck, Siren, UserRound } from 'lucide-react'
import { INCIDENT_KINDS, INCIDENT_SEVERITY, INFORMED_HOW } from '@schoolgiant/shared'
import {
  DateInput, DataTable, DateRangeChip, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, PersonCell, RecordHero, SearchInput, SegmentedControl, Select,
  StatCardRow, Tag, Textarea, localIso, presetRange, usePrompt,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { ChipsInput, PersonPicker, SeverityTag, useHealthLabels } from '../../components/health/HealthKit'
import { createIncident, fetchAllIncidents, fetchIncidents, resolveIncident, updateIncident } from '../../api/health'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const SEV_ORDER = Object.keys(INCIDENT_SEVERITY)
const hhmmNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** Report an incident: who, when and where, what happened, injury and first aid, witnesses, severity, guardian told. */
function IncidentModal({ onClose, onSaved }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const { showError } = useSnackbar()
  const [person, setPerson] = useState({ personType: 'STUDENT', studentId: '', staffUserId: '', staffName: '' })
  const [form, setForm] = useState({ kind: 'INJURY', date: localIso(new Date()), time: hhmmNow(), place: '', description: '', injury: '', firstAid: '', witnesses: [], severity: 'MINOR', informed: '', notifyGuardian: false, followUp: '', followUpDate: '' })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const { informed, ...rest } = form
      return createIncident({ ...person, ...rest, guardianInformed: informed ? { how: informed } : null })
    },
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  const who = person.personType === 'STAFF' ? person.staffUserId || person.staffName.trim() : person.studentId
  return (
    <Modal open onClose={onClose} size="lg" title={t('health.incidents.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!who || form.description.trim().length < 3} onClick={() => save.mutate()}>{t('health.incidents.save')}</Button>
    </>}>
      <div className="space-y-4">
        <PersonPicker value={person} onChange={setPerson} errors={errors} />
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('health.incidents.kind')}><Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>{INCIDENT_KINDS.map((k) => <option key={k} value={k}>{L.kind(k)}</option>)}</Select></FormField>
          <FormField label={t('health.incidents.date')}><DateInput value={form.date} max={localIso(new Date())} onChange={(e) => set('date', e.target.value)} /></FormField>
          <FormField label={t('health.incidents.time')}><Input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} /></FormField>
          <FormField label={t('health.incidents.place')}><Input value={form.place} onChange={(e) => set('place', e.target.value)} placeholder={t('health.incidents.placePlaceholder')} /></FormField>
        </div>
        <FormField label={t('health.incidents.description')} required error={errors.description}><Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('health.incidents.injury')}><Textarea rows={2} value={form.injury} onChange={(e) => set('injury', e.target.value)} /></FormField>
          <FormField label={t('health.incidents.firstAid')}><Textarea rows={2} value={form.firstAid} onChange={(e) => set('firstAid', e.target.value)} /></FormField>
        </div>
        <ChipsInput label={t('health.incidents.witnesses')} value={form.witnesses} onChange={(v) => set('witnesses', v)} placeholder={t('health.incidents.witnessPlaceholder')} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">{t('health.incidents.severity')}</p>
          <SegmentedControl value={form.severity} onChange={(v) => set('severity', v)} options={SEV_ORDER.map((s) => ({ value: s, label: L.severity(s) }))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('health.incidents.informed')} hint={t('health.incidents.informedHint')}>
            <Select value={form.informed} onChange={(e) => set('informed', e.target.value)}><option value="">{t('health.incidents.notYet')}</option>{INFORMED_HOW.map((h) => <option key={h} value={h}>{L.how(h)}</option>)}</Select>
          </FormField>
          <FormField label={t('health.incidents.followUpDate')}><DateInput value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} /></FormField>
          <FormField label={t('health.incidents.followUp')} className="sm:col-span-2"><Input value={form.followUp} onChange={(e) => set('followUp', e.target.value)} /></FormField>
        </div>
        {person.personType === 'STUDENT' && (
          <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.notifyGuardian} onChange={(e) => set('notifyGuardian', e.target.checked)} className="rounded border-border text-brand-500" />{t('health.incidents.notifyGuardian')}
          </label>
        )}
      </div>
    </Modal>
  )
}

function IncidentDrawer({ incident, onClose, onChanged }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [follow, setFollow] = useState({ followUp: incident?.followUp ?? '', followUpDate: incident?.followUpDate ?? '', informed: '' })
  const save = useMutation({
    mutationFn: () => updateIncident(incident.id, { followUp: follow.followUp, followUpDate: follow.followUpDate, ...(follow.informed && { guardianInformed: { how: follow.informed } }) }),
    onSuccess: (r) => { onChanged(r); showSuccess(t('health.incidents.updated')) }, onError: (e) => showError(e.message),
  })
  const resolve = useMutation({ mutationFn: (resolution) => resolveIncident(incident.id, { resolution }), onSuccess: (r) => { onChanged(r); showSuccess(t('health.incidents.resolvedMsg')) }, onError: (e) => showError(e.message) })
  if (!incident) return null
  const i = incident
  const open = i.status === 'OPEN'
  return (
    <Drawer open onClose={onClose} size="lg" title={L.kind(i.kind)} subtitle={`${date(i.date)}${i.time ? ` · ${i.time}` : ''}`}
      footer={open && <div className="flex flex-wrap gap-2">
        {hasPermission('health.incidents.create') && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>{t('health.incidents.saveFollowUp')}</Button>}
        {hasPermission('health.incidents.resolve') && <Button icon={CheckCheck} loading={resolve.isPending} onClick={async () => { const r = await prompt({ title: t('health.incidents.resolveTitle'), label: t('health.incidents.resolution'), required: true }); if (r) resolve.mutate(r) }}>{t('health.incidents.resolve')}</Button>}
      </div>}>
      <div className="space-y-4">
        <RecordHero name={i.person.name} subtitle={i.person.kind === 'STAFF' ? t('health.person.staff') : [i.person.className, i.person.admissionNo].filter(Boolean).join(' · ')}
          status={<SeverityTag severity={i.severity} />}
          facts={[
            { icon: MapPin, label: t('health.incidents.place'), value: i.place ?? '—' },
            { icon: UserRound, label: t('health.incidents.reportedBy'), value: i.reportedBy ?? '—' },
            { icon: MessageSquare, label: t('health.incidents.informed'), value: i.guardianInformed?.at ? `${L.how(i.guardianInformed.how)} · ${dateTime(i.guardianInformed.at)}` : t('health.incidents.notYet') },
          ]} />
        {[['description', i.description], ['injury', i.injury], ['firstAid', i.firstAid]].filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t(`health.incidents.${k}`)}</p><p className="mt-1 whitespace-pre-line text-sm text-ink">{v}</p></div>
        ))}
        {i.witnesses?.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-ink-muted">{t('health.incidents.witnesses')}:</span>{i.witnesses.map((w) => <Tag key={w} size="xs">{w}</Tag>)}</div>}
        {open ? (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('health.incidents.followUpTitle')}</p>
            <FormField label={t('health.incidents.followUp')}><Textarea rows={2} value={follow.followUp} onChange={(e) => setFollow((f) => ({ ...f, followUp: e.target.value }))} disabled={!hasPermission('health.incidents.create')} /></FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('health.incidents.followUpDate')}><DateInput value={follow.followUpDate} onChange={(e) => setFollow((f) => ({ ...f, followUpDate: e.target.value }))} /></FormField>
              {!i.guardianInformed?.at && (
                <FormField label={t('health.incidents.informed')}>
                  <Select value={follow.informed} onChange={(e) => setFollow((f) => ({ ...f, informed: e.target.value }))}><option value="">{t('health.incidents.notYet')}</option>{INFORMED_HOW.map((h) => <option key={h} value={h}>{L.how(h)}</option>)}</Select>
                </FormField>
              )}
            </div>
          </div>
        ) : (
          <Note tone="success" icon={ShieldCheck}>{t('health.incidents.resolvedBy', { name: i.resolvedBy ?? '', date: dateTime(i.resolvedAt) })}{i.resolution && <p className="mt-1">{i.resolution}</p>}</Note>
        )}
      </div>
    </Drawer>
  )
}

const PAGE = 50

/** Health › Incidents: injury and incident reports — open ones to follow up, guardian told, resolved. */
export default function HealthIncidents() {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [status, setStatus] = useState('OPEN')
  const [range, setRange] = useState(() => presetRange('thisFy'))
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(null)
  const pickStatus = (v) => { setStatus(v); setPage(1) }
  const filters = { ...(status && { status }), ...(q && { search: q }), ...(status !== 'OPEN' && range?.from && { from: range.from, to: range.to }) }
  const params = { ...filters, page, pageSize: PAGE }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['health', 'incidents', params], queryFn: () => fetchIncidents(params) })
  const c = data?.counts
  const today = localIso(new Date())
  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('health.incidents.title')} subtitle={t('health.incidents.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="health.incidents.create" onClick={() => setAdding(true)}>{t('health.incidents.new')}</HeaderButton>} />
      <StatCardRow items={[
        { icon: AlertTriangle, tone: c?.open ? 'warning' : 'success', label: t('health.incidents.open'), value: c?.open ?? '—', onClick: () => pickStatus('OPEN') },
        { icon: Siren, tone: c?.serious ? 'danger' : 'neutral', label: t('health.incidents.seriousOpen'), value: c?.serious ?? '—' },
        { icon: MessageSquare, tone: c?.notInformed ? 'danger' : 'success', label: t('health.incidents.notInformed'), value: c?.notInformed ?? '—' },
        { icon: CalendarClock, tone: c?.followUpDue ? 'warning' : 'neutral', label: t('health.incidents.followUpDue'), value: c?.followUpDue ?? '—', sub: c ? t('health.incidents.thisMonth', { count: c.thisMonth }) : null },
      ]} />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl value={status} onChange={pickStatus} options={[{ value: 'OPEN', label: t('health.incidents.open') }, { value: 'RESOLVED', label: L.incidentStatus('RESOLVED') }, { value: '', label: t('health.incidents.all') }]} />
        {status !== 'OPEN' && <DateRangeChip value={range} onChange={(v) => { setRange(v); setPage(1) }} />}
        <div className="w-full sm:ms-auto sm:w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('health.incidents.search')} /></div>
      </div>
      <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} onRowClick={setOpen} exportable exportName="incidents" exportAll={() => fetchAllIncidents(filters)}
        pagination={data && data.total > PAGE ? { page: page - 1, size: PAGE, totalElements: data.total, totalPages: Math.ceil(data.total / PAGE), onPageChange: (p) => setPage(p + 1) } : undefined}
        emptyIcon={ShieldCheck} emptyTitle={status === 'OPEN' ? t('health.incidents.noneOpen') : t('health.incidents.empty')}
        rowTone={(i) => ((INCIDENT_SEVERITY[i.severity]?.rank ?? 0) >= 3 && i.status === 'OPEN' ? 'danger' : undefined)}
        columns={[
          { key: 'date', header: t('health.incidents.when'), width: 110, render: (v, i) => <span className="flex flex-col text-xs tabular-nums"><span className="text-ink">{date(v)}</span>{i.time && <span className="text-ink-faint">{i.time}</span>}</span> },
          { key: 'person', header: t('health.incidents.who'), mobilePrimary: true, render: (p) => <PersonCell name={p.name} sub={p.kind === 'STAFF' ? t('health.person.staff') : p.className} /> },
          { key: 'kind', header: t('health.incidents.kind'), render: (v, i) => <span className="flex flex-col items-start gap-0.5"><Tag size="xs" tone="info">{L.kind(v)}</Tag>{i.place && <span className="text-[11px] text-ink-faint">{i.place}</span>}</span> },
          { key: 'severity', header: t('health.incidents.severity'), render: (v) => <SeverityTag severity={v} /> },
          { key: 'guardianInformed', header: t('health.incidents.guardian'), mobileHidden: true, render: (v, i) => (i.person.kind === 'STAFF' ? '—' : v?.at ? <Tag size="xs" tone="success" icon={CheckCheck}>{L.how(v.how)}</Tag> : <Tag size="xs" tone="danger">{t('health.incidents.notYet')}</Tag>) },
          { key: 'followUpDate', header: t('health.incidents.followUpShort'), mobileHidden: true, render: (v, i) => (i.status === 'RESOLVED' ? <Tag size="xs" tone="success" icon={ShieldCheck}>{L.incidentStatus('RESOLVED')}</Tag> : v ? <Tag size="xs" tone={v <= today ? 'warning' : 'neutral'} icon={Clock}>{date(v)}</Tag> : '—') },
        ]} />
      {adding && <IncidentModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['health'] }); showSuccess(t('health.incidents.saved')) }} />}
      {open && <IncidentDrawer key={open.id} incident={open} onClose={() => setOpen(null)} onChanged={(r) => { qc.invalidateQueries({ queryKey: ['health'] }); setOpen(r) }} />}
    </PageContainer>
  )
}
