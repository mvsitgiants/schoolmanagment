import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, RotateCcw, Save, Users } from 'lucide-react'
import { ENQUIRY_SOURCES, ENQUIRY_STAGES, GENDERS } from '@schoolgiant/shared'
import { DateInput, FormField, FormPage, FormSection, Input, Note, Panel, PersonCell, SectionCard, Select, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAcademicLookup } from '../../api/academics'
import { createEnquiry, fetchEnquiries } from '../../api/admissions'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

const GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'
const blank = () => ({ childName: '', dob: '', gender: '', parentName: '', mobile: '', email: '', classId: '', source: 'WALK_IN', locality: '', currentSchool: '', note: '' })

/** What to look up while typing: the mobile number (6+ digits) beats the child's name (3+ letters). */
function probeOf(form) {
  const mobile = form.mobile.replace(/\D/g, '')
  if (mobile.length >= 6) return { search: mobile.slice(-10), by: 'mobile' }
  const [first, ...rest] = form.childName.trim().split(/\s+/)
  return first && first.length >= 3 ? { search: first, by: 'name', last: rest.join(' ').toLowerCase() } : null
}

/** Right-hand panel: earlier enquiries from the same family — so one family isn't entered twice. */
function AskedBefore({ form }) {
  const { t } = useTranslation('admissions')
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['enquiries', 'new-check', key],
    queryFn: () => fetchEnquiries({ search: p.search, pageSize: 8 }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  // a first-name hit only counts when the rest of the name also fits (if typed)
  const rows = !p ? [] : (data?.data ?? []).filter((e) => p.by !== 'name' || !p.last || String(e.childName ?? '').toLowerCase().includes(p.last)).slice(0, 5)

  if (!rows.length) {
    return (
      <Panel title={t('admissions.enquiries.page.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('admissions.enquiries.page.check.checking') : t('admissions.enquiries.page.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={Users} tone="warning" title={t('admissions.enquiries.page.check.found')} count={rows.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{p.by === 'mobile' ? t('admissions.enquiries.page.check.byMobile') : t('admissions.enquiries.page.check.byName')}</p>
      <ul className="divide-y divide-border">
        {rows.map((e) => (
          <li key={e.id}>
            <Link to={`/admissions/enquiries?open=${e.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-bg">
              <PersonCell name={e.childName} sub={[e.className, e.parentName, e.enquiryNo].filter(Boolean).join(' · ')} size={32} />
              <StatusPill tone={ENQUIRY_STAGES[e.stage]?.tone}>{t(`admissions.stages.${e.stage}`, ENQUIRY_STAGES[e.stage]?.label)}</StatusPill>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** New admission enquiry — a full page; after saving, the enquiry opens in the list to log the first follow-up. */
export default function NewEnquiry() {
  const { t } = useTranslation('admissions')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () => createEnquiry(form),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess(t('admissions.enquiries.saved', { no: e.enquiryNo }))
      navigate(`/admissions/enquiries?open=${e.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const ready = form.childName.trim().length >= 2 && form.mobile.replace(/\D/g, '').length >= 10
  const clear = () => { setForm(blank()); setErrors({}) }

  return (
    <FormPage
      icon={ClipboardList} title={t('admissions.enquiries.newTitle')} subtitle={t('admissions.enquiries.page.subtitle')}
      headerActions={<Button to="/admissions/enquiries" variant="secondary" icon={ClipboardList}>{t('admissions.enquiries.page.list')}</Button>}
      errors={errors}
      submitLabel={t('admissions.enquiries.save')} submitIcon={Save} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={ready}
      cancelLabel={t('admissions.enquiries.page.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        <AskedBefore form={form} />
        <Note icon={ClipboardList}>{t('admissions.enquiries.page.requiredNote')}</Note>
      </>}
    >
      <FormSection title={t('admissions.form.child')} hint={t('admissions.enquiries.page.childHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('admissions.enquiries.childName')} required error={errors.childName}><Input value={form.childName} onChange={set('childName')} /></FormField></div>
          <FormField label={t('admissions.form.dob')} error={errors.dob}><DateInput value={form.dob} onChange={set('dob')} /></FormField>
          <FormField label={t('admissions.form.gender')} error={errors.gender}>
            <Select value={form.gender} onChange={set('gender')}><option value="">—</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`admissions.genders.${g.value}`, g.label)}</option>)}</Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('admissions.enquiries.page.classWanted')} error={errors.classId}>
              <Select value={form.classId} onChange={set('classId')}><option value="">{t('admissions.form.pick')}</option>{(lookup?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </FormField>
          </div>
          <div className="sm:col-span-2"><FormField label={t('admissions.enquiries.currentSchool')} error={errors.currentSchool}><Input value={form.currentSchool} onChange={set('currentSchool')} /></FormField></div>
        </div>
      </FormSection>

      <FormSection title={t('admissions.form.parent')} hint={t('admissions.enquiries.page.parentHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2"><FormField label={t('admissions.form.parentName')} error={errors.parentName}><Input value={form.parentName} onChange={set('parentName')} /></FormField></div>
          <FormField label={t('admissions.form.mobile')} required error={errors.mobile}><Input inputMode="numeric" value={form.mobile} onChange={set('mobile')} /></FormField>
          <FormField label={t('admissions.form.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
          <div className="sm:col-span-2"><FormField label={t('admissions.enquiries.locality')} error={errors.locality}><Input value={form.locality} onChange={set('locality')} /></FormField></div>
        </div>
      </FormSection>

      <FormSection title={t('admissions.enquiries.page.about')} hint={t('admissions.enquiries.page.aboutHint')}>
        <div className={GRID}>
          <div className="sm:col-span-2">
            <FormField label={t('admissions.enquiries.page.source')} error={errors.source}>
              <Select value={form.source} onChange={set('source')}>{ENQUIRY_SOURCES.map((s) => <option key={s.value} value={s.value}>{t(`admissions.sources.${s.value}`, s.label)}</option>)}</Select>
            </FormField>
          </div>
          <div className="sm:col-span-2 xl:col-span-4">
            <FormField label={t('admissions.enquiries.page.note')} error={errors.note}><Textarea rows={3} value={form.note} onChange={set('note')} placeholder={t('admissions.enquiries.page.notePlaceholder')} /></FormField>
          </div>
        </div>
      </FormSection>
    </FormPage>
  )
}
