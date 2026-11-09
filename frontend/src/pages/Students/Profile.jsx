import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Modal, Note, PageContainer, Skeleton, SkeletonRows, Tabs, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues } from '../../components/students/StudentForm'
import Hero, { HeroActions } from '../../components/students/profile/Hero'
import KpiStrip from '../../components/students/profile/KpiStrip'
import OverviewTab from '../../components/students/profile/OverviewTab'
import ProfileTab, { completenessOf } from '../../components/students/profile/ProfileTab'
import FamilyTab from '../../components/students/profile/FamilyTab'
import AcademicsTab from '../../components/students/profile/AcademicsTab'
import AttendanceTab from '../../components/students/profile/AttendanceTab'
import FeesTab from '../../components/students/profile/FeesTab'
import CampusTab from '../../components/students/profile/CampusTab'
import DocumentsTab from '../../components/students/profile/DocumentsTab'
import HistoryTab from '../../components/students/profile/HistoryTab'
import { fetchStudent, fetchStudentOverview, fetchStudentPhoto, setStudentStatus, updateStudent } from '../../api/students'
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

const TAB_ORDER = ['overview', 'profile', 'family', 'academics', 'attendance', 'fees', 'campus', 'documents', 'history']

/**
 * Student 360: who the student is (hero, Profile, Family, Documents — GET /students/:id) and their school life
 * (KPIs, Overview, Academics, Attendance, Fees, Campus life — GET /students/:id/overview, a section per module the
 * caller may see). A tab shows only when it has something for this student and this role. ?tab= opens one.
 */
export default function Profile() {
  const { id } = useParams()
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { date } = useFormat()
  const [params, setParams] = useSearchParams()
  const [reveal, setReveal] = useState(false)
  const [editing, setEditing] = useState(false)
  const { data: s, isLoading, error } = useQuery({ queryKey: ['student', id, reveal], queryFn: () => fetchStudent(id, { reveal }), enabled: !!id, retry: false })
  const ov = useQuery({ queryKey: ['student', id, 'overview'], queryFn: () => fetchStudentOverview(id), enabled: !!id, retry: false, staleTime: 60_000 })
  const photo = useQuery({ queryKey: ['student-photo', id], queryFn: () => fetchStudentPhoto(id), enabled: !!id, staleTime: 300_000 })
  const fetching = useIsFetching({ queryKey: ['student', id] })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['students'] }) }
  const status = useMutation({ mutationFn: (to) => setStudentStatus(id, to), onSuccess: () => { refresh(); showSuccess(t('students.profile.statusSaved')) }, onError: (e) => showError(e.message) })

  if (!id) return <Navigate to="/students/directory" replace />
  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5" aria-busy="true">
          <Skeleton className="h-24 w-24 shrink-0 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-1/2" /><span className="sr-only">{t('students.loading')}</span></div>
        </div>
        <div className="rounded-xl border border-border bg-surface py-3"><SkeletonRows rows={4} /></div>
      </PageContainer>
    )
  }
  if (error || !s) return <PageContainer><Note tone="warning">{error?.response?.status === 404 ? t('students.profile.notFound') : error?.message}</Note></PageContainer>

  const o = ov.data
  const canEdit = hasPermission('students.profile.edit')
  const can = { edit: canEdit, idCard: hasPermission('students.id-cards.print'), tc: hasPermission('students.transfer.create') }
  const completeness = completenessOf(s, !!photo.data?.photo, t)

  // a tab only when there is something in it for this student and this role
  const has = {
    overview: true, profile: true, family: true, documents: true, history: true,
    academics: !!(o?.exams || o?.homework || o?.programs || o?.timetable?.perWeek?.length),
    attendance: !!o?.attendance,
    fees: !!o?.fees,
    campus: !!(o?.transport || o?.hostel || o?.library || o?.canteen || o?.health),
  }
  const tabs = TAB_ORDER.filter((x) => has[x]).map((x) => ({ value: x, label: t(`students.profile.tabs.${x}`) }))
  const wanted = params.get('tab') || 'overview'
  // a deep link to a module tab waits for the overview rather than bouncing to Overview
  const tab = has[wanted] ? wanted : ov.isPending && TAB_ORDER.includes(wanted) ? wanted : 'overview'
  const setTab = (x) => setParams(x === 'overview' ? {} : { tab: x }, { replace: true })
  const goto = (x) => { setTab(x); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const waiting = ov.isPending && !has[tab]

  const makeInactive = async () => {
    if (await confirm({ title: t('students.profile.inactiveConfirm.title', { name: s.name }), message: t('students.profile.inactiveConfirm.message'), confirmLabel: t('students.profile.markInactive') })) status.mutate('INACTIVE')
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3 text-sm">
        <Link to="/students/directory" className="inline-flex items-center gap-1.5 text-brand-600 hover:underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />{t('students.profile.backLabel')}</Link>
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={fetching > 0} onClick={refresh} title={t('students.profile.refresh')} aria-label={t('students.profile.refresh')} />
      </div>

      <Hero s={s} onPhoto={() => goto('documents')}
        actions={<HeroActions s={s} can={can} busy={status.isPending} onEdit={() => setEditing(true)} onIdCard={() => printDocument('STUDENT_ID_CARD', [s.id])}
          onTc={() => navigate(`/students/transfer?student=${s.id}`)} onInactive={makeInactive} onActive={() => status.mutate('ACTIVE')} />} />

      {s.leaving?.tcNo && <Note tone="warning">{t('students.profile.leftNote', { date: date(s.leaving.date), tc: s.leaving.tcNo })}</Note>}

      {ov.isPending ? <KpiSkeleton /> : <KpiStrip o={o} onGoto={goto} />}
      {ov.error && <Note tone="warning">{t('students.profile.overviewFailed')}</Note>}

      <div className="flex min-w-0 flex-col gap-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {waiting && <div className="rounded-xl border border-border bg-surface py-3"><SkeletonRows rows={5} /></div>}
        {tab === 'overview' && <OverviewTab s={s} o={o} loading={ov.isPending} completeness={completeness} onGoto={goto} />}
        {tab === 'profile' && <ProfileTab s={s} completeness={completeness} canEdit={canEdit} onEdit={() => setEditing(true)}
          canReveal={hasPermission('students.profile.view_sensitive')} reveal={reveal} onReveal={() => setReveal((v) => !v)} />}
        {tab === 'family' && <FamilyTab s={s} canEdit={canEdit || hasPermission('students.guardians.edit')} onEdit={() => setEditing(true)} />}
        {tab === 'academics' && has.academics && <AcademicsTab s={s} o={o} />}
        {tab === 'attendance' && has.attendance && <AttendanceTab a={o.attendance} />}
        {tab === 'fees' && has.fees && <FeesTab s={s} f={o.fees} />}
        {tab === 'campus' && has.campus && <CampusTab o={o} />}
        {tab === 'documents' && <DocumentsTab s={s} o={o} canEdit={canEdit} />}
        {tab === 'history' && <HistoryTab s={s} o={o} />}
      </div>

      {editing && <EditStudent student={s} onClose={() => setEditing(false)} onSaved={() => { refresh(); qc.invalidateQueries({ queryKey: ['student-photo', id] }); showSuccess(t('students.profile.saved')); setEditing(false) }} />}
    </PageContainer>
  )
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
    </div>
  )
}
