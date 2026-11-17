import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Pencil, School, Send } from 'lucide-react'
import { FormSection, Note } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues, useLocalNamesRule } from '../../components/students/StudentForm'
import AdmissionDocuments, { missingNow } from '../../components/students/AdmissionDocuments'
import AdmissionReview from '../../components/students/AdmissionReview'
import { usePlainLocalNames } from '../../components/localNames/LocalNameField'
import { fetchFamilyForm, removeFamilyFile, submitFamilyForm, uploadFamilyFile } from '../../api/admissionForm'
import { applyBrandRamp } from '../../utils/brandRamp'
import { useFormat } from '../../context/SettingsContext'

const Card = ({ children, className = '' }) => <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>{children}</section>

// A family's admission form (/admission-form/:slug/:token), opened from the link the school sent — no sign-in. They fill
// in the child's details, add the documents (photos from the phone or PDF files), read it all back and send it. Until the
// school admits the child they can open the link again and change it. Documents go up as they are added.

function Filling({ slug, token, info }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const [form, setForm] = useState(() => studentFormValues(info.data))
  const [step, setStep] = useState('FORM') // FORM → REVIEW → DONE
  const [errors, setErrors] = useState({})
  const [docs, setDocs] = useState(() => info.files.map((f) => ({ ...f, key: f.id, saved: true })))
  const [uploading, setUploading] = useState(false)
  const urls = useRef([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const langs = info.names.languages
  const ln = info.localNames ?? {}
  const student = usePlainLocalNames('students', langs, ln.student ? { student: ln.student } : null)
  const parents = usePlainLocalNames('parents', langs, Object.fromEntries((ln.guardians ?? []).map((g, i) => [`g${i}`, g ?? {}])))
  const names = { student, parents }
  const rule = useLocalNamesRule(form, names, { publicRequired: info.names.required })
  const missing = missingNow(info.documents, docs)
  const ready = form.firstName.trim() && form.guardians.some((g) => g.name.trim()) && !rule.missing && !missing.length
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const addDoc = async (file, meta) => {
    setUploading(true)
    try {
      const saved = await uploadFamilyFile(slug, token, file, meta)
      const url = /^image\//.test(file.type) ? URL.createObjectURL(file) : ''
      if (url) urls.current.push(url)
      setDocs((d) => [...d, { ...saved, key: saved.id, saved: true, url }])
    } finally { setUploading(false) }
  }
  const removeDoc = async (it) => {
    setUploading(true)
    try { await removeFamilyFile(slug, token, it.id); setDocs((d) => d.filter((x) => x.key !== it.key)) } finally { setUploading(false) }
  }

  const send = useMutation({
    mutationFn: () => {
      // the Hindi (or other) names go with the guardians actually filled, in the same order the school will see them
      const filled = form.guardians.map((g, i) => ({ g, i })).filter(({ g }) => g.name.trim())
      const { sectionId, admissionNo, rollNo, admissionDate, ...body } = studentBody(form)
      return submitFamilyForm(slug, token, {
        ...body,
        localNames: langs.length ? { student: student.values.student ?? {}, guardians: filled.map(({ i }) => parents.values[`g${i}`] ?? null) } : undefined,
      })
    },
    onSuccess: () => { setStep('DONE'); top() },
    onError: (e) => { setErrors(e.fields ?? {}); setStep('FORM'); top() },
  })

  if (step === 'DONE') return (
    <Card className="text-center">
      <CheckCircle2 className="w-12 h-12 mx-auto text-success-600" />
      <h2 className="mt-3 font-display text-xl font-semibold text-ink">{t('students.familyPage.doneTitle')}</h2>
      <p className="mt-2 text-sm text-ink-muted">{t('students.familyPage.done', { name: [form.firstName, form.lastName].filter(Boolean).join(' '), school: info.school.name })}</p>
      <p className="mt-2 text-xs text-ink-faint">{t('students.familyPage.canChange', { date: date(info.expiresOn) })}</p>
      <Button variant="secondary" icon={Pencil} className="mt-4" onClick={() => setStep('FORM')}>{t('students.familyPage.change')}</Button>
    </Card>
  )

  return (
    <div className="space-y-5">
      {step === 'FORM' && (
        <>
          <Note>{t('students.familyPage.intro', { date: date(info.expiresOn) })}</Note>
          {info.submittedAt && <Note tone="success">{t('students.familyPage.sentBefore', { date: date(info.submittedAt) })}</Note>}
          {send.error && <Note tone="danger">{send.error.message}</Note>}
          <StudentForm value={form} onChange={setForm} errors={errors} names={langs.length ? names : undefined} aadhaarSet={!!info.aadhaarLast4} publicForm={{ namesRequired: info.names.required }} />
          <FormSection title={t('students.docs.title')} hint={t('students.familyPage.docsHint')}>
            <AdmissionDocuments checklist={info.documents} items={docs} onAdd={addDoc} onRemove={removeDoc} busy={uploading} />
          </FormSection>
          {rule.missing && <Note tone="warning">{t('students.familyPage.namesNeeded', { language: rule.language })}</Note>}
          {missing.length > 0 && <Note tone="warning">{t('students.docs.missingNow', { list: missing.map((d) => t(`students.docs.kinds.${d.category}`)).join(', ') })}</Note>}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-bg border-t border-border flex items-center gap-3">
            <Button size="lg" icon={ClipboardCheck} disabled={!ready || uploading} onClick={() => { setStep('REVIEW'); top() }}>{t('students.familyPage.review')}</Button>
            {!ready && <span className="text-xs text-ink-muted">{t('students.familyPage.needed')}</span>}
          </div>
        </>
      )}
      {step === 'REVIEW' && (
        <>
          <AdmissionReview family form={form} names={langs.length ? names : null} placement={info.classLabel} documents={docs} checklist={info.documents} onEdit={() => { setStep('FORM'); top() }} />
          <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-bg border-t border-border flex flex-wrap items-center gap-3">
            <Button size="lg" icon={Send} loading={send.isPending} onClick={() => send.mutate()}>{t('students.familyPage.send')}</Button>
            <Button variant="ghost" icon={ArrowLeft} onClick={() => { setStep('FORM'); top() }}>{t('students.review.back')}</Button>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdmissionFormPage() {
  const { t } = useTranslation('students')
  const { slug, token } = useParams()
  const { data: info, isLoading, error } = useQuery({ queryKey: ['family-admission-form', slug, token], queryFn: () => fetchFamilyForm(slug, token), retry: false, refetchOnWindowFocus: false })
  const s = info?.school
  useEffect(() => {
    if (!s) return undefined
    applyBrandRamp(s.primaryColor || null)
    document.title = `${s.name} · ${t('students.familyPage.title')}`
    return () => applyBrandRamp(null)
  }, [s, t])
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {isLoading ? <div className="h-40 rounded-2xl bg-black/5 animate-pulse" /> : error || !info ? (
          <Card className="text-center mt-16">
            <School className="w-10 h-10 mx-auto text-ink-faint" />
            <p className="mt-3 font-semibold text-ink">{t('students.familyPage.closedTitle')}</p>
            <p className="text-sm text-ink-muted mt-1">{error?.message}</p>
          </Card>
        ) : <>
          <header className="flex items-center gap-3">
            {s.logoUrl ? <img src={s.logoUrl} alt="" className="w-12 h-12 rounded-xl object-contain bg-surface border border-border" /> : <span className="w-12 h-12 rounded-xl bg-brand-500 flex items-center justify-center"><School className="w-6 h-6 text-white" /></span>}
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold text-ink">{s.name}</p>
              <p className="text-sm text-ink-muted">{[t('students.familyPage.title'), info.classLabel].filter(Boolean).join(' · ')}</p>
            </div>
          </header>
          <Filling slug={slug} token={token} info={info} />
          <p className="text-center text-xs text-ink-faint">{t('students.familyPage.privacy', { name: s.name })}{s.phone ? ` ${t('students.familyPage.help', { phone: s.phone })}` : ''}</p>
        </>}
      </div>
    </div>
  )
}
