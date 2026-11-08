import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, UserPlus, Users, UsersRound } from 'lucide-react'
import { EMPLOYEE_CATEGORIES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, GENDERS } from '@schoolgiant/shared'
import { ControlChip, DataTable, FormField, HeaderButton, ImportExportButtons, Input, Modal, PageContainer, PageHeader, Select, StatCardRow, StatusPill, Textarea, Toolbar, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { createEmployee, exportEmployees, fetchEmployees, importEmployees, recordsFromLogins, updateEmployee } from '../../api/hrms'
import { fetchRoles } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { readSheet } from '../../utils/readSheet'
import { useHrLabels, useHrMeta } from '../../components/hrms/HrKit'

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** New staff record, or edit one (personal and job details; salary and ids are on the profile). */
export function EmployeeForm({ employee, onClose, onSaved }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const { showError } = useSnackbar()
  const { data: meta } = useHrMeta()
  const canUsers = hasPermission('core.users.create')
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: !employee && canUsers })
  const e0 = employee ?? {}
  const [form, setForm] = useState({
    name: e0.name ?? '', employeeCode: e0.employeeCode ?? '', designation: e0.designation ?? '', category: e0.category ?? 'TEACHING', employmentType: e0.employmentType ?? 'PERMANENT',
    departmentId: e0.departmentId ?? '', branchId: e0.branchId ?? '', reportingManagerId: e0.reportingManagerId ?? '', joiningDate: e0.joiningDate ?? '', confirmationDate: e0.confirmationDate ?? '',
    gender: e0.gender ?? '', dob: e0.dob ?? '', bloodGroup: e0.bloodGroup ?? '', mobile: e0.mobile ?? '', email: e0.email ?? '',
    qualifications: e0.qualifications ?? '', experienceYears: e0.experienceYears ?? '', subjects: (e0.subjects ?? []).join(', '),
    weeklyOffDays: e0.weeklyOffDays ?? [], notes: e0.notes ?? '', changeNote: '',
    login: 'none', userId: '', loginEmail: '', roleId: '',
  })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const body = () => {
    const b = {
      name: form.name, employeeCode: form.employeeCode, designation: form.designation, category: form.category, employmentType: form.employmentType,
      departmentId: form.departmentId || null, branchId: form.branchId || null, reportingManagerId: form.reportingManagerId || null,
      joiningDate: form.joiningDate, confirmationDate: form.confirmationDate, gender: form.gender, dob: form.dob, bloodGroup: form.bloodGroup,
      mobile: form.mobile, email: form.email, qualifications: form.qualifications, experienceYears: form.experienceYears,
      subjects: form.subjects.split(',').map((s) => s.trim()).filter(Boolean), weeklyOffDays: form.weeklyOffDays, notes: form.notes,
    }
    if (employee) return { ...b, changeNote: form.changeNote }
    if (form.login === 'link') b.userId = form.userId || null
    if (form.login === 'new') b.login = { email: form.loginEmail || form.email, roleIds: form.roleId ? [form.roleId] : [], invite: true }
    return b
  }
  const save = useMutation({
    mutationFn: () => (employee ? updateEmployee(employee.id, body()) : createEmployee(body())),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const managers = (meta?.staff ?? []).filter((s) => s.id !== employee?.id)
  return (
    <Modal open onClose={onClose} size="xl" title={employee ? t('hrms.employees.editTitle') : t('hrms.employees.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.joiningDate} onClick={() => save.mutate()}>{t('hrms.employees.save')}</Button>
    </>}>
      <div className="space-y-5">
        <section className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><FormField label={t('hrms.employees.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} /></FormField></div>
          <FormField label={t('hrms.employees.code')} hint={employee ? undefined : t('hrms.employees.codeHint')} error={errors.employeeCode}><Input value={form.employeeCode} onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value.toUpperCase() }))} /></FormField>
          <FormField label={t('hrms.employees.designation')} error={errors.designation}><Input value={form.designation} onChange={set('designation')} placeholder={t('hrms.employees.designationPlaceholder')} /></FormField>
          <FormField label={t('hrms.employees.category')} required>
            <Select value={form.category} onChange={set('category')}>{EMPLOYEE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{L.category(c.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('hrms.employees.employmentType')} required>
            <Select value={form.employmentType} onChange={set('employmentType')}>{EMPLOYMENT_TYPES.map((c) => <option key={c.value} value={c.value}>{L.employment(c.value)}</option>)}</Select>
          </FormField>
          <FormField label={t('hrms.employees.department')}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('hrms.none')}</option>
              {(meta?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          {(meta?.branches ?? []).length > 1 && (
            <FormField label={t('hrms.employees.branch')}>
              <Select value={form.branchId} onChange={set('branchId')}>
                <option value="">{t('hrms.employees.mainCampus')}</option>
                {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </FormField>
          )}
          <FormField label={t('hrms.employees.manager')} hint={t('hrms.employees.managerHint')} error={errors.reportingManagerId}>
            <Select value={form.reportingManagerId} onChange={set('reportingManagerId')}>
              <option value="">{t('hrms.none')}</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.designation ? `${m.name} · ${m.designation}` : m.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hrms.employees.joiningDate')} required error={errors.joiningDate}><Input type="date" value={form.joiningDate} onChange={set('joiningDate')} /></FormField>
          <FormField label={t('hrms.employees.confirmationDate')} error={errors.confirmationDate}><Input type="date" value={form.confirmationDate} onChange={set('confirmationDate')} /></FormField>
        </section>

        <section className="grid sm:grid-cols-3 gap-4">
          <FormField label={t('hrms.employees.mobile')} error={errors.mobile}><Input value={form.mobile} onChange={set('mobile')} inputMode="tel" /></FormField>
          <FormField label={t('hrms.employees.email')} error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
          <FormField label={t('hrms.employees.gender')}>
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">{t('hrms.none')}</option>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{t(`hrms.genders.${g.value}`)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('hrms.employees.dob')} error={errors.dob}><Input type="date" value={form.dob} onChange={set('dob')} /></FormField>
          <FormField label={t('hrms.employees.qualifications')}><Input value={form.qualifications} onChange={set('qualifications')} placeholder={t('hrms.employees.qualificationsPlaceholder')} /></FormField>
          <FormField label={t('hrms.employees.experience')}><Input type="number" min="0" value={form.experienceYears} onChange={set('experienceYears')} /></FormField>
          {form.category === 'TEACHING' && <div className="sm:col-span-3"><FormField label={t('hrms.employees.subjects')} hint={t('hrms.employees.subjectsHint')}><Input value={form.subjects} onChange={set('subjects')} /></FormField></div>}
        </section>

        <section>
          <p className="text-xs font-medium text-ink-muted mb-2">{t('hrms.employees.weeklyOff')}</p>
          <div className="flex flex-wrap gap-2">
            {WEEK.map((d) => (
              <label key={d} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={form.weeklyOffDays.includes(d)} onChange={() => setForm((f) => ({ ...f, weeklyOffDays: f.weeklyOffDays.includes(d) ? f.weeklyOffDays.filter((x) => x !== d) : [...f.weeklyOffDays, d] }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                {L.day(d)}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1">{t('hrms.employees.weeklyOffHint')}</p>
        </section>

        {!employee && (
          <section className="space-y-3">
            <p className="text-sm font-medium text-ink">{t('hrms.employees.loginTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {['none', 'link', ...(canUsers ? ['new'] : [])].map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="radio" name="login" checked={form.login === k} onChange={() => setForm((f) => ({ ...f, login: k }))} className="border-border text-brand-500 focus:ring-brand-500" />
                  {t(`hrms.employees.login.${k}`)}
                </label>
              ))}
            </div>
            {form.login === 'link' && (
              <FormField label={t('hrms.employees.pickLogin')} error={errors.userId}>
                <Select value={form.userId} onChange={set('userId')}>
                  <option value="">{t('hrms.employees.pickLogin')}</option>
                  {(meta?.unlinkedUsers ?? []).map((u) => <option key={u.id} value={u.id}>{`${u.name} · ${u.email}`}</option>)}
                </Select>
              </FormField>
            )}
            {form.login === 'new' && (
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField label={t('hrms.employees.loginEmail')} hint={t('hrms.employees.loginEmailHint')}><Input type="email" value={form.loginEmail} onChange={set('loginEmail')} placeholder={form.email} /></FormField>
                <FormField label={t('hrms.employees.role')} required>
                  <Select value={form.roleId} onChange={set('roleId')}>
                    <option value="">{t('hrms.employees.pickRole')}</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                </FormField>
              </div>
            )}
          </section>
        )}

        {employee && <FormField label={t('hrms.employees.changeNote')} hint={t('hrms.employees.changeNoteHint')}><Input value={form.changeNote} onChange={set('changeNote')} /></FormField>}
        <FormField label={t('hrms.employees.notes')}><Textarea rows={2} value={form.notes} onChange={set('notes')} /></FormField>
      </div>
    </Modal>
  )
}

/** Staff & HR › Staff: everyone on the staff, with or without a login. */
export default function Employees() {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('CURRENT')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const q = useDebouncedValue(search.trim(), 250)
  const params = { search: q || undefined, status, category: category || undefined, page, pageSize: 50 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['employees', params], queryFn: () => fetchEmployees(params), placeholderData: keepPreviousData })
  const rows = data?.data ?? []
  const meta = data?.meta
  const counts = data?.counts ?? {}
  const refresh = () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['hrms-meta'] }) }
  const fromLogins = useMutation({ mutationFn: recordsFromLogins, onSuccess: (r) => { refresh(); showSuccess(t('hrms.employees.fromLoginsDone', { count: r.made })) }, onError: (e) => showError(e.message) })
  const STATUS = ['CURRENT', 'ACTIVE', 'NOTICE', 'EXITED', 'ALL']
  const statusName = (s) => (s === 'CURRENT' || s === 'ALL' ? t(`hrms.employees.filter.${s}`) : L.status(s))

  return (
    <PageContainer>
      <PageHeader icon={UsersRound} title={t('hrms.employees.title')} subtitle={meta ? t('hrms.employees.count', { count: meta.total }) : t('hrms.employees.subtitle')}
        actions={<>
          {hasPermission('hrms.employees.create') && <HeaderButton icon={Users} onClick={async () => { if (await confirm({ title: t('hrms.employees.fromLogins'), message: t('hrms.employees.fromLoginsHint'), confirmLabel: t('hrms.employees.fromLoginsGo') })) fromLogins.mutate() }}>{t('hrms.employees.fromLogins')}</HeaderButton>}
          {hasPermission('hrms.employees.import') && <ImportExportButtons resourceLabel={t('hrms.employees.resource')} requires="hrms.employees.import"
            onImport={async (file) => importEmployees(await readSheet(file), true)} onCommit={(r) => importEmployees(r, false)}
            templateHeaders={['employeeCode', 'name', 'designation', 'category', 'employmentType', 'joiningDate', 'gender', 'dob', 'mobile', 'email']}
            templateSample={['', 'Meena Iyer', 'TGT English', 'TEACHING', 'PERMANENT', '2024-06-01', 'FEMALE', '1990-02-14', '9845012345', 'meena@example.com']}
            onDone={refresh} />}
          {hasPermission('hrms.employees.export') && <HeaderButton icon={Download} onClick={() => exportEmployees({ status, category: category || undefined, search: q || undefined }).catch((e) => showError(e.message))}>{t('hrms.employees.export')}</HeaderButton>}
          <HeaderButton icon={UserPlus} variant="primary" requires="hrms.employees.create" onClick={() => setAdding(true)}>{t('hrms.employees.new')}</HeaderButton>
        </>} />
      {Object.keys(counts).length > 0 && (
        <StatCardRow className="mb-4" items={EMPLOYEE_CATEGORIES.filter((c) => counts[c.value]).map((c) => ({ label: L.category(c.value), value: counts[c.value] }))} />
      )}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        toolbar={<Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1) }} searchPlaceholder={t('hrms.employees.search')}
          right={<>
            <ControlChip label={t('hrms.employees.category')} value={category ? L.category(category) : t('hrms.all')} active={!!category}
              options={[t('hrms.all'), ...EMPLOYEE_CATEGORIES.map((c) => L.category(c.value))]} onChange={(v) => { setCategory(EMPLOYEE_CATEGORIES.find((c) => L.category(c.value) === v)?.value ?? ''); setPage(1) }} />
            <ControlChip label={t('hrms.employees.status')} value={statusName(status)} active={status !== 'CURRENT'}
              options={STATUS.map(statusName)} onChange={(v) => { setStatus(STATUS.find((s) => statusName(s) === v) ?? 'CURRENT'); setPage(1) }} />
          </>} />}
        columns={[
          { key: 'name', header: t('hrms.employees.person'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.employeeCode}</p></div> },
          { key: 'designation', header: t('hrms.employees.designation'), render: (v, r) => <div><p className="text-sm text-ink">{v ?? '—'}</p><p className="text-xs text-ink-faint">{[L.category(r.category), r.department].filter(Boolean).join(' · ')}</p></div> },
          { key: 'employmentType', header: t('hrms.employees.employmentType'), mobileHidden: true, render: (v) => L.employment(v) },
          { key: 'mobile', header: t('hrms.employees.mobile'), mobileHidden: true, render: (v) => (v ? <span className="font-mono-num text-sm">{v}</span> : '—') },
          { key: 'joiningDate', header: t('hrms.employees.joined'), mobileHidden: true, nowrap: true, render: (v) => date(v) },
          { key: 'hasLogin', header: t('hrms.employees.loginCol'), mobileHidden: true, render: (v) => (v ? <StatusPill tone="success">{t('hrms.employees.hasLogin')}</StatusPill> : <span className="text-xs text-ink-faint">{t('hrms.employees.noLogin')}</span>) },
          { key: 'status', header: t('hrms.employees.status'), render: (v, r) => <span><StatusPill tone={EMPLOYEE_STATUSES[v]?.tone}>{L.status(v)}</StatusPill>{r.lastWorkingDate && v !== 'ACTIVE' && <span className="block text-[11px] text-ink-faint mt-0.5">{t('hrms.employees.lastDay', { date: date(r.lastWorkingDate) })}</span>}</span> },
        ]}
        onRowClick={(r) => navigate(`/hrms/employees/${r.id}`)}
        pagination={meta && meta.totalPages > 1 && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={UsersRound}
        emptyTitle={q || category || status !== 'CURRENT' ? t('hrms.employees.noMatch') : t('hrms.employees.emptyTitle')}
        emptyHint={q || category ? undefined : t('hrms.employees.emptyHint')}
      />
      {adding && <EmployeeForm onClose={() => setAdding(false)} onSaved={(e) => { setAdding(false); refresh(); showSuccess(t('hrms.employees.saved')); navigate(`/hrms/employees/${e.id}`) }} />}
    </PageContainer>
  )
}
