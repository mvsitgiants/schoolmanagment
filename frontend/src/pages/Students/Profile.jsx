import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Eye, EyeOff, FileText, History, Pencil, Phone, Printer, Star, UserMinus, UserRound, UserCheck } from 'lucide-react'
import { HISTORY_EVENTS, STUDENT_STATUS, TC_STATUS } from '@schoolgiant/shared'
import { Attachments, FactGrid, Modal, Note, PageContainer, Panel, RecordHero, StatusPill, Tabs, Timeline, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues } from '../../components/students/StudentForm'
import StudentPhoto from '../../components/students/StudentPhoto'
import { fetchStudent, setStudentStatus, updateStudent } from '../../api/students'
import { hasPermission } from '../../api/auth'
import { printDocument } from '../../components/print/printDocument'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function EditStudent({ student, onClose, onSaved }) {
  const { t } = useTranslation('students')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => studentFormValues(student))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => updateStudent(student.id, studentBody(form, { editing: true })),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="xl" title={t('students.profile.editTitle', { name: student.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.firstName.trim() || !form.sectionId} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <StudentForm value={form} onChange={setForm} errors={errors} editing aadhaarSet={student.aadhaarSet} />
    </Modal>
  )
}

export default function Profile() {
  const { id } = useParams()
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date, dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [tab, setTab] = useState('overview')
  const [reveal, setReveal] = useState(false)
  const [editing, setEditing] = useState(false)
  const { data: s, isLoading, error } = useQuery({ queryKey: ['student', id, reveal], queryFn: () => fetchStudent(id, { reveal }), enabled: !!id, retry: false })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['students'] }) }
  const status = useMutation({ mutationFn: (to) => setStudentStatus(id, to), onSuccess: () => { refresh(); showSuccess(t('students.profile.statusSaved')) }, onError: (e) => showError(e.message) })

  if (!id) return <Navigate to="/students/directory" replace />
  if (isLoading) return <PageContainer><p className="text-sm text-ink-faint">{t('students.loading')}</p></PageContainer>
  if (error || !s) return <PageContainer><Note tone="warning">{error?.response?.status === 404 ? t('students.profile.notFound') : error?.message}</Note></PageContainer>

  const canEdit = hasPermission('students.profile.edit')
  const genderAge = [s.gender && t(`students.genders.${s.gender}`, s.gender), s.age != null && t('students.directory.age', { count: s.age })].filter(Boolean).join(' · ')
  const tabs = [
    { value: 'overview', label: t('students.profile.tabs.overview') },
    { value: 'family', label: t('students.profile.tabs.family') },
    { value: 'documents', label: t('students.profile.tabs.documents') },
    { value: 'history', label: t('students.profile.tabs.history') },
  ]
  const relation = (r) => (r ? t(`students.relations.${r}`, r) : null)

  return (
    <PageContainer>
      <div className="mb-3 text-sm"><Link to="/students/directory" className="text-brand-600 hover:underline">{t('students.profile.back')}</Link></div>
      <RecordHero name={s.name} icon={UserRound}
        subtitle={[s.classLabel, s.rollNo && t('students.directory.roll', { no: s.rollNo }), genderAge].filter(Boolean).join(' · ')}
        chips={<span className="text-xs font-mono-num px-2 py-0.5 rounded bg-bg border border-border text-ink">{s.admissionNo}</span>}
        status={<StatusPill tone={STUDENT_STATUS[s.status]?.tone}>{t(`students.status.${s.status}`, STUDENT_STATUS[s.status]?.label)}</StatusPill>}
        aside={<div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{t('actions.edit')}</Button>}
          {s.status === 'ACTIVE' && hasPermission('students.transfer.create') && <Button variant="secondary" icon={ArrowLeftRight} onClick={() => navigate(`/students/transfer?student=${s.id}`)}>{t('students.profile.requestTc')}</Button>}
          {canEdit && s.status === 'ACTIVE' && <Button variant="ghost" icon={UserMinus} onClick={async () => { if (await confirm({ title: t('students.profile.inactiveConfirm.title', { name: s.name }), message: t('students.profile.inactiveConfirm.message'), confirmLabel: t('students.profile.markInactive') })) status.mutate('INACTIVE') }}>{t('students.profile.markInactive')}</Button>}
          {canEdit && s.status !== 'ACTIVE' && <Button variant="secondary" icon={UserCheck} onClick={() => status.mutate('ACTIVE')}>{t('students.profile.markActive')}</Button>}
        </div>}
        facts={[
          { label: t('students.profile.primaryGuardian'), value: s.guardianName ? `${s.guardianName}${s.guardianMobile ? ` · ${s.guardianMobile}` : ''}` : '—' },
          { label: t('students.form.admissionDate'), value: s.admissionDate ? date(s.admissionDate) : '—' },
          { label: t('students.profile.year'), value: s.yearName ?? '—' },
        ]} />

      {s.leaving?.tcNo && <Note tone="warning" className="mt-4">{t('students.profile.leftNote', { date: date(s.leaving.date), tc: s.leaving.tcNo })}</Note>}

      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mt-6 mb-4" />

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel title={t('students.form.student')} actions={hasPermission('students.profile.view_sensitive') && s.aadhaarSet && (
            <Button size="sm" variant="ghost" icon={reveal ? EyeOff : Eye} onClick={() => setReveal(!reveal)}>{reveal ? t('students.profile.hideIds') : t('students.profile.showIds')}</Button>
          )}>
            <FactGrid cols={2} items={[
              { label: t('students.form.dob'), value: s.dob ? date(s.dob) : null },
              { label: t('students.form.gender'), value: s.gender && t(`students.genders.${s.gender}`, s.gender) },
              { label: t('students.form.bloodGroup'), value: s.bloodGroup },
              { label: t('students.form.category'), value: s.category && t(`students.categories.${s.category}`, s.category) },
              { label: t('students.form.religion'), value: s.religion },
              { label: t('students.form.nationality'), value: s.nationality },
              { label: t('students.form.motherTongue'), value: s.motherTongue },
              { label: t('students.form.aadhaar'), value: s.aadhaar, mono: true },
              { label: t('students.form.apaarId'), value: s.apaarId, mono: true },
              { label: t('students.form.pen'), value: s.pen, mono: true },
            ]} />
          </Panel>
          <Panel title={t('students.form.contact')}>
            <FactGrid cols={2} items={[
              { label: t('students.form.addressLine'), value: [s.address?.line, s.address?.city, s.address?.state, s.address?.pincode].filter(Boolean).join(', ') || null, span: 'full' },
              { label: t('students.form.studentMobile'), value: s.mobile, mono: true },
              { label: t('students.form.studentEmail'), value: s.email },
            ]} />
          </Panel>
          <Panel title={t('students.form.previousSchool')}>
            <FactGrid cols={2} items={[
              { label: t('students.form.schoolName'), value: s.previousSchool?.name, span: 'full' },
              { label: t('students.form.board'), value: s.previousSchool?.board },
              { label: t('students.form.lastClass'), value: s.previousSchool?.lastClass },
              { label: t('students.form.tcNo'), value: s.previousSchool?.tcNo, mono: true },
            ]} />
          </Panel>
          <Panel title={t('students.form.medical')}>
            <FactGrid cols={1} items={[
              { label: t('students.form.allergies'), value: s.medical?.allergies },
              { label: t('students.form.conditions'), value: s.medical?.conditions },
              { label: t('students.form.medicalNotes'), value: s.medical?.notes, text: true },
            ]} />
          </Panel>
        </div>
      )}

      {tab === 'family' && (
        <div className="grid lg:grid-cols-2 gap-6">
          {s.guardians.map((g) => (
            <Panel key={g.id} title={g.name} subtitle={[relation(g.relation), g.occupation].filter(Boolean).join(' · ')}
              actions={g.isPrimary && <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700"><Star className="w-3.5 h-3.5" />{t('students.form.primary')}</span>}>
              <FactGrid cols={2} items={[
                { label: t('students.form.mobile'), value: g.mobile, icon: Phone, mono: true },
                { label: t('students.form.email'), value: g.email },
              ]} />
            </Panel>
          ))}
          <Panel title={t('students.profile.siblings')}>
            {s.siblings.length ? (
              <ul className="divide-y divide-border">{s.siblings.map((x) => (
                <li key={x.id} className="py-2 flex items-center justify-between text-sm"><Link to={`/students/profile/${x.id}`} className="text-brand-600 hover:underline">{x.name}</Link><span className="text-ink-faint font-mono-num">{x.classShort} · {x.admissionNo}</span></li>
              ))}</ul>
            ) : <p className="text-sm text-ink-faint">{t('students.profile.noSiblings')}</p>}
          </Panel>
        </div>
      )}

      {tab === 'documents' && (
        <div className="grid lg:grid-cols-[14rem_1fr] gap-6 items-start">
          <Panel title={t('students.photo.title')} subtitle={t('students.photo.hint')}>
            <StudentPhoto studentId={s.id} name={s.name} canEdit={canEdit || hasPermission('students.id-cards.print')} />
          </Panel>
          <Panel title={t('students.profile.tabs.documents')} subtitle={t('students.profile.documentsHint')}>
            <Attachments entityType="student" entityId={s.id} canAdd={canEdit || hasPermission('students.admit.create')} />
          </Panel>
        </div>
      )}

      {tab === 'history' && (
        <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
          <Panel title={t('students.profile.tabs.history')} icon={History}>
            <Timeline items={[...s.history].reverse().map((h, i) => ({
              id: String(i), title: t(`students.history.${h.event}`, HISTORY_EVENTS[h.event] ?? h.event),
              time: dateTime(h.at), meta: [h.classLabel, h.yearName, h.by].filter(Boolean).join(' · '), body: h.note,
            }))} />
          </Panel>
          <Panel title={t('students.profile.tcs')} icon={FileText}>
            {s.tcs.length ? s.tcs.map((tc) => (
              <div key={tc.id} className="py-2 border-b border-border last:border-0 flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-sm text-ink font-mono-num">{tc.tcNo ?? t('students.transfer.draft')}</p><p className="text-xs text-ink-faint">{date(tc.leavingDate)} · {tc.reasonLabel}</p></div>
                <div className="flex items-center gap-1"><StatusPill tone={TC_STATUS[tc.status]?.tone}>{t(`students.transfer.status.${tc.status}`, tc.statusLabel)}</StatusPill>
                  {hasPermission('students.transfer.print') && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.transfer.print')} title={t('students.transfer.print')} onClick={() => printDocument('TRANSFER_CERTIFICATE', tc.id)} />}</div>
              </div>
            )) : <p className="text-sm text-ink-faint">{t('students.profile.noTcs')}</p>}
          </Panel>
        </div>
      )}

      {editing && <EditStudent student={s} onClose={() => setEditing(false)} onSaved={() => { refresh(); showSuccess(t('students.profile.saved')); setEditing(false) }} />}
    </PageContainer>
  )
}
