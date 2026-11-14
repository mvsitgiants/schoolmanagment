import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, FileText, RotateCcw, Send, Users } from 'lucide-react'
import { APPLICATION_STATUS } from '@schoolgiant/shared'
import { FormPage, Note, Panel, PersonCell, SectionCard, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import ApplicationForm, { applicationBody, emptyApplication } from '../../components/admissions/ApplicationForm'
import { createApplication, fetchCycles, fetchApplications, fetchEnquiry } from '../../api/admissions'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

/** What to look up while typing: the parent's mobile (6+ digits) beats the child's first name (3+ letters). */
function probeOf(form) {
  const mobile = String(form.parent.mobile ?? '').replace(/\D/g, '')
  if (mobile.length >= 6) return { search: mobile.slice(-10), by: 'mobile' }
  const first = form.child.firstName.trim()
  return first.length >= 3 ? { search: first, by: 'name', last: form.child.lastName.trim().toLowerCase() } : null
}

/** Right-hand panel: applications already made for this family (any cycle) — so a child isn't entered twice. */
function AppliedBefore({ form }) {
  const { t } = useTranslation('admissions')
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['applications', 'new-check', key],
    queryFn: () => fetchApplications({ search: p.search, pageSize: 8 }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  // a first-name hit only counts when the surname also fits (if one is typed)
  const rows = !p ? [] : (data?.data ?? []).filter((a) => p.by !== 'name' || !p.last || String(a.childName ?? '').toLowerCase().includes(p.last)).slice(0, 5)

  if (!rows.length) {
    return (
      <Panel title={t('admissions.applications.page.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('admissions.applications.page.check.checking') : t('admissions.applications.page.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={Users} tone="warning" title={t('admissions.applications.page.check.found')} count={rows.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{p.by === 'mobile' ? t('admissions.applications.page.check.byMobile') : t('admissions.applications.page.check.byName')}</p>
      <ul className="divide-y divide-border">
        {rows.map((a) => (
          <li key={a.id}>
            <Link to={`/admissions/applications?open=${a.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-bg">
              <PersonCell name={a.childName} sub={[a.className, a.cycleName, a.parent?.name].filter(Boolean).join(' · ')} size={32} />
              <StatusPill tone={APPLICATION_STATUS[a.status]?.tone}>{t(`admissions.status.${a.status}`, a.statusLabel)}</StatusPill>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Shown when the page was opened from an enquiry's "Make application": what was carried over. */
function FromEnquiry({ enquiry }) {
  const { t } = useTranslation('admissions')
  return (
    <Panel title={t('admissions.applications.page.fromEnquiry.title')} icon={ClipboardList}>
      <p className="text-sm text-ink">{enquiry.childName}{enquiry.className ? ` · ${enquiry.className}` : ''}</p>
      <p className="text-xs text-ink-muted mt-0.5">{[enquiry.enquiryNo, enquiry.parentName, enquiry.mobile].filter(Boolean).join(' · ')}</p>
      <p className="text-xs text-ink-muted mt-2">{t('admissions.applications.page.fromEnquiry.body')}</p>
    </Panel>
  )
}

/** New application at the admission desk — a full page; `?enquiry=<id>` fills it from that enquiry. */
export default function NewApplication() {
  const { t } = useTranslation('admissions')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [params] = useSearchParams()
  const enquiryId = params.get('enquiry') || ''
  const { data: cycles = [], isLoading } = useQuery({ queryKey: ['admission-cycles'], queryFn: fetchCycles })
  const open = cycles.filter((c) => c.status !== 'CLOSED')
  // an open cycle first, else the newest that isn't closed
  const firstCycle = open.find((c) => c.status === 'OPEN') ?? open[0] ?? null
  const [form, setForm] = useState(() => emptyApplication(null))
  const [errors, setErrors] = useState({})

  // the cycle arrives after the first paint
  useEffect(() => { if (firstCycle && !form.cycleId) setForm((f) => ({ ...f, cycleId: firstCycle.id })) }, [firstCycle, form.cycleId])

  const { data: enquiry } = useQuery({ queryKey: ['enquiry', enquiryId], queryFn: () => fetchEnquiry(enquiryId), enabled: !!enquiryId })
  useEffect(() => {
    if (!enquiry) return
    const [firstName, ...rest] = enquiry.childName.split(' ')
    setForm((f) => ({ ...f, classId: enquiry.classId ?? f.classId, child: { ...f.child, firstName, lastName: rest.join(' '), dob: enquiry.dob ?? '', gender: enquiry.gender ?? '' }, parent: { ...f.parent, name: enquiry.parentName ?? '', mobile: enquiry.mobile, email: enquiry.email ?? '' } }))
  }, [enquiry])

  const save = useMutation({
    mutationFn: () => createApplication({ ...applicationBody(form), enquiryId: enquiryId || undefined }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['applications'] })
      qc.invalidateQueries({ queryKey: ['admission-cycles'] })
      qc.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess(t('admissions.applications.saved', { no: a.applicationNo }))
      navigate(`/admissions/applications?open=${a.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const ready = form.cycleId && form.classId && form.child.firstName.trim() && form.child.dob && form.child.gender
    && form.parent.name.trim() && form.parent.mobile.replace(/\D/g, '').length >= 10
  const clear = () => { setForm(emptyApplication(firstCycle)); setErrors({}) }
  const noCycle = !isLoading && !open.length

  return (
    <FormPage
      icon={FileText} title={t('admissions.applications.page.title')} subtitle={t('admissions.applications.page.subtitle')}
      headerActions={<Button to="/admissions/applications" variant="secondary" icon={FileText}>{t('admissions.applications.page.list')}</Button>}
      loading={isLoading}
      errors={errors}
      submitLabel={t('admissions.applications.submit')} submitIcon={Send} requires="create"
      onSubmit={noCycle ? undefined : () => save.mutate()} saving={save.isPending} canSubmit={!!ready}
      cancelLabel={t('admissions.applications.page.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        {enquiry && <FromEnquiry enquiry={enquiry} />}
        <AppliedBefore form={form} />
        <Note icon={FileText}>{t('admissions.applications.page.requiredNote')}</Note>
      </>}
    >
      {noCycle ? <Note tone="warning">{t('admissions.applications.noCycle')}</Note> : <ApplicationForm cycles={open} value={form} onChange={setForm} errors={errors} />}
    </FormPage>
  )
}
