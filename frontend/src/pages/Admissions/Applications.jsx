import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, GraduationCap, Plus } from 'lucide-react'
import { APPLICATION_STATUS } from '@schoolgiant/shared'
import { Attachments, ControlChip, DataTable, Drawer, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Select, StatusPill, Toolbar, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import ApplicationForm, { applicationBody, emptyApplication } from '../../components/admissions/ApplicationForm'
import FormRenderer from '../../components/forms/FormRenderer'
import useCycle from '../../components/admissions/useCycle'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { fetchClasses } from '../../api/academics'
import { admitApplicant, createApplication, fetchApplication, fetchApplications, fetchEnquiry, setApplicationStatus, updateApplication } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function NewApplication({ cycles, cycle, enquiryId, onClose, onSaved }) {
  const { t } = useTranslation('admissions')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => emptyApplication(cycle))
  const [errors, setErrors] = useState({})
  const { data: enquiry } = useQuery({ queryKey: ['enquiry', enquiryId], queryFn: () => fetchEnquiry(enquiryId), enabled: !!enquiryId })
  useEffect(() => {
    if (!enquiry) return
    const [firstName, ...rest] = enquiry.childName.split(' ')
    setForm((f) => ({ ...f, classId: enquiry.classId ?? f.classId, child: { ...f.child, firstName, lastName: rest.join(' '), dob: enquiry.dob ?? '', gender: enquiry.gender ?? '' }, parent: { ...f.parent, name: enquiry.parentName ?? '', mobile: enquiry.mobile, email: enquiry.email ?? '' } }))
  }, [enquiry])
  const save = useMutation({
    mutationFn: () => createApplication({ ...applicationBody(form), enquiryId: enquiryId || undefined }),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const open = cycles.filter((c) => c.status !== 'CLOSED')
  return (
    <Modal open onClose={onClose} size="xl" title={t('admissions.applications.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.cycleId || !form.classId || !form.child.firstName || !form.child.dob || !form.parent.name} onClick={() => save.mutate()}>{t('admissions.applications.submit')}</Button>
    </>}>
      {open.length ? <ApplicationForm cycles={open} value={form} onChange={setForm} errors={errors} /> : <Note tone="warning">{t('admissions.applications.noCycle')}</Note>}
    </Modal>
  )
}

function AdmitModal({ app, cycle, onClose, onDone }) {
  const { t } = useTranslation('admissions')
  const { showError } = useSnackbar()
  const { data } = useQuery({ queryKey: ['academic-classes', cycle?.academicYearId], queryFn: () => fetchClasses(cycle?.academicYearId) })
  const sections = (data?.classes ?? []).find((c) => c.id === app.classId)?.sections ?? []
  const [sectionId, setSectionId] = useState('')
  const [admissionNo, setAdmissionNo] = useState('')
  const go = useMutation({ mutationFn: () => admitApplicant(app.id, { sectionId, admissionNo: admissionNo || undefined }), onSuccess: onDone, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} title={t('admissions.applications.admitTitle', { name: app.childName })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button icon={GraduationCap} loading={go.isPending} disabled={!sectionId} onClick={() => go.mutate()}>{t('admissions.applications.admit')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('admissions.applications.section')} required hint={data?.year ? t('admissions.applications.sectionHint', { year: data.year.name }) : undefined}>
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">{t('admissions.form.pick')}</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.label ?? s.name}</option>)}</Select>
        </FormField>
        {!sections.length && <Note tone="warning">{t('admissions.applications.noSections')}</Note>}
        <FormField label={t('admissions.applications.admissionNo')} hint={t('admissions.applications.admissionNoHint')}><Input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} /></FormField>
        <Note>{t('admissions.applications.admitHint')}</Note>
      </div>
    </Modal>
  )
}

function ApplicationDrawer({ id, cycles, onClose }) {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: a } = useQuery({ queryKey: ['application', id], queryFn: () => fetchApplication(id) })
  const [score, setScore] = useState('')
  const [admitting, setAdmitting] = useState(false)
  useEffect(() => { if (a) setScore(a.score ?? '') }, [a])
  const after = (d) => { qc.setQueryData(['application', id], d); qc.invalidateQueries({ queryKey: ['applications'] }); qc.invalidateQueries({ queryKey: ['admission-cycles'] }) }
  const move = useMutation({ mutationFn: ({ status, note }) => setApplicationStatus(id, status, note), onSuccess: (d) => { after(d); showSuccess(t('admissions.applications.moved')) }, onError: (e) => showError(e.message) })
  const saveScore = useMutation({ mutationFn: () => updateApplication(id, { score: score === '' ? null : Number(score) }), onSuccess: (d) => { after(d); showSuccess(t('admissions.applications.scoreSaved')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('admissions.applications.edit')
  const ask = async (status, needNote) => {
    const note = needNote ? await prompt({ title: t(`admissions.applications.confirm.${status}`), label: t('admissions.applications.note'), required: status === 'REJECTED' || status === 'WITHDRAWN' }) : null
    if (needNote && note === null) return
    move.mutate({ status, note: note || undefined })
  }
  const ACTIONS = { SUBMITTED: ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'], UNDER_REVIEW: ['SHORTLISTED', 'WAITLISTED', 'REJECTED', 'WITHDRAWN'], SHORTLISTED: ['WAITLISTED', 'REJECTED', 'WITHDRAWN'], WAITLISTED: ['SHORTLISTED', 'REJECTED', 'WITHDRAWN'], OFFERED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'], ACCEPTED: ['WITHDRAWN'] }
  const cycle = cycles.find((c) => c.id === a?.cycleId)
  return (
    <Drawer open onClose={onClose} size="2xl" title={a ? a.childName : t('admissions.loading')} subtitle={a ? `${a.applicationNo} · ${a.className} · ${a.cycleName ?? ''}` : undefined}>
      {!a ? <p className="text-sm text-ink-faint">{t('admissions.loading')}</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={APPLICATION_STATUS[a.status]?.tone}>{t(`admissions.status.${a.status}`, a.statusLabel)}</StatusPill>
            <span className="text-sm text-ink-muted">{t(`admissions.channels.${a.channel}`)} · {dateTime(a.submittedAt)}</span>
            {a.rank && <span className="text-sm text-ink-muted">· {t('admissions.applications.rankN', { rank: a.rank })}</span>}
            {a.offer?.until && a.status === 'OFFERED' && <span className="text-sm text-ink-muted">· {t('admissions.applications.offerUntil', { date: date(a.offer.until) })}</span>}
          </div>
          {a.statusNote && <Note>{a.statusNote}</Note>}
          {canEdit && ACTIONS[a.status] && (
            <div className="flex flex-wrap gap-2">
              {ACTIONS[a.status].map((s) => <Button key={s} size="sm" variant={['REJECTED', 'WITHDRAWN'].includes(s) ? 'ghost' : 'secondary'} loading={move.isPending && move.variables?.status === s} onClick={() => ask(s, ['REJECTED', 'WITHDRAWN', 'WAITLISTED'].includes(s))}>{t(`admissions.applications.to.${s}`)}</Button>)}
              {['OFFERED', 'ACCEPTED'].includes(a.status) && hasPermission('admissions.applications.approve') && <Button size="sm" icon={GraduationCap} onClick={() => setAdmitting(true)}>{t('admissions.applications.admit')}</Button>}
            </div>
          )}
          {a.status === 'ADMITTED' && a.studentId && <Note tone="success">{t('admissions.applications.admitted')} <Link className="underline" to={`/students/profile/${a.studentId}`}>{t('admissions.applications.openStudent')}</Link></Note>}
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ink-muted">{t('admissions.form.dob')}</dt><dd>{a.child.dob ? date(a.child.dob) : '—'}</dd>
              <dt className="text-ink-muted">{t('admissions.form.gender')}</dt><dd>{a.child.gender ? t(`admissions.genders.${a.child.gender}`) : '—'}</dd>
              {a.child.previousSchool?.name && <><dt className="text-ink-muted">{t('admissions.form.previousSchool')}</dt><dd>{[a.child.previousSchool.name, a.child.previousSchool.lastClass].filter(Boolean).join(' · ')}</dd></>}
            </dl>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ink-muted">{t('admissions.form.parentName')}</dt><dd>{a.parent.name}{a.parent.relation ? ` (${t(`admissions.relations.${a.parent.relation}`)})` : ''}</dd>
              <dt className="text-ink-muted">{t('admissions.form.mobile')}</dt><dd className="font-mono-num">{a.parent.mobile}</dd>
              {a.parent.email && <><dt className="text-ink-muted">{t('admissions.form.email')}</dt><dd>{a.parent.email}</dd></>}
              {a.address?.line && <><dt className="text-ink-muted">{t('admissions.form.address')}</dt><dd>{[a.address.line, a.address.city, a.address.pincode].filter(Boolean).join(', ')}</dd></>}
            </dl>
          </div>
          <div className="rounded-lg border border-border p-3 grid sm:grid-cols-2 gap-3 items-end">
            <div className="text-sm">
              <p className="text-ink-muted">{t('admissions.applications.test')}</p>
              <p className="text-ink font-medium">{a.test ? `${a.test.name} · ${date(a.test.date)}${a.test.time ? ` ${a.test.time}` : ''}` : t('admissions.applications.noTest')}</p>
              {a.test && <p className="text-ink-muted">{a.testAbsent ? t('admissions.applications.absent') : a.testMarks !== null && a.testMarks !== undefined ? t('admissions.applications.marks', { marks: a.testMarks, max: a.test.maxMarks }) : t('admissions.applications.notMarked')}</p>}
            </div>
            {canEdit && cycle?.classes.find((c) => c.classId === a.classId)?.meritBasis === 'SCORE' && (
              <div className="flex gap-2 items-end">
                <FormField label={t('admissions.applications.score')}><Input type="number" min="0" max="1000" value={score} onChange={(e) => setScore(e.target.value)} className="w-28" /></FormField>
                <Button size="sm" variant="secondary" loading={saveScore.isPending} onClick={() => saveScore.mutate()}>{t('admissions.applications.saveScore')}</Button>
              </div>
            )}
          </div>
          {a.form?.definition && a.answers && <div><p className="text-sm font-semibold text-ink mb-2">{t('admissions.applications.answers')}</p><FormRenderer definition={a.form.definition} values={a.answers} readOnly /></div>}
          <Attachments entityType="application" entityId={a.id} canAdd={canEdit && a.status !== 'ADMITTED'} compact />
        </div>
      )}
      {admitting && a && <AdmitModal app={a} cycle={cycle} onClose={() => setAdmitting(false)} onDone={(r) => { after(r.application); setAdmitting(false); showSuccess(t('admissions.applications.admittedAs', { no: r.student.admissionNo })) }} />}
    </Drawer>
  )
}

export default function Applications() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const { cycles, cycle, chip } = useCycle()
  const [search, setSearch] = useState('')
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(() => (params.get('enquiry') ? { enquiryId: params.get('enquiry') } : null))
  const [openId, setOpenId] = useState(null)
  useEffect(() => { if (params.get('enquiry')) setParams({}, { replace: true }) }, [params, setParams])
  const q = useDebouncedValue(search.trim(), 250)
  const query = { cycleId: cycle?.id, search: q || undefined, classId: classId || undefined, status: status || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['applications', query], queryFn: () => fetchApplications(query), placeholderData: keepPreviousData, enabled: !!cycle })
  const classes = cycle?.classes ?? []
  const STATUSES = ['', ...Object.keys(APPLICATION_STATUS)]
  const statusLabel = (s) => (s ? t(`admissions.status.${s}`, APPLICATION_STATUS[s]?.label) : t('admissions.all'))
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={FileText} title={t('admissions.applications.title')} subtitle={t('admissions.applications.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="admissions.applications.create" onClick={() => setAdding({})}>{t('admissions.applications.new')}</HeaderButton>} />
      {!cycles.length && <Note tone="warning" className="mb-4">{t('admissions.noCycles')}</Note>}
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="applications"
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('admissions.applications.search')} right={<>
          {chip}
          <ControlChip label={t('admissions.form.class')} value={classes.find((c) => c.classId === classId)?.className ?? t('admissions.all')} active={!!classId} options={[t('admissions.all'), ...classes.map((c) => c.className)]} onChange={(v) => { setClassId(classes.find((c) => c.className === v)?.classId ?? ''); setPage(1) }} />
          <ControlChip label={t('admissions.statusLabel')} value={statusLabel(status)} active={!!status} options={STATUSES.map(statusLabel)} onChange={(v) => { setStatus(STATUSES.find((s) => statusLabel(s) === v) ?? ''); setPage(1) }} />
        </>} />}
        columns={[
          { key: 'applicationNo', header: t('admissions.applications.no'), nowrap: true, render: (v) => <span className="font-mono-num">{v}</span> },
          { key: 'childName', header: t('admissions.enquiries.child'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{r.className}</p></div> },
          { key: 'parent', header: t('admissions.form.parentName'), render: (v) => <div><p className="text-sm">{v.name}</p><p className="text-xs text-ink-faint font-mono-num">{v.mobile}</p></div> },
          { key: 'score', header: t('admissions.applications.score'), align: 'right', mobileHidden: true, render: (v, r) => (r.testAbsent ? t('admissions.applications.ab') : v ?? '—') },
          { key: 'rank', header: t('admissions.applications.rank'), align: 'right', mobileHidden: true, render: (v) => v ?? '—' },
          { key: 'status', header: t('admissions.statusLabel'), render: (v) => <StatusPill tone={APPLICATION_STATUS[v]?.tone}>{statusLabel(v)}</StatusPill> },
          { key: 'submittedAt', header: t('admissions.applications.submitted'), nowrap: true, mobileHidden: true, render: (v, r) => <span className="text-sm text-ink-muted">{dateTime(v)}<span className="block text-xs text-ink-faint">{t(`admissions.channels.${r.channel}`)}</span></span> },
        ]}
        onRowClick={(r) => setOpenId(r.id)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={FileText} emptyTitle={t('admissions.applications.empty')}
      />
      {adding && <NewApplication cycles={cycles} cycle={cycle} enquiryId={adding.enquiryId} onClose={() => setAdding(null)} onSaved={(a) => { qc.invalidateQueries({ queryKey: ['applications'] }); setAdding(null); setOpenId(a.id); showSuccess(t('admissions.applications.saved', { no: a.applicationNo })) }} />}
      {openId && <ApplicationDrawer id={openId} cycles={cycles} onClose={() => setOpenId(null)} />}
    </PageContainer>
  )
}
