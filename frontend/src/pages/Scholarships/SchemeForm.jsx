import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, Plus, Save, Trash2 } from 'lucide-react'
import {
  GENDERS, SCHOLARSHIP_APPROVAL, SCHOLARSHIP_BENEFITS, SCHOLARSHIP_DOC_TYPES, SCHOLARSHIP_DOC_TYPE_BY, SCHOLARSHIP_KINDS, SCHOLARSHIP_PROVIDERS,
  SCHOLARSHIP_PORTALS, SCHOLARSHIP_RANK_BY, STUDENT_CATEGORIES, toPaise,
} from '@schoolgiant/shared'
import { DateInput, FormField, FormPage, FormSection, Input, Note, Panel, Select, Tag, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchScheme, fetchScholarshipMeta, saveScheme } from '../../api/scholarships'
import { useSnackbar } from '../../context/SnackbarContext'

/** Ready-made checklists — a starting point the office edits. */
const PRESETS = {
  government: ['INCOME_CERTIFICATE', 'CASTE_CERTIFICATE', 'DOMICILE', 'STUDENT_AADHAAR', 'BANK_PASSBOOK', 'MARKSHEET', 'PHOTO'],
  need: ['INCOME_CERTIFICATE', 'PARENT_ID', 'SELF_DECLARATION'],
  merit: ['MARKSHEET'],
  sports: ['SPORTS_CERTIFICATE'],
}
const ORIGINAL_BY_DEFAULT = ['INCOME_CERTIFICATE', 'CASTE_CERTIFICATE']

const EMPTY = {
  name: '', provider: 'INSTITUTION', benefit: 'FEE_WAIVER', kind: 'PCT', value: '', feeHeadIds: [],
  eligibility: { classIds: [], categories: [], genders: [], maxIncome: '', minMarksPct: '', minAttendancePct: '' },
  seats: '', budget: '', approval: 'APPROVER', rankBy: 'NONE', holdFees: true, familyApply: true, renewalsFirst: true, lastDate: '',
  portal: { name: 'NSP', url: '', verifyBy: '' }, renewal: { minMarksPct: '', minAttendancePct: '' }, documents: [], description: '', active: true,
}
const rupees = (p) => (p == null || p === '' ? '' : String(p / 100))
const num = (v) => (v === '' || v == null ? null : Number(v))

function Chips({ options, value, onChange }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
          <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** A scheme: what it gives, who can apply, the documents families give, and how it is decided. */
export default function SchemeForm() {
  const { t } = useTranslation('scholarships')
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const { data: meta } = useQuery({ queryKey: ['scholarship-meta'], queryFn: fetchScholarshipMeta })
  const { data: scheme, isLoading } = useQuery({ queryKey: ['scholarship-scheme', id], queryFn: () => fetchScheme(id), enabled: !!id })
  useEffect(() => {
    if (!scheme) return
    setForm({
      ...EMPTY, ...scheme,
      value: scheme.kind === 'AMOUNT' ? rupees(scheme.value) : String(scheme.value),
      eligibility: {
        classIds: scheme.eligibility?.classIds ?? [], categories: scheme.eligibility?.categories ?? [], genders: scheme.eligibility?.genders ?? [],
        maxIncome: rupees(scheme.eligibility?.maxIncome), minMarksPct: scheme.eligibility?.minMarksPct ?? '', minAttendancePct: scheme.eligibility?.minAttendancePct ?? '',
      },
      seats: scheme.seats ?? '', budget: rupees(scheme.budget), lastDate: scheme.lastDate ?? '', description: scheme.description ?? '',
      portal: { name: scheme.portal?.name ?? 'NSP', url: scheme.portal?.url ?? '', verifyBy: scheme.portal?.verifyBy ?? '' },
      renewal: { minMarksPct: scheme.renewal?.minMarksPct ?? '', minAttendancePct: scheme.renewal?.minAttendancePct ?? '' },
      documents: (scheme.documents ?? []).map((d) => ({ type: d.type, label: d.type === 'OTHER' ? d.label : '', required: d.required, originalNeeded: d.originalNeeded, note: d.note ?? '' })),
    })
  }, [scheme])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setP = (k) => (e) => setForm((f) => ({ ...f, portal: { ...f.portal, [k]: e.target.value } }))
  const setR = (k) => (e) => setForm((f) => ({ ...f, renewal: { ...f.renewal, [k]: e.target.value } }))
  const setE = (k) => (e) => setForm((f) => ({ ...f, eligibility: { ...f.eligibility, [k]: e?.target ? e.target.value : e } }))
  const setDoc = (i, k) => (e) => setForm((f) => ({ ...f, documents: f.documents.map((d, j) => (j === i ? { ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } : d)) }))
  const addDoc = (type = 'OTHER') => setForm((f) => ({ ...f, documents: [...f.documents, { type, label: '', required: true, originalNeeded: ORIGINAL_BY_DEFAULT.includes(type), note: '' }] }))
  const addPreset = (key) => setForm((f) => {
    const have = new Set(f.documents.map((d) => d.type))
    return { ...f, documents: [...f.documents, ...PRESETS[key].filter((x) => !have.has(x)).map((type) => ({ type, label: '', required: true, originalNeeded: ORIGINAL_BY_DEFAULT.includes(type), note: '' }))] }
  })
  const removeDoc = (i) => setForm((f) => ({ ...f, documents: f.documents.filter((_, j) => j !== i) }))

  const save = useMutation({
    mutationFn: () => saveScheme(id, {
      name: form.name.trim(), provider: form.provider, benefit: form.benefit, kind: form.kind,
      value: form.kind === 'AMOUNT' ? toPaise(form.value) : Number(form.value), feeHeadIds: form.feeHeadIds,
      eligibility: {
        classIds: form.eligibility.classIds, categories: form.eligibility.categories, genders: form.eligibility.genders,
        maxIncome: form.eligibility.maxIncome === '' ? null : toPaise(form.eligibility.maxIncome),
        minMarksPct: num(form.eligibility.minMarksPct), minAttendancePct: num(form.eligibility.minAttendancePct),
      },
      seats: num(form.seats), budget: form.budget === '' ? null : toPaise(form.budget),
      approval: form.approval, rankBy: form.rankBy, holdFees: form.holdFees, familyApply: form.familyApply !== false, renewalsFirst: !!form.renewalsFirst, lastDate: form.lastDate || null,
      documents: form.documents.map((d) => ({ type: d.type, label: d.type === 'OTHER' ? d.label : undefined, required: d.required, originalNeeded: d.originalNeeded, note: d.note || undefined })),
      description: form.description || undefined, active: form.active,
      portal: form.provider === 'GOVERNMENT' ? { name: form.portal.name, url: form.portal.url, verifyBy: form.portal.verifyBy } : undefined,
      renewal: { minMarksPct: num(form.renewal.minMarksPct), minAttendancePct: num(form.renewal.minAttendancePct) },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scholarship-schemes'] }); qc.invalidateQueries({ queryKey: ['scholarship-meta'] }); qc.invalidateQueries({ queryKey: ['scholarship-scheme'] })
      showSuccess(id ? t('scholarships.schemes.saved') : t('scholarships.schemes.created')); navigate('/scholarships/schemes')
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  const opts = (list, prefix) => list.map((o) => ({ value: o.value, label: t(`scholarships.${prefix}.${o.value}`, o.label) }))
  const feeBased = form.benefit !== 'PAID_TO_STUDENT' // a part of the fees, now or paid in later
  const required = form.documents.filter((d) => d.required)

  return (
    <FormPage icon={Award} title={id ? t('scholarships.form.editTitle', { name: scheme?.name ?? '' }) : t('scholarships.form.newTitle')} subtitle={t('scholarships.form.subtitle')}
      loading={!!id && isLoading} errors={errors} onSubmit={() => save.mutate()} saving={save.isPending} submitIcon={Save}
      submitLabel={t('scholarships.common.save')} requires={id ? 'scholarships.schemes.edit' : 'scholarships.schemes.create'}
      canSubmit={form.name.trim().length > 1 && Number(form.value) > 0} onCancel={() => navigate('/scholarships/schemes')}
      aside={<>
        <Panel title={t('scholarships.form.familySees')}>
          <p className="text-sm text-ink-muted mb-2">{t('scholarships.form.familySeesHint')}</p>
          {form.documents.length ? (
            <ul className="space-y-1.5 text-sm">{form.documents.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-2"><span className="text-ink">• {d.type === 'OTHER' ? d.label || t('scholarships.form.unnamed') : t(`scholarships.docType.${d.type}`, SCHOLARSHIP_DOC_TYPE_BY[d.type]?.label)}{d.note ? <span className="text-ink-faint"> — {d.note}</span> : null}</span>
                {!d.required && <Tag tone="info">{t('scholarships.doc.optional')}</Tag>}</li>
            ))}</ul>
          ) : <p className="text-sm text-ink-faint">{t('scholarships.form.noDocsYet')}</p>}
        </Panel>
        <Note>{t('scholarships.form.howItWorks')}</Note>
      </>}>

      <FormSection title={t('scholarships.form.about')} hint={t('scholarships.form.aboutHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="sm:col-span-2 xl:col-span-1"><FormField label={t('scholarships.schemes.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('scholarships.form.namePlaceholder')} /></FormField></div>
          <FormField label={t('scholarships.form.provider')}><Select value={form.provider} onChange={set('provider')}>{opts(SCHOLARSHIP_PROVIDERS, 'provider').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label={t('scholarships.form.benefit')}><Select value={form.benefit} onChange={(e) => setForm((f) => ({ ...f, benefit: e.target.value, kind: e.target.value === 'PAID_TO_STUDENT' ? 'AMOUNT' : f.kind }))}>{opts(SCHOLARSHIP_BENEFITS, 'benefit').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <div className="sm:col-span-2 xl:col-span-3"><FormField label={t('scholarships.form.description')} hint={t('scholarships.form.descriptionHint')}><Textarea rows={2} value={form.description} onChange={set('description')} /></FormField></div>
          <label className="inline-flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.active} onChange={set('active')} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('scholarships.form.active')}</label>
        </div>
      </FormSection>

      {form.provider === 'GOVERNMENT' && (
        <FormSection title={t('scholarships.form.portal')} hint={t('scholarships.form.portalHint')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <FormField label={t('scholarships.form.portalName')}><Select value={form.portal.name} onChange={setP('name')}>{opts(SCHOLARSHIP_PORTALS, 'portalName').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
            <FormField label={t('scholarships.form.portalUrl')} error={errors['portal.url']}><Input value={form.portal.url} onChange={setP('url')} placeholder="https://" /></FormField>
            <FormField label={t('scholarships.form.verifyBy')} hint={t('scholarships.form.verifyByHint')}><DateInput value={form.portal.verifyBy} onChange={setP('verifyBy')} /></FormField>
          </div>
        </FormSection>
      )}

      <FormSection title={t('scholarships.form.gives')} hint={t(`scholarships.form.givesHint.${form.benefit}`)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FormField label={t('scholarships.form.kind')} error={errors.kind}>
            <Select value={form.kind} onChange={set('kind')} disabled={!feeBased}>{opts(SCHOLARSHIP_KINDS, 'kind').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
          <FormField label={form.kind === 'PCT' ? t('scholarships.form.percent') : t('scholarships.form.amountYear')} required error={errors.value}>
            <Input type="number" min="1" max={form.kind === 'PCT' ? 100 : undefined} step={form.kind === 'PCT' ? '0.5' : '1'} value={form.value} onChange={set('value')} />
          </FormField>
          <FormField label={t('scholarships.form.seats')} hint={t('scholarships.form.seatsHint')}><Input type="number" min="1" value={form.seats} onChange={set('seats')} /></FormField>
          <FormField label={t('scholarships.form.budget')} hint={t('scholarships.form.budgetHint')}><Input type="number" min="0" value={form.budget} onChange={set('budget')} /></FormField>
          {feeBased && (meta?.heads?.length ?? 0) > 0 && (
            <div className="sm:col-span-2 xl:col-span-4">
              <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.form.onHeads')}</p>
              <Chips options={meta.heads.map((h) => ({ value: h.id, label: h.name }))} value={form.feeHeadIds} onChange={(v) => setForm((f) => ({ ...f, feeHeadIds: v }))} />
              <p className="text-xs text-ink-faint mt-1">{t('scholarships.form.onHeadsHint')}</p>
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title={t('scholarships.form.who')} hint={t('scholarships.form.whoHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="sm:col-span-2 xl:col-span-3">
            <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.check.class')}</p>
            <Chips options={(meta?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} value={form.eligibility.classIds} onChange={setE('classIds')} />
            <p className="text-xs text-ink-faint mt-1">{t('scholarships.form.noneMeansAll')}</p>
          </div>
          <div className="sm:col-span-2 xl:col-span-2">
            <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.check.category')}</p>
            <Chips options={opts(STUDENT_CATEGORIES, 'category')} value={form.eligibility.categories} onChange={setE('categories')} />
          </div>
          <div>
            <p className="text-xs font-medium text-ink-muted mb-2">{t('scholarships.check.gender')}</p>
            <Chips options={opts(GENDERS, 'gender')} value={form.eligibility.genders} onChange={setE('genders')} />
          </div>
          <FormField label={t('scholarships.form.maxIncome')} hint={t('scholarships.form.maxIncomeHint')}><Input type="number" min="0" value={form.eligibility.maxIncome} onChange={setE('maxIncome')} /></FormField>
          <FormField label={t('scholarships.form.minMarks')} hint={t('scholarships.form.minMarksHint')}><Input type="number" min="0" max="100" value={form.eligibility.minMarksPct} onChange={setE('minMarksPct')} /></FormField>
          <FormField label={t('scholarships.form.minAttendance')} hint={t('scholarships.form.minAttendanceHint')}><Input type="number" min="0" max="100" value={form.eligibility.minAttendancePct} onChange={setE('minAttendancePct')} /></FormField>
        </div>
      </FormSection>

      <FormSection title={t('scholarships.form.documents')} hint={t('scholarships.form.documentsHint')}
        actions={<div className="flex flex-wrap gap-1.5">{Object.keys(PRESETS).map((k) => <Button key={k} size="sm" variant="ghost" icon={Plus} onClick={() => addPreset(k)}>{t(`scholarships.form.preset.${k}`)}</Button>)}</div>}>
        {errors.documents && <Note tone="danger" className="mb-3">{errors.documents}</Note>}
        <div className="space-y-2">
          {form.documents.map((d, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start rounded-lg border border-border p-3">
              <div className="sm:col-span-4">
                <Select value={d.type} onChange={setDoc(i, 'type')} aria-label={t('scholarships.form.docType')}>
                  {SCHOLARSHIP_DOC_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`scholarships.docType.${x.value}`, x.label)}</option>)}
                </Select>
                {SCHOLARSHIP_DOC_TYPE_BY[d.type]?.validMonths && <p className="text-xs text-ink-faint mt-1">{t('scholarships.form.renewYearly', { count: SCHOLARSHIP_DOC_TYPE_BY[d.type].validMonths })}</p>}
              </div>
              {d.type === 'OTHER' && <div className="sm:col-span-3"><Input value={d.label} onChange={setDoc(i, 'label')} placeholder={t('scholarships.form.docName')} error={errors[`documents.${i}.label`]} /></div>}
              <div className={d.type === 'OTHER' ? 'sm:col-span-3' : 'sm:col-span-6'}><Input value={d.note} onChange={setDoc(i, 'note')} placeholder={t('scholarships.form.docNote')} /></div>
              <div className="sm:col-span-2 flex items-center justify-end gap-1"><Button size="sm" variant="ghost" icon={Trash2} aria-label={t('scholarships.common.delete')} title={t('scholarships.common.delete')} onClick={() => removeDoc(i)} /></div>
              <div className="sm:col-span-12 flex flex-wrap gap-4 text-sm text-ink">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.required} onChange={setDoc(i, 'required')} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('scholarships.doc.required')}</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={d.originalNeeded} onChange={setDoc(i, 'originalNeeded')} className="rounded border-border text-brand-500 focus:ring-brand-500" />{t('scholarships.form.originalNeeded')}</label>
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-3" size="sm" variant="secondary" icon={Plus} onClick={() => addDoc()}>{t('scholarships.form.addDoc')}</Button>
        {required.some((d) => d.originalNeeded) && <Note className="mt-3">{t('scholarships.form.originalsNote')}</Note>}
      </FormSection>

      <FormSection title={t('scholarships.form.decided')} hint={t('scholarships.form.decidedHint')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <FormField label={t('scholarships.form.approval')}><Select value={form.approval} onChange={set('approval')}>{opts(SCHOLARSHIP_APPROVAL, 'approval').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label={t('scholarships.form.rankBy')} hint={t('scholarships.form.rankByHint')}><Select value={form.rankBy} onChange={set('rankBy')}>{opts(SCHOLARSHIP_RANK_BY, 'rankBy').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label={t('scholarships.form.lastDate')} hint={t('scholarships.form.lastDateHint')}><DateInput value={form.lastDate} onChange={set('lastDate')} /></FormField>
          <FormField label={t('scholarships.form.renewMarks')} hint={t('scholarships.form.renewHint')}><Input type="number" min="0" max="100" value={form.renewal.minMarksPct} onChange={setR('minMarksPct')} /></FormField>
          <FormField label={t('scholarships.form.renewAttendance')} hint={t('scholarships.form.renewHint')}><Input type="number" min="0" max="100" value={form.renewal.minAttendancePct} onChange={setR('minAttendancePct')} /></FormField>
          <label className="sm:col-span-2 xl:col-span-3 inline-flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={!!form.renewalsFirst} onChange={set('renewalsFirst')} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
            <span>{t('scholarships.renewal.firstSetting')}<span className="block text-xs text-ink-faint">{t('scholarships.renewal.firstSettingHint')}</span></span>
          </label>
          <label className="sm:col-span-2 xl:col-span-3 inline-flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.holdFees} onChange={set('holdFees')} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
            <span>{t('scholarships.form.holdFees')}<span className="block text-xs text-ink-faint">{t('scholarships.form.holdFeesHint')}</span></span>
          </label>
          <label className="sm:col-span-2 xl:col-span-3 inline-flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.familyApply !== false} onChange={set('familyApply')} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
            <span>{t('scholarships.form.familyApply')}<span className="block text-xs text-ink-faint">{t('scholarships.form.familyApplyHint')}</span></span>
          </label>
        </div>
      </FormSection>
    </FormPage>
  )
}
