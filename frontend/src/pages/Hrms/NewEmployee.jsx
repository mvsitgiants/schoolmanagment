import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, UserPlus, Users, UsersRound } from 'lucide-react'
import { EMPLOYEE_STATUSES } from '@schoolgiant/shared'
import { FormPage, Note, Panel, PersonCell, SectionCard, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import EmployeeForm, { employeeBody, employeeFormValues, employeeReady } from '../../components/hrms/EmployeeForm'
import { useHrLabels } from '../../components/hrms/HrKit'
import { createEmployee, fetchEmployees } from '../../api/hrms'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'

const digits = (v) => String(v ?? '').replace(/\D/g, '')

/**
 * What to look up while typing: a full mobile number beats an email, which beats the name (3+ letters).
 * A mobile is searched by its last five digits (numbers are saved with or without spaces) and matched in full here.
 */
function probeOf(form) {
  const mobile = digits(form.mobile).slice(-10)
  if (mobile.length === 10) return { search: mobile.slice(-5), by: 'mobile', mobile }
  const email = form.email.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { search: email, by: 'email' }
  const name = form.name.trim()
  return name.length >= 3 ? { search: name, by: 'name' } : null
}

/** Right-hand panel: people already on the staff (or who have left) who look like this one — so nobody is added twice. */
function AlreadyOnStaff({ form }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const probe = probeOf(form)
  const key = useDebouncedValue(probe ? JSON.stringify(probe) : '', 450)
  const p = key ? JSON.parse(key) : null
  const { data, isFetching } = useQuery({
    queryKey: ['employees', 'add-check', key],
    queryFn: () => fetchEmployees({ search: p.search, status: 'ALL', pageSize: 8 }),
    enabled: !!p,
    placeholderData: keepPreviousData,
  })
  const rows = !p ? [] : (data?.data ?? []).filter((e) => p.by !== 'mobile' || digits(e.mobile).endsWith(p.mobile)).slice(0, 5)

  if (!rows.length) {
    return (
      <Panel title={t('hrms.employees.add.check.title')}>
        <p className="text-sm text-ink-muted">{p && isFetching ? t('hrms.employees.add.check.checking') : t('hrms.employees.add.check.empty')}</p>
      </Panel>
    )
  }
  return (
    <SectionCard icon={Users} tone="warning" title={t('hrms.employees.add.check.title')} count={rows.length} flush>
      <p className="px-4 pt-3 text-xs text-ink-muted">{t(`hrms.employees.add.check.by.${p.by}`)}</p>
      <ul className="divide-y divide-border">
        {rows.map((e) => (
          <li key={e.id}>
            <Link to={`/hrms/employees/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-bg">
              <PersonCell name={e.name} sub={[e.employeeCode, e.designation, e.mobile].filter(Boolean).join(' · ')} size={32} />
              {e.status !== 'ACTIVE' && <StatusPill tone={EMPLOYEE_STATUSES[e.status]?.tone}>{L.status(e.status)}</StatusPill>}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Staff & HR › Staff › Add: a new staff record; their profile opens after saving (salary, bank, IDs and documents go there). */
export default function NewEmployee() {
  const { t } = useTranslation('hrms')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [form, setForm] = useState(() => employeeFormValues())
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: () => createEmployee(employeeBody(form)),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['hrms-meta'] })
      showSuccess(t('hrms.employees.saved'))
      navigate(`/hrms/employees/${e.id}`)
    },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  return (
    <FormPage
      icon={UserPlus} title={t('hrms.employees.newTitle')} subtitle={t('hrms.employees.add.subtitle')}
      headerActions={<Button to="/hrms/employees" variant="secondary" icon={ClipboardList}>{t('hrms.employees.add.list')}</Button>}
      errors={errors}
      submitLabel={t('hrms.employees.add.save')} submitIcon={UserPlus} requires="create"
      onSubmit={() => save.mutate()} saving={save.isPending} canSubmit={employeeReady(form)}
      onCancel={() => navigate('/hrms/employees')}
      aside={<>
        <AlreadyOnStaff form={form} />
        <Note icon={UsersRound}>{t('hrms.employees.add.requiredNote')}</Note>
      </>}
    >
      <EmployeeForm value={form} onChange={setForm} errors={errors} autoFocus />
    </FormPage>
  )
}
