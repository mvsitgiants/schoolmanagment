import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, ClipboardCheck, School, Send, ShieldCheck } from 'lucide-react'
import { APPLICATION_STATUS } from '@schoolgiant/shared'
import { DateInput, FormField, FormSection, Input, Note, Select, SegmentedControl, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import ApplicationForm, { applicationAsStudent, applicationBody, applicationLocalNames, applicationNamesMissing, emptyApplication } from '../../components/admissions/ApplicationForm'
import AdmissionDocuments, { missingNow } from '../../components/students/AdmissionDocuments'
import AdmissionReview from '../../components/students/AdmissionReview'
import { usePlainLocalNames } from '../../components/localNames/LocalNameField'
import { publicAcceptOffer, publicAdmissions, publicApplicationFile, publicApply, publicEnquiry, publicMyApplications, publicSendCode, publicVerify } from '../../api/admissions'
import { applyBrandRamp } from '../../utils/brandRamp'
import PublicLanguage from '../../components/ui/PublicLanguage'
import { useFormat } from '../../context/SettingsContext'

const Card = ({ children, className = '' }) => <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>{children}</section>

/**
 * Prove the family's mobile number — or email, as the school allows (Settings › Admissions › applyCodeBy: MOBILE, EMAIL,
 * EITHER) — with a one-time code; hands back a 30-minute pass and what was proved ({ mobile } or { email }).
 */
function MobileCheck({ slug, onPass, title, by = 'MOBILE' }) {
  const { t } = useTranslation('admissions')
  const [via, setVia] = useState(by === 'EMAIL' ? 'EMAIL' : 'MOBILE')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const isEmail = via === 'EMAIL'
  const ok = isEmail ? /\S+@\S+\.\S+/.test(email) : mobile.replace(/\D/g, '').length >= 10
  const send = useMutation({ mutationFn: () => publicSendCode(slug, isEmail ? { email } : { mobile }), onSuccess: (r) => { setChallenge(r); setError(null) }, onError: (e) => setError(e.message) })
  const verify = useMutation({ mutationFn: () => publicVerify(slug, challenge.challengeId, code), onSuccess: (r) => onPass(r.pass, r.email ? { email: r.email } : { mobile: r.mobile ?? mobile.replace(/\D/g, '').slice(-10) }), onError: (e) => setError(e.message) })
  return (
    <Card>
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted mt-1">{isEmail ? t('admissions.public.emailHint') : t('admissions.public.mobileHint')}</p>
      <div className="mt-4 space-y-3 max-w-sm">
        {by === 'EITHER' && !challenge && (
          <SegmentedControl size="md" value={via} onChange={(v) => { setVia(v); setError(null) }} options={[{ value: 'MOBILE', label: t('admissions.public.byMobile') }, { value: 'EMAIL', label: t('admissions.public.byEmail') }]} />
        )}
        {isEmail
          ? <FormField label={t('admissions.form.email')} error={!challenge ? error : undefined}><Input type="email" value={email} maxLength={120} onChange={(e) => { setEmail(e.target.value); setChallenge(null) }} placeholder="name@example.com" /></FormField>
          : <FormField label={t('admissions.form.mobile')} error={!challenge ? error : undefined}><Input inputMode="numeric" value={mobile} maxLength={14} onChange={(e) => { setMobile(e.target.value); setChallenge(null) }} placeholder="98450 12345" /></FormField>}
        {!challenge ? <Button className="w-full" loading={send.isPending} disabled={!ok} onClick={() => send.mutate()}>{t('admissions.public.sendCode')}</Button> : <>
          <p className="text-sm text-ink-muted">{t('admissions.public.codeSent', { to: challenge.sentTo, minutes: challenge.validMinutes })}</p>
          {challenge.testCode && <Note>{t('admissions.public.testMode', { code: challenge.testCode })}</Note>}
          <FormField label={t('admissions.public.code')} error={error}><Input inputMode="numeric" value={code} maxLength={6} className="font-mono-num tracking-[0.4em] text-lg" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></FormField>
          <Button className="w-full" icon={ShieldCheck} loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate()}>{t('admissions.public.verify')}</Button>
        </>}
      </div>
    </Card>
  )
}

function ApplyTab({ slug, info }) {
  const { t } = useTranslation('admissions')
  const [pass, setPass] = useState(null)
  const [form, setForm] = useState(() => emptyApplication(info.cycles[0]))
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(null)
  const [step, setStep] = useState('FORM') // FORM → REVIEW → (sent) done
  const [docs, setDocs] = useState([]) // picked here; they go up right after the application is sent
  const [trap, setTrap] = useState('') // hidden from people; bots fill it in
  const [proved, setProved] = useState({}) // what the code proved: { mobile } or { email }
  const urls = useRef([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const langs = info.names?.languages ?? []
  const names = usePlainLocalNames('applicants', langs)
  const checklist = info.documents ?? []
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' })
  const submit = useMutation({
    mutationFn: async () => {
      const a = await publicApply(slug, { ...applicationBody(form), localNames: applicationLocalNames(names), pass: pass ?? undefined, website: trap || undefined })
      // the documents follow with the one-time key the school gave back; one that fails is listed, the application stands
      const failed = []
      if (a.uploadKey) for (const d of docs) { try { await publicApplicationFile(slug, a.id, a.uploadKey, d.file, d) } catch { failed.push(d.fileName) } }
      return { ...a, failed }
    },
    onSuccess: (r) => { setDone(r); top() },
    onError: (e) => { setErrors(e.fields ?? {}); setStep('FORM'); top() },
  })
  if (!info.onlineApplication || !info.cycles.length) return <Card><p className="text-sm text-ink-muted">{t('admissions.public.notOpen')}</p></Card>
  if (done) return (
    <Card className="text-center">
      <CheckCircle2 className="w-12 h-12 mx-auto text-success-600" />
      <h2 className="mt-3 font-display text-xl font-semibold text-ink">{t('admissions.public.submittedTitle')}</h2>
      <p className="mt-2 text-sm text-ink-muted">{t('admissions.public.submitted', { name: done.childName, cls: done.className })}</p>
      <p className="mt-3 font-mono-num text-2xl font-semibold text-ink">{done.applicationNo}</p>
      <p className="mt-2 text-xs text-ink-faint">{t('admissions.public.keepNumber')}</p>
      {done.failed?.length > 0 && <Note tone="warning" className="mt-3 text-start">{t('admissions.public.docsFailed', { list: done.failed.join(', ') })}</Note>}
    </Card>
  )
  if (info.applyNeedsCode && !pass) return <MobileCheck slug={slug} by={info.applyCodeBy} title={t('admissions.public.applyTitle')} onPass={(p, who) => { setPass(p); setProved(who); setForm((f) => ({ ...f, parent: { ...f.parent, ...who } })) }} />
  const cycle = info.cycles.find((c) => c.id === form.cycleId)
  const namesMissing = applicationNamesMissing(form, names, info.names?.required)
  const docsMissing = missingNow(checklist, docs)
  const ready = form.classId && form.child.firstName && form.child.dob && form.child.gender && form.parent.name && String(form.parent.mobile ?? '').replace(/\D/g, '').length >= 10 && !namesMissing && !docsMissing.length
  const addDoc = async (file, meta) => {
    const url = /^image\//.test(file.type) ? URL.createObjectURL(file) : ''
    if (url) urls.current.push(url)
    setDocs((d) => [...d, { key: `d-${Date.now()}-${d.length}`, file, ...meta, fileName: file.name, size: file.size, contentType: file.type, url }])
  }
  const asStudent = applicationAsStudent(form, names)
  const className = cycle?.classes.find((c) => c.classId === form.classId)?.className

  if (step === 'REVIEW') return (
    <div className="space-y-4">
      {submit.error && <Note tone="danger">{submit.error.message}</Note>}
      <AdmissionReview family form={asStudent.form} names={asStudent.names} placement={className} documents={docs} checklist={checklist} onEdit={() => { setStep('FORM'); top() }} />
      <Card className="space-y-2">
        <Button className="w-full" size="lg" icon={Send} loading={submit.isPending} onClick={() => submit.mutate()}>{t('admissions.public.submit')}</Button>
        <Button className="w-full" variant="ghost" icon={ArrowLeft} onClick={() => { setStep('FORM'); top() }}>{t('admissions.public.backToForm')}</Button>
      </Card>
    </div>
  )
  // the form's sections are cards of their own; the instructions sit above them and the review button below
  return (
    <div className="space-y-4">
      {cycle?.instructions && <Note><span className="whitespace-pre-line">{cycle.instructions}</span></Note>}
      {submit.error && <Note tone="danger">{submit.error.message}</Note>}
      <ApplicationForm cycles={info.cycles} value={form} onChange={setForm} errors={errors} lockMobile={!!proved.mobile} names={langs.length ? names : undefined} namesRequired={!!info.names?.required} />
      <FormSection title={t('admissions.public.documents')} hint={t('admissions.public.documentsUpload')}>
        <AdmissionDocuments checklist={checklist} items={docs} onAdd={addDoc} onRemove={(it) => setDocs((d) => d.filter((x) => x.key !== it.key))} />
      </FormSection>
      <div className="hidden" aria-hidden="true"><Input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></div>
      <Card>
        {namesMissing && <Note tone="warning" className="mb-3">{t('admissions.public.namesNeeded', { language: names.langs.map((l) => l.nativeName).join(', ') })}</Note>}
        <Button className="w-full" size="lg" icon={ClipboardCheck} disabled={!ready} onClick={() => { setStep('REVIEW'); top() }}>{t('admissions.public.review')}</Button>
        <p className="mt-2 text-xs text-ink-faint text-center">{t('admissions.public.reviewHint')}</p>
      </Card>
    </div>
  )
}

function TrackTab({ slug, by }) {
  const { t } = useTranslation('admissions')
  const { date } = useFormat()
  const [pass, setPass] = useState(null)
  const [rows, setRows] = useState(null)
  const load = useMutation({ mutationFn: (p) => publicMyApplications(slug, p), onSuccess: setRows })
  const accept = useMutation({ mutationFn: (id) => publicAcceptOffer(slug, pass, id), onSuccess: setRows })
  if (!pass) return <MobileCheck slug={slug} by={by} title={t('admissions.public.trackTitle')} onPass={(p) => { setPass(p); load.mutate(p) }} />
  if (!rows) return <Card><p className="text-sm text-ink-faint">{t('admissions.loading')}</p></Card>
  if (!rows.length) return <Card><p className="text-sm text-ink-muted">{t('admissions.public.noneOnNumber')}</p></Card>
  return rows.map((a) => (
    <Card key={a.id}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{a.childName} · {a.className}</p>
          <p className="text-xs text-ink-faint font-mono-num">{a.applicationNo}</p>
        </div>
        <StatusPill tone={APPLICATION_STATUS[a.status]?.tone}>{t(`admissions.status.${a.status}`, a.statusLabel)}</StatusPill>
      </div>
      {a.test && ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED'].includes(a.status) && <p className="mt-3 text-sm text-ink">{t('admissions.public.testOn', { name: a.test.name, date: date(a.test.date), time: a.test.time ?? '', venue: a.test.venue ?? '' })}</p>}
      {a.rank && <p className="mt-2 text-sm text-ink-muted">{t('admissions.public.rank', { rank: a.rank })}</p>}
      {a.status === 'OFFERED' && (
        <div className="mt-4 space-y-2">
          <Note tone="success">{t('admissions.public.offer', { date: a.offerUntil ? date(a.offerUntil) : '—' })}</Note>
          <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate(a.id)}>{t('admissions.public.accept')}</Button>
          {accept.error && <Note tone="danger">{accept.error.message}</Note>}
        </div>
      )}
      {a.status === 'ACCEPTED' && <Note tone="success" className="mt-3">{t('admissions.public.accepted')}</Note>}
    </Card>
  ))
}

function EnquireTab({ slug, info }) {
  const { t } = useTranslation('admissions')
  const [form, setForm] = useState({ childName: '', parentName: '', mobile: '', email: '', classId: '', dob: '', note: '', website: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const send = useMutation({ mutationFn: () => publicEnquiry(slug, form) })
  if (!info.websiteEnquiry) return <Card><p className="text-sm text-ink-muted">{t('admissions.public.callUs', { phone: info.school.phone ?? '' })}</p></Card>
  if (send.isSuccess) return <Card className="text-center"><CheckCircle2 className="w-12 h-12 mx-auto text-success-600" /><p className="mt-3 text-sm text-ink">{t('admissions.public.enquirySent')}</p></Card>
  return (
    <Card>
      <h2 className="font-display text-lg font-semibold text-ink">{t('admissions.public.enquireTitle')}</h2>
      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <FormField label={t('admissions.enquiries.child')} required><Input value={form.childName} onChange={set('childName')} /></FormField>
        <FormField label={t('admissions.form.class')}><Select value={form.classId} onChange={set('classId')}><option value="">{t('admissions.form.pick')}</option>{info.enquiryClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
        <FormField label={t('admissions.form.parentName')} required><Input value={form.parentName} onChange={set('parentName')} /></FormField>
        <FormField label={t('admissions.form.mobile')} required><Input inputMode="numeric" value={form.mobile} onChange={set('mobile')} /></FormField>
        <FormField label={t('admissions.form.email')}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
        <FormField label={t('admissions.form.dob')}><DateInput value={form.dob} onChange={set('dob')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('admissions.public.question')}><Textarea rows={2} value={form.note} onChange={set('note')} /></FormField></div>
        {/* hidden from people; bots fill it in */}
        <div className="hidden" aria-hidden="true"><Input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></div>
      </div>
      {send.error && <Note tone="danger" className="mt-3">{send.error.message}</Note>}
      <Button className="w-full mt-4" loading={send.isPending} disabled={form.childName.trim().length < 2 || form.parentName.trim().length < 2 || form.mobile.replace(/\D/g, '').length < 10} onClick={() => send.mutate()}>{t('admissions.public.sendEnquiry')}</Button>
    </Card>
  )
}

/** The school's admissions page (/apply/:slug; /apply/:slug/status opens on tracking): apply, ask, or check an application. */
export default function Apply({ track = false }) {
  const { t } = useTranslation('admissions')
  const { slug } = useParams()
  const { data: info, isLoading, error } = useQuery({ queryKey: ['public-admissions', slug], queryFn: () => publicAdmissions(slug), retry: false })
  // a poster's QR opens straight on its form: ?tab=enquire the enquiry, ?tab=apply (or none) the application
  const [tab, setTab] = useState(() => (track ? 'TRACK' : new URLSearchParams(window.location.search).get('tab') === 'enquire' ? 'ENQUIRE' : 'APPLY'))
  const s = info?.school
  useEffect(() => {
    if (!s) return undefined
    applyBrandRamp(s.primaryColor || null)
    document.title = `${s.name} · ${t('admissions.public.title')}`
    return () => applyBrandRamp(null)
  }, [s, t])
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {isLoading ? <div className="h-40 rounded-2xl bg-black/5 animate-pulse" /> : error || !info ? (
          <Card className="text-center mt-16"><School className="w-10 h-10 mx-auto text-ink-faint" /><p className="mt-3 font-semibold text-ink">{t('admissions.public.notAvailable')}</p><p className="text-sm text-ink-muted mt-1">{error?.message}</p></Card>
        ) : <>
          <header className="flex items-center gap-3">
            {s.logoUrl ? <img src={s.logoUrl} alt="" className="w-12 h-12 rounded-xl object-contain bg-surface border border-border" /> : <span className="w-12 h-12 rounded-xl bg-brand-500 flex items-center justify-center"><School className="w-6 h-6 text-white" /></span>}
            <div className="min-w-0 flex-1"><p className="font-display text-xl font-semibold text-ink">{s.name}</p><p className="text-sm text-ink-muted">{t('admissions.public.title')}{s.city ? ` · ${s.city}` : ''}</p></div>
            <PublicLanguage ui={info.ui} className="shrink-0" />
          </header>
          <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'APPLY', label: t('admissions.public.tabs.apply') }, { value: 'ENQUIRE', label: t('admissions.public.tabs.enquire') }, { value: 'TRACK', label: t('admissions.public.tabs.track') }]} />
          {tab === 'APPLY' && <ApplyTab slug={slug} info={info} />}
          {tab === 'ENQUIRE' && <EnquireTab slug={slug} info={info} />}
          {tab === 'TRACK' && <TrackTab slug={slug} by={info.applyCodeBy} />}
          <p className="text-center text-xs text-ink-faint">{t('admissions.public.privacy', { name: s.name })}</p>
        </>}
      </div>
    </div>
  )
}
