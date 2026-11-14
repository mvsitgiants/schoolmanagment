import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, RotateCcw, UserPlus, Users } from 'lucide-react'
import { FormPage, Note, Panel, PersonCell, SectionCard } from '../../components/system'
import Button from '../../components/ui/Button'
import StudentForm, { studentBody, studentFormValues } from '../../components/students/StudentForm'
import { admitStudent, fetchStudents } from '../../api/students'
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

/** New admission: one form, the admission number comes from the number series unless typed. */
export default function Admit() {
  const { t } = useTranslation('students')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => studentFormValues(null))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => admitStudent(studentBody(form)),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['academic-classes'] })
      showSuccess(t('students.admit.done', { name: s.name, no: s.admissionNo }))
      navigate(`/students/profile/${s.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const ready = form.firstName.trim() && form.sectionId && form.guardians.some((g) => g.name.trim())
  const clear = () => { setForm(studentFormValues(null)); setErrors({}) }

  return (
    <FormPage
      icon={UserPlus} title={t('students.admit.title')} subtitle={t('students.admit.subtitle')}
      headerActions={hasPermission('students.directory.view') && <Button to="/students/directory" variant="secondary" icon={ClipboardList}>{t('students.admit.directory')}</Button>}
      errors={errors}
      submitLabel={t('students.admit.save')} submitIcon={UserPlus} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={!!ready}
      cancelLabel={t('students.admit.clear')} cancelIcon={RotateCcw} onCancel={clear}
      aside={<>
        <AlreadyHere form={form} />
        <Note icon={Users}>{t('students.admit.requiredNote')}</Note>
      </>}
    >
      <StudentForm value={form} onChange={setForm} errors={errors} />
    </FormPage>
  )
}
