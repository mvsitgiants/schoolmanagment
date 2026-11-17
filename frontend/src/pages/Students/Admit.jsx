import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ClipboardCheck, ClipboardList, FileCheck2, Inbox, Languages, RotateCcw, Send, UserPlus, Users } from 'lucide-react'
import { DEFAULT_ADMISSION_DOCS, tcMismatch } from '@schoolgiant/shared'
import { FormPage, FormSection, Note, Panel, PersonCell, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues, useCampusOf, useLocalNamesRule, useStudentNames } from '../../components/students/StudentForm'
import AdmissionDocuments, { missingNow } from '../../components/students/AdmissionDocuments'
import AdmissionReview from '../../components/students/AdmissionReview'
import { FamilyFormsPanel, SendFormModal } from '../../components/students/FamilyForms'
import { admitStudent, fetchAdmissionForm, fetchStudents } from '../../api/students'
import { fetchAcademicLookup } from '../../api/academics'
import { deleteFile, downloadFile, uploadFile } from '../../api/files'
import { hasPermission } from '../../api/auth'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

/** What to look up while typing: a parent's mobile (6+ digits) beats the student's first name (3+ letters). */
function probeOf(form) {
  const mobile = form.guardians.map((g) => String(g.mobile ?? '').replace(/\D/g, '')).find((d) => d.length >= 6)
  if (mobile) return { search: mobile, by: 'mobile' }
  const first = form.firstName.trim()
  return first.length >= 3 ? { search: first, by: 'name', last: form.lastName.trim().toLowerCase() } : null
}

/** Right-hand panel: students already in the school who look like this one — so nobody is admitted twice. */
function AlreadyHere({ form }) {
  const { t } = useTranslation('students')
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['students', 'admit-check', key],
    queryFn: () => fetchStudents({ search: p.search, status: 'ALL', pageSize: 8 }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  // a first-name hit only counts when the surname also fits (if one is typed)
  const rows = !p ? [] : (data?.data ?? []).filter((s) => p.by !== 'name' || !p.last || String(s.lastName ?? '').toLowerCase().startsWith(p.last)).slice(0, 5)

  if (!rows.length) {
    return (
      <Panel title={t('students.admit.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('students.admit.check.checking') : t('students.admit.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={Users} tone="warning" title={t('students.admit.check.found')} count={rows.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{p.by === 'mobile' ? t('students.admit.check.byMobile') : t('students.admit.check.byName')}</p>
      <ul className="divide-y divide-border">
        {rows.map((s) => (
          <li key={s.id}>
            <Link to={`/students/profile/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg">
              <PersonCell name={s.name} sub={[s.classShort, s.admissionNo, s.guardianName].filter(Boolean).join(' · ')} size={32} />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Files of a family's form, as the documents list shows them (pictures get a preview). */
async function familyDocs(files) {
  const out = []
  for (const f of files ?? []) {
    let url = ''
    if (/^image\//.test(f.contentType)) { try { url = URL.createObjectURL((await downloadFile(f.id)).data) } catch { url = '' } }
    out.push({ key: `f-${f.id}`, id: f.id, saved: true, category: f.category, side: f.side, title: f.title, fileName: f.fileName, size: f.size, contentType: f.contentType, url, verification: f.verification })
  }
  return out
}

/**
 * New admission: one form — or one a family filled from a link (Send form to family), opened from the panel — with the
 * documents the campus asks for, read back on a review step before it is saved. The admission number comes from the
 * number series unless typed. Files picked here wait in the browser and go up once the student exists.
 */
export default function Admit() {
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => studentFormValues(null))
  const [errors, setErrors] = useState({})
  const [reviewing, setReviewing] = useState(false)
  const [docs, setDocs] = useState([]) // documents: picked here (file) or sent by the family (saved)
  const [family, setFamily] = useState(null) // the family's form opened here: { id, name }
  const [sending, setSending] = useState(false)
  const names = useStudentNames()
  const campus = useCampusOf(form.sectionId)
  const checklist = campus?.admissionDocs ?? DEFAULT_ADMISSION_DOCS
  const urls = useRef([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const top = () => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })

  const save = useMutation({
    mutationFn: () => admitStudent({ ...studentBody(form), ...(family && { fromFormId: family.id }) }),
    onSuccess: async (s) => {
      await names.save().catch((e) => showError(e.message))
      // the documents picked here go up now that the student exists; the family's moved with the form
      const failed = []
      for (const d of docs.filter((x) => x.file)) {
        try { await uploadFile('student', s.id, d.file, { category: d.category, side: d.side, title: d.title }) } catch { failed.push(d.fileName) }
      }
      if (failed.length) showError(t('students.docs.someFailed', { list: failed.join(', ') }))
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['academic-classes'] })
      qc.invalidateQueries({ queryKey: ['admission-forms'] })
      showSuccess(t('students.admit.done', { name: s.name, no: s.admissionNo }))
      navigate(`/students/profile/${s.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); setReviewing(false); showError(e.message) },
  })

  const localRule = useLocalNamesRule(form, names)
  const tc = tcMismatch(form, form.previousSchool)
  const docsMissing = missingNow(checklist, docs)
  const ready = form.firstName.trim() && form.sectionId && form.guardians.some((g) => g.name.trim())
    && !localRule.missing && !(tc.any && !form.previousSchool.mismatchNote?.trim()) && !docsMissing.length
  const clear = () => { setForm(studentFormValues(null)); setErrors({}); setDocs([]); setFamily(null); setReviewing(false) }

  const addDoc = async (file, meta) => {
    const url = /^image\//.test(file.type) ? URL.createObjectURL(file) : ''
    if (url) urls.current.push(url)
    setDocs((d) => [...d, { key: `n-${Date.now()}-${d.length}`, file, ...meta, fileName: file.name, size: file.size, contentType: file.type, url }])
  }
  const removeDoc = async (it) => {
    if (it.saved) {
      try { await deleteFile(it.id, t('students.docs.removedByOffice')) } catch (e) { showError(e.message); return }
    }
    setDocs((d) => d.filter((x) => x.key !== it.key))
  }

  // a family's form: what they filled goes into the form, their documents into the list — then check and admit
  const openFamily = async (f) => {
    try {
      const full = await fetchAdmissionForm(f.id)
      const values = studentFormValues({ ...full.data, sectionId: full.sectionId ?? form.sectionId ?? '' })
      values.aadhaar = full.data?.aadhaar ?? ''
      setForm(values)
      setErrors({})
      setReviewing(false)
      const ln = full.localNames ?? {}
      for (const [lang, text] of Object.entries(ln.student ?? {})) if (text) names.student.set('student', lang, text)
      ;(ln.guardians ?? []).forEach((g, i) => { for (const [lang, text] of Object.entries(g ?? {})) if (text) names.parents.set(`g${i}`, lang, text) })
      const sent = await familyDocs(full.files)
      sent.forEach((d) => d.url && urls.current.push(d.url))
      setDocs(sent)
      setFamily({ id: full.id, name: full.childName })
      showSuccess(t('students.familyForm.loaded', { name: full.childName || full.parentName }))
      top()
    } catch (e) { showError(e.message) }
  }

  const g0 = form.guardians.find((g) => g.name.trim()) ?? form.guardians[0]
  const sendPrefill = { childName: [form.firstName, form.lastName].filter(Boolean).join(' '), parentName: g0?.name, mobile: g0?.mobile, email: g0?.email, sectionId: form.sectionId }
  const placement = useSectionLabel(form.sectionId)

  return (
    <FormPage
      icon={UserPlus} title={t('students.admit.title')} subtitle={reviewing ? t('students.review.subtitle') : t('students.admit.subtitle')}
      headerActions={<>
        {!reviewing && <Button variant="secondary" icon={Send} onClick={() => setSending(true)}>{t('students.familyForm.button')}</Button>}
        {hasPermission('students.directory.view') && <Button to="/students/directory" variant="secondary" icon={ClipboardList}>{t('students.admit.directory')}</Button>}
      </>}
      errors={errors}
      submitLabel={reviewing ? t('students.review.confirm') : t('students.review.button')} submitIcon={reviewing ? UserPlus : ClipboardCheck} requires="create"
      onSubmit={() => { if (reviewing) save.mutate(); else { setReviewing(true); top() } }} saving={save.isPending} canSubmit={!!ready}
      cancelLabel={reviewing ? t('students.review.back') : t('students.admit.clear')} cancelIcon={reviewing ? ArrowLeft : RotateCcw}
      onCancel={reviewing ? () => { setReviewing(false); top() } : clear}
      aside={<>
        {family && <Note icon={Inbox} actions={<Button size="sm" variant="ghost" onClick={clear}>{t('students.familyForm.closeOpened')}</Button>}>{t('students.familyForm.openedNote', { name: family.name })}</Note>}
        <FamilyFormsPanel onOpen={openFamily} openId={family?.id} />
        <AlreadyHere form={form} />
        <Note icon={Users}>{t('students.admit.requiredNote')}</Note>
        {localRule.required && (
          <Note icon={Languages} tone={localRule.missing ? 'warning' : undefined}>
            {t('students.admit.localNamesNote', { campus: localRule.campus.name, language: localRule.language })}
          </Note>
        )}
        {docsMissing.length > 0 && (
          <Note icon={FileCheck2} tone="warning">{t('students.docs.missingNow', { list: docsMissing.map((d) => t(`students.docs.kinds.${d.category}`)).join(', ') })}</Note>
        )}
      </>}
    >
      {reviewing ? (
        <AdmissionReview form={form} names={names} placement={placement} documents={docs} checklist={checklist} onEdit={() => { setReviewing(false); top() }} />
      ) : (
        <>
          <StudentForm value={form} onChange={setForm} errors={errors} names={names} />
          <FormSection title={t('students.docs.title')} hint={campus ? t('students.docs.hintCampus', { campus: campus.name }) : t('students.docs.hint')}>
            <AdmissionDocuments checklist={checklist} items={docs} onAdd={addDoc} onRemove={removeDoc} />
          </FormSection>
        </>
      )}
      {sending && <SendFormModal prefill={sendPrefill} onClose={() => setSending(false)} />}
    </FormPage>
  )
}

/** "Class 5 – A (CBSE)" for the review. */
function useSectionLabel(sectionId) {
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  return lookup?.sections?.find((s) => s.id === sectionId)?.label ?? ''
}
