import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, ClipboardList, HeartPulse, Lock, Pencil, Phone, Pill, Plus, Ruler, Stethoscope, Syringe, Trash2, Users } from 'lucide-react'
import { HEALTH_BLOOD_GROUPS, VACCINES, bmiBand, BMI_BANDS } from '@schoolgiant/shared'
import {
  BreakdownDonut, CHART, DataTable, Drawer, FormField, Input, Modal, Note, PageContainer, PageHeader, PersonCell, PhoneLink, PillRow, RecordHero, SearchInput, Select,
  SideNavLayout, SkeletonLines, StatCardRow, Tabs, Tag, Textarea, Timeline, localIso, pillClass,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { BloodBadge, ChipsInput, OutcomePill, SeverityTag, TempTag, useHealthLabels } from '../../components/health/HealthKit'
import { fetchHealthRecord, fetchHealthRecords, saveHealthRecord } from '../../api/health'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/** Edit a student's record. The sensitive part shows only for those allowed to see it. */
function RecordForm({ data, onClose, onSaved }) {
  const { t } = useTranslation('health')
  const { showError } = useSnackbar()
  const r = data.record
  const [form, setForm] = useState({
    bloodGroup: r.bloodGroup ?? '', allergies: r.allergies, vaccinations: r.vaccinations.map(({ name, date, dose, note }) => ({ name, date: date ?? '', dose: dose ?? '', note: note ?? '' })),
    doctor: { name: r.doctor?.name ?? '', phone: r.doctor?.phone ?? '', hospital: r.doctor?.hospital ?? '' },
    ...(r.sensitive && { conditions: r.conditions, medications: r.medications.map(({ name, dose, schedule }) => ({ name, dose: dose ?? '', schedule: schedule ?? '' })), emergencyNotes: r.emergencyNotes ?? '' }),
    measurement: { date: localIso(new Date()), heightCm: '', weightKg: '' },
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setRow = (k, i, field) => (e) => setForm((f) => ({ ...f, [k]: f[k].map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)) }))
  const body = () => {
    const m = form.measurement
    const { measurement, ...rest } = form
    return {
      ...rest, bloodGroup: form.bloodGroup || null,
      vaccinations: form.vaccinations.filter((v) => v.name.trim()),
      ...(form.medications && { medications: form.medications.filter((x) => x.name.trim()) }),
      ...((m.heightCm || m.weightKg) && { measurement: { date: m.date, heightCm: m.heightCm ? Number(m.heightCm) : null, weightKg: m.weightKg ? Number(m.weightKg) : null } }),
    }
  }
  const save = useMutation({ mutationFn: () => saveHealthRecord(data.student.id, body()), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="xl" title={t('health.records.editTitle', { name: data.student.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label={t('health.records.bloodGroup')}>
            <Select value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}><option value="">{t('health.records.notKnown')}</option>{HEALTH_BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}</Select>
          </FormField>
          <FormField label={t('health.records.measuredOn')}><Input type="date" value={form.measurement.date} onChange={(e) => set('measurement', { ...form.measurement, date: e.target.value })} /></FormField>
          <FormField label={t('health.records.heightCm')}><Input type="number" min={30} max={250} step="0.1" value={form.measurement.heightCm} onChange={(e) => set('measurement', { ...form.measurement, heightCm: e.target.value })} /></FormField>
          <FormField label={t('health.records.weightKg')}><Input type="number" min={2} max={250} step="0.1" value={form.measurement.weightKg} onChange={(e) => set('measurement', { ...form.measurement, weightKg: e.target.value })} /></FormField>
        </div>
        <ChipsInput label={t('health.records.allergies')} value={form.allergies} onChange={(v) => set('allergies', v)} tone="danger" placeholder={t('health.records.allergyPlaceholder')} />
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('health.records.vaccinations')}</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => set('vaccinations', [...form.vaccinations, { name: '', date: '', dose: '', note: '' }])}>{t('health.records.addVaccine')}</Button></div>
          <div className="space-y-2">
            {form.vaccinations.map((v, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[2fr_1fr_80px_auto]">
                <Input list="sg-vaccines" value={v.name} placeholder={t('health.records.vaccine')} onChange={setRow('vaccinations', i, 'name')} />
                <Input type="date" value={v.date} onChange={setRow('vaccinations', i, 'date')} className="max-sm:order-3" />
                <Input value={v.dose} placeholder={t('health.records.dose')} onChange={setRow('vaccinations', i, 'dose')} className="max-sm:order-4" />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.remove')} onClick={() => set('vaccinations', form.vaccinations.filter((_, j) => j !== i))} />
              </div>
            ))}
            <datalist id="sg-vaccines">{VACCINES.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('health.records.doctor')}><Input value={form.doctor.name} onChange={(e) => set('doctor', { ...form.doctor, name: e.target.value })} /></FormField>
          <FormField label={t('health.records.doctorPhone')}><Input type="tel" value={form.doctor.phone} onChange={(e) => set('doctor', { ...form.doctor, phone: e.target.value })} /></FormField>
          <FormField label={t('health.records.hospital')}><Input value={form.doctor.hospital} onChange={(e) => set('doctor', { ...form.doctor, hospital: e.target.value })} /></FormField>
        </div>
        {r.sensitive ? (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700"><Lock className="h-3.5 w-3.5" />{t('health.records.sensitive')}</p>
            <ChipsInput label={t('health.records.conditions')} value={form.conditions} onChange={(v) => set('conditions', v)} tone="warning" placeholder={t('health.records.conditionPlaceholder')} />
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-ink-muted">{t('health.records.medications')}</p>
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => set('medications', [...form.medications, { name: '', dose: '', schedule: '' }])}>{t('health.records.addMedicine')}</Button></div>
              <div className="space-y-2">
                {form.medications.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <Input value={m.name} placeholder={t('health.records.medicine')} onChange={setRow('medications', i, 'name')} />
                    <Input value={m.dose} placeholder={t('health.records.dose')} onChange={setRow('medications', i, 'dose')} className="max-sm:order-3" />
                    <Input value={m.schedule} placeholder={t('health.records.schedule')} onChange={setRow('medications', i, 'schedule')} className="max-sm:order-4" />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('actions.remove')} onClick={() => set('medications', form.medications.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </div>
            </div>
            <FormField label={t('health.records.emergencyNotes')}><Textarea rows={3} value={form.emergencyNotes} onChange={(e) => set('emergencyNotes', e.target.value)} /></FormField>
          </div>
        ) : <Note tone="info" icon={Lock}>{t('health.records.sensitiveHidden')}</Note>}
      </div>
    </Modal>
  )
}

/** Small growth chart: height bars with the weight and BMI under each check. */
function Growth({ rows }) {
  const { t } = useTranslation('health')
  const { date } = useFormat()
  if (!rows.length) return <p className="text-sm text-ink-faint">{t('health.records.noGrowth')}</p>
  const maxH = Math.max(...rows.map((r) => r.heightCm ?? 0), 1)
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1">
      {rows.slice(-8).map((r) => (
        <div key={r.date} className="flex min-w-[56px] flex-col items-center gap-1">
          <span className="text-[11px] font-semibold tabular-nums text-ink">{r.heightCm ? `${r.heightCm}` : '—'}</span>
          <span className="flex h-24 w-6 items-end overflow-hidden rounded-md bg-black/[0.05]"><span className="block w-full rounded-md bg-brand-500" style={{ height: `${((r.heightCm ?? 0) / maxH) * 100}%` }} /></span>
          <span className="text-[10.5px] tabular-nums text-ink-muted">{r.weightKg ? t('health.records.kg', { n: r.weightKg }) : '—'}</span>
          {r.bmi && <Tag size="xs" tone={BMI_BANDS[bmiBand(r.bmi)]?.tone}>{r.bmi}</Tag>}
          <span className="text-[10px] text-ink-faint">{date(r.date)}</span>
        </div>
      ))}
    </div>
  )
}

function RecordDrawer({ studentId, onClose }) {
  const { t } = useTranslation('health')
  const L = useHealthLabels()
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['health', 'record', studentId], queryFn: () => fetchHealthRecord(studentId), enabled: !!studentId })
  if (!studentId) return null
  const r = data?.record
  return (
    <Drawer open onClose={onClose} size="xl" title={data?.student.name ?? t('health.records.title')} subtitle={t('health.records.title')}
      footer={hasPermission('health.records.edit') && data && <Button icon={Pencil} onClick={() => setEditing(true)}>{t('health.records.edit')}</Button>}>
      {isLoading || !data ? <SkeletonLines lines={8} /> : (
        <div className="space-y-4">
          <RecordHero name={data.student.name} leading={<BloodBadge group={r.bloodGroup} size="lg" />} subtitle={[data.student.className, data.student.admissionNo].filter(Boolean).join(' · ')}
            facts={[
              { icon: Ruler, label: t('health.records.latest'), value: r.latest ? [r.latest.heightCm && t('health.records.cm', { n: r.latest.heightCm }), r.latest.weightKg && t('health.records.kg', { n: r.latest.weightKg })].filter(Boolean).join(' · ') : '—' },
              { icon: Activity, label: t('health.records.bmi'), value: r.latest?.bmi ? <span className="inline-flex items-center gap-1.5">{r.latest.bmi}<Tag size="xs" tone={BMI_BANDS[bmiBand(r.latest.bmi)]?.tone}>{L.bmiBand(bmiBand(r.latest.bmi))}</Tag></span> : '—' },
              { icon: Phone, label: data.student.guardian ?? t('health.records.guardian'), value: data.student.mobile ? <PhoneLink number={data.student.mobile} /> : '—' },
            ]} />
          {r.allergies.length > 0 && <Note tone="danger" icon={AlertTriangle}>{t('health.records.allergicTo', { list: r.allergies.join(', ') })}</Note>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'overview', label: t('health.records.tabOverview') },
            { value: 'vaccines', label: t('health.records.tabVaccines', { count: r.vaccinations.length }) },
            { value: 'sensitive', label: t('health.records.tabSensitive') },
            { value: 'history', label: t('health.records.tabHistory', { count: data.visits.length + data.incidents.length }) },
          ]} />
          {tab === 'overview' && (
            <div className="space-y-4">
              <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('health.records.growth')}</p><Growth rows={r.measurements} /></div>
              {r.doctor && <PersonCell name={r.doctor.name ?? '—'} sub={[r.doctor.hospital, r.doctor.phone].filter(Boolean).join(' · ')} />}
              {r.updatedAt && <p className="text-xs text-ink-faint">{t('health.records.updated', { name: r.updatedBy ?? '', date: date(r.updatedAt) })}</p>}
            </div>
          )}
          {tab === 'vaccines' && (r.vaccinations.length ? (
            <Timeline dense items={r.vaccinations.map((v) => ({ id: v.id ?? v.name, icon: Syringe, tone: 'success', title: v.name, time: v.date ? date(v.date) : '—', meta: [v.dose && t('health.records.doseN', { dose: v.dose }), v.note].filter(Boolean).join(' · ') }))} />
          ) : <p className="text-sm text-ink-faint">{t('health.records.noVaccines')}</p>)}
          {tab === 'sensitive' && (r.sensitive ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">{r.conditions.length ? r.conditions.map((c) => <Tag key={c} tone="warning">{c}</Tag>) : <span className="text-sm text-ink-faint">{t('health.records.noConditions')}</span>}</div>
              {r.medications.length > 0 && <div className="space-y-1.5">{r.medications.map((m) => <p key={m.name} className="flex items-center gap-2 text-sm text-ink"><Pill className="h-4 w-4 text-ink-faint" />{[m.name, m.dose, m.schedule].filter(Boolean).join(' · ')}</p>)}</div>}
              {r.emergencyNotes && <Note tone="warning">{r.emergencyNotes}</Note>}
            </div>
          ) : <Note tone="info" icon={Lock}>{r.hasSensitive ? t('health.records.sensitiveLocked') : t('health.records.sensitiveHidden')}</Note>)}
          {tab === 'history' && (
            data.visits.length + data.incidents.length ? <Timeline dense items={[
              ...data.visits.map((v) => ({ day: v.date, id: v.id, icon: Stethoscope, tone: 'info', title: L.complaint(v.complaint), time: date(v.date), meta: v.treatment, status: <span className="inline-flex gap-1"><TempTag tempC={v.tempC} /><OutcomePill outcome={v.outcome} /></span> })),
              ...data.incidents.map((i) => ({ day: i.date, id: i.id, icon: ClipboardList, tone: 'warning', title: L.kind(i.kind), time: date(i.date), meta: i.place, status: <SeverityTag severity={i.severity} /> })),
            ].sort((a, b) => b.day.localeCompare(a.day))} /> : <p className="text-sm text-ink-faint">{t('health.records.noHistory')}</p>
          )}
        </div>
      )}
      {editing && data && <RecordForm data={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['health'] }); showSuccess(t('health.records.saved')) }} />}
    </Drawer>
  )
}

/** Health › Records: every student's health at a glance — blood group, allergies, growth, vaccinations. */
export default function HealthRecords() {
  const { t } = useTranslation('health')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { ...(q && { search: q }), ...(filter && { filter }) }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['health', 'records', params], queryFn: () => fetchHealthRecords(params) })
  const c = data?.counts
  const sensitive = data?.sensitive
  const blood = Object.entries(c?.bloodGroups ?? {}).sort((a, b) => b[1] - a[1])
  const filters = [['', t('health.records.all')], ['ALLERGIES', t('health.records.withAllergies')], ...(sensitive ? [['CONDITIONS', t('health.records.withConditions')]] : []), ['NO_RECORD', t('health.records.noRecord')]]
  return (
    <PageContainer>
      <PageHeader icon={HeartPulse} title={t('health.records.title')} subtitle={t('health.records.subtitle')} />
      <StatCardRow items={[
        { icon: Users, tone: 'brand', label: t('health.records.students'), value: c?.students ?? '—' },
        { icon: ClipboardList, tone: 'success', label: t('health.records.withRecord'), value: c?.withRecord ?? '—', progress: c?.students ? Math.round((c.withRecord / c.students) * 100) : undefined },
        { icon: AlertTriangle, tone: 'danger', label: t('health.records.withAllergies'), value: c?.withAllergies ?? '—', onClick: () => setFilter('ALLERGIES') },
        ...(sensitive ? [{ icon: Lock, tone: 'warning', label: t('health.records.withConditions'), value: c?.withConditions ?? '—', onClick: () => setFilter('CONDITIONS') }] : []),
      ]} />
      <SideNavLayout>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <PillRow>{filters.map(([k, label]) => <button key={k || 'all'} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={pillClass(filter === k)}>{label}</button>)}</PillRow>
              <div className="w-full sm:ms-auto sm:w-64"><SearchInput value={search} onChange={setSearch} placeholder={t('health.records.search')} /></div>
            </div>
            <DataTable rows={data?.rows ?? []} loading={isLoading} error={error} onRetry={refetch} onRowClick={(r) => setOpen(r.id)} emptyIcon={HeartPulse} emptyTitle={t('health.records.empty')}
              columns={[
                { key: 'name', header: t('health.records.student'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={[r.className, r.admissionNo].filter(Boolean).join(' · ')} /> },
                { key: 'bloodGroup', header: t('health.records.blood'), render: (v) => <BloodBadge group={v} /> },
                { key: 'allergies', header: t('health.records.allergies'), render: (v) => (v.length ? <span className="flex flex-wrap gap-1">{v.slice(0, 3).map((a) => <Tag key={a} size="xs" tone="danger">{a}</Tag>)}{v.length > 3 && <Tag size="xs">+{v.length - 3}</Tag>}</span> : <span className="text-ink-faint">—</span>) },
                ...(sensitive ? [{ key: 'conditions', header: t('health.records.conditions'), mobileHidden: true, render: (v) => (v?.length ? <span className="flex flex-wrap gap-1">{v.slice(0, 2).map((a) => <Tag key={a} size="xs" tone="warning">{a}</Tag>)}</span> : <span className="text-ink-faint">—</span>) }] : []),
                { key: 'bmi', header: t('health.records.bmi'), mobileHidden: true, render: (v, r) => (v ? <span className="flex flex-col items-start gap-0.5"><Tag size="xs" tone={BMI_BANDS[bmiBand(v)]?.tone}>{v}</Tag><span className="text-[10.5px] text-ink-faint tabular-nums">{[r.heightCm && t('health.records.cm', { n: r.heightCm }), r.weightKg && t('health.records.kg', { n: r.weightKg })].filter(Boolean).join(' · ')}</span></span> : <span className="text-ink-faint">—</span>) },
                { key: 'vaccinations', header: t('health.records.vaccines'), mobileHidden: true, align: 'right', render: (v) => (v ? <Tag size="xs" tone="success" icon={Syringe}>{v}</Tag> : <span className="text-ink-faint">—</span>) },
              ]} />
          </div>
          <BreakdownDonut title={t('health.records.bloodGroups')} centerLabel={t('health.records.known')} centerValue={blood.reduce((n, [, v]) => n + v, 0)}
            segments={blood.map(([g, v], i) => ({ name: g, value: v, color: CHART.series[i % CHART.series.length] }))} />
        </div>
      </SideNavLayout>
      <RecordDrawer studentId={open} onClose={() => setOpen(null)} />
    </PageContainer>
  )
}
