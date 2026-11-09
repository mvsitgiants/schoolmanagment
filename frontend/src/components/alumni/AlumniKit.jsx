import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarClock, Download } from 'lucide-react'
import { Avatar, Drawer, EmptyState, FormField, Input, Modal, Note, Select, SkeletonRows, Textarea } from '../system'
import Button from '../ui/Button'
import { fetchAlumni, fetchAlumniMeta, fetchLeaverYears, fetchLeavers, importLeavers, saveAlumnus } from '../../api/alumni'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

export const useAlumniMeta = () => useQuery({ queryKey: ['alumni', 'meta'], queryFn: fetchAlumniMeta, staleTime: 30_000 })

const EMPTY = { name: '', batch: '', programId: '', program: '', admissionNo: '', organisation: '', designation: '', city: '', country: '', email: '', mobile: '', linkedIn: '', consent: false, notes: '', active: true }

/** Add or edit an alumnus. */
export function AlumnusForm({ alumnus, onClose, onSaved }) {
  const { t } = useTranslation('alumni')
  const { showError } = useSnackbar()
  const { data: meta } = useAlumniMeta()
  const [f, setF] = useState(() => (alumnus ? { ...EMPTY, ...Object.fromEntries(Object.entries(alumnus).map(([k, v]) => [k, v ?? EMPTY[k] ?? ''])), batch: String(alumnus.batch) } : { ...EMPTY, batch: String(new Date().getFullYear()) }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = useMutation({
    mutationFn: () => saveAlumnus(alumnus?.id, {
      name: f.name, batch: Number(f.batch), programId: f.programId || undefined, program: f.program, admissionNo: f.admissionNo, organisation: f.organisation, designation: f.designation,
      city: f.city, country: f.country, email: f.email, mobile: f.mobile, linkedIn: f.linkedIn, consent: !!f.consent, notes: f.notes, active: f.active !== false,
    }),
    onSuccess: onSaved, onError: (e) => { setErrors(e.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Drawer open onClose={onClose} size="lg" title={alumnus ? t('alumni.form.editTitle') : t('alumni.form.newTitle')} subtitle={alumnus?.name}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2 || !f.batch} onClick={() => save.mutate()}>{t('actions.save')}</Button></>}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={f.name || '?'} size={48} />
          <FormField className="flex-1" label={t('alumni.form.name')} required error={errors.name}><Input value={f.name} onChange={set('name')} /></FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('alumni.form.batch')} required error={errors.batch}><Input type="number" min="1950" max="2100" value={f.batch} onChange={set('batch')} /></FormField>
          <FormField label={t('alumni.form.admissionNo')}><Input value={f.admissionNo} onChange={set('admissionNo')} /></FormField>
          {(meta?.programs ?? []).length > 0 && (
            <FormField label={t('alumni.form.programPick')}>
              <Select value={f.programId} onChange={set('programId')}><option value="">{t('alumni.form.none')}</option>{meta.programs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
            </FormField>
          )}
          <FormField label={t('alumni.form.program')} hint={t('alumni.form.programHint')}><Input value={f.program} onChange={set('program')} list="alumni-programs" /></FormField>
          <FormField label={t('alumni.form.organisation')}><Input value={f.organisation} onChange={set('organisation')} /></FormField>
          <FormField label={t('alumni.form.designation')}><Input value={f.designation} onChange={set('designation')} /></FormField>
          <FormField label={t('alumni.form.city')}><Input value={f.city} onChange={set('city')} /></FormField>
          <FormField label={t('alumni.form.country')}><Input value={f.country} onChange={set('country')} /></FormField>
          <FormField label={t('alumni.form.email')} error={errors.email}><Input type="email" value={f.email} onChange={set('email')} /></FormField>
          <FormField label={t('alumni.form.mobile')} error={errors.mobile}><Input value={f.mobile} onChange={set('mobile')} /></FormField>
        </div>
        <datalist id="alumni-programs">{(meta?.programNames ?? []).map((p) => <option key={p} value={p} />)}</datalist>
        <FormField label={t('alumni.form.linkedIn')} error={errors.linkedIn}><Input value={f.linkedIn} onChange={set('linkedIn')} placeholder="linkedin.com/in/…" /></FormField>
        <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={!!f.consent} onChange={set('consent')} />
          <span>{t('alumni.form.consent')}<span className="block text-xs text-ink-muted">{t('alumni.form.consentHint')}</span></span>
        </label>
        <FormField label={t('alumni.form.notes')}><Textarea rows={3} value={f.notes} onChange={set('notes')} /></FormField>
        {alumnus && <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.active !== false} onChange={set('active')} />{t('alumni.form.active')}</label>}
      </div>
    </Drawer>
  )
}

/** Bring a year's leavers (students who left or passed out) into the directory: pick the year, untick anyone, import. */
export function ImportLeaversModal({ onClose, onDone }) {
  const { t } = useTranslation('alumni')
  const { showError } = useSnackbar()
  const { data: yearsData, isLoading } = useQuery({ queryKey: ['alumni', 'leaver-years'], queryFn: fetchLeaverYears })
  const years = yearsData?.years ?? []
  const [year, setYear] = useState(null)
  const { data: preview, isLoading: loadingPreview } = useQuery({ queryKey: ['alumni', 'leavers', year], queryFn: () => fetchLeavers(year), enabled: !!year })
  const [off, setOff] = useState([])
  const rows = preview?.data ?? []
  const picked = rows.filter((r) => !off.includes(r.studentId))
  const run = useMutation({ mutationFn: () => importLeavers({ year, studentIds: picked.map((r) => r.studentId) }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={t('alumni.import.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={Download} loading={run.isPending} disabled={!year || !picked.length} onClick={() => run.mutate()}>{t('alumni.import.run', { count: picked.length })}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{t('alumni.import.hint')}</p>
        {isLoading ? <SkeletonRows rows={3} /> : !years.length ? <EmptyState icon={CalendarClock} title={t('alumni.import.noLeavers')} /> : (
          <div className="flex flex-wrap gap-2">
            {years.map((y) => {
              const left = y.leavers - y.imported
              return (
                <button key={y.year} type="button" onClick={() => { setYear(y.year); setOff([]) }}
                  className={clsx('min-w-[7rem] rounded-xl border px-3 py-2 text-start transition-colors', year === y.year ? 'border-brand-300 bg-brand-50' : 'border-border hover:bg-black/[0.03]')}>
                  <span className="block font-display text-lg font-semibold text-ink">{y.year}</span>
                  <span className="block text-xs text-ink-muted">{t('alumni.import.yearCounts', { leavers: y.leavers, left })}</span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/[0.06]"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${y.leavers ? (y.imported / y.leavers) * 100 : 0}%` }} /></span>
                </button>
              )
            })}
          </div>
        )}
        {year && (loadingPreview ? <SkeletonRows rows={4} /> : !rows.length ? <Note tone="success">{t('alumni.import.allIn', { year })}</Note> : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {rows.map((r) => (
              <li key={r.studentId} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={!off.includes(r.studentId)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== r.studentId) : [...o, r.studentId]))} aria-label={r.name} />
                <Avatar name={r.name} size={28} soft />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{r.name}</span><span className="block truncate text-xs text-ink-faint">{[r.admissionNo, r.program, r.organisation].filter(Boolean).join(' · ')}</span></span>
                <span className="text-xs text-ink-muted">{t(`alumni.import.status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Modal>
  )
}

/** Find an alumnus by name (the donation form). */
export function AlumnusFinder({ value, onPick, error }) {
  const { t } = useTranslation('alumni')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const { data } = useQuery({ queryKey: ['alumni', 'find', q], queryFn: () => fetchAlumni({ search: q, pageSize: 20 }), enabled: q.length >= 2 })
  const options = [...(value ? [value] : []), ...(data?.data ?? []).filter((a) => a.id !== value?.id)]
  return (
    <>
      <FormField label={t('alumni.finder.find')}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('alumni.finder.placeholder')} /></FormField>
      <FormField label={t('alumni.finder.alumnus')} required error={error}>
        <Select value={value?.id ?? ''} onChange={(e) => onPick(options.find((a) => a.id === e.target.value) ?? null)}>
          <option value="">{q.length >= 2 || value ? t('alumni.finder.pick') : t('alumni.finder.typeFirst')}</option>
          {options.map((a) => <option key={a.id} value={a.id}>{[a.name, a.batch, a.program].filter(Boolean).join(' · ')}</option>)}
        </Select>
      </FormField>
    </>
  )
}
