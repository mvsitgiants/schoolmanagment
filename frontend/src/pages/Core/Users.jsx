import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EMPLOYEE_CATEGORIES, EMPLOYMENT_TYPES, MODALITIES } from '@schoolgiant/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { KeyRound, LogOut, Mail, Pencil, Shield, ShieldCheck, UserCheck, UserPlus, UserX, Users as UsersIcon } from 'lucide-react'
import { ImportExportButtons,
  Avatar, ControlChip, DataTable, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, RecordDrawer,
  Select, StatCardRow, StatusPill, Toolbar, VerifiedBadge, ViewControls, localIso, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch, TempPasswordModal } from '../../components/app/Controls'
import {
  createUser, fetchBranches, fetchDepartments, fetchRoles, fetchUsers, resendUserInvite, resetUserPassword, revokeUserSessions, setUserActive, updateUser,
} from '../../api/core'
import { getCurrentUser, hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { importUsers } from '../../api/core'
import { readSheet } from '../../utils/readSheet'
import { downloadCsv } from '../../utils/csv'

const BLANK = { name: '', email: '', mobile: '', designation: '', roleIds: [], departmentIds: [], branchId: '', password: '', passwordMode: 'temp', radiologyModalities: [] }
// the platform can email (Superadmin › Settings): a new user is invited by email by default
const canInvite = () => !!getCurrentUser()?.features?.email
// radiologists' modalities live here only while HR is off (else on the employee record)
const modalitiesHere = () => { const on = getCurrentUser()?.enabledModules ?? []; return on.includes('radiology') && !on.includes('hrms') }

function CheckList({ items, value, onChange, render, empty }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  if (!items.length) return <p className="text-sm text-ink-faint">{empty}</p>
  return (
    <div className="max-h-52 overflow-y-auto scroll-thin rounded-lg border border-border divide-y divide-border">
      {items.map((it) => (
        <label key={it.id} className={clsx('flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-bg/60', value.includes(it.id) && 'bg-brand-50/50')}>
          <input type="checkbox" checked={value.includes(it.id)} onChange={() => toggle(it.id)} className="mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500" />
          {render(it)}
        </label>
      ))}
    </div>
  )
}

function UserForm({ user, roles, departments, branches, onClose, onSaved }) {
  const { t } = useTranslation(['admin', 'hrms', 'common'])
  const cl = useCatalogLabel()
  const isNew = !user
  const [form, setForm] = useState(() => (user ? { ...BLANK, ...user, roleIds: user.roles.map((r) => r.id), departmentIds: user.departments.map((d) => d.id), branchId: user.branchId || '', mobile: user.mobile || '', designation: user.designation || '', radiologyModalities: user.radiologyModalities ?? [] } : { ...BLANK, passwordMode: canInvite() ? 'invite' : 'temp' }))
  const [errors, setErrors] = useState({})
  const { showError } = useSnackbar()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  // "Also add to staff": a new login can get its Staff & HR record in the same save
  const canAddStaff = isNew && !!getCurrentUser()?.enabledModules?.includes('hrms') && hasPermission('hrms.employees.create')
  const today = localIso(new Date())
  const [staff, setStaff] = useState({ on: false, category: '', employmentType: 'PERMANENT', joiningDate: today })
  const addingStaff = canAddStaff && staff.on

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, email: form.email, mobile: form.mobile, designation: form.designation, roleIds: form.roleIds, departmentIds: form.departmentIds, branchId: form.branchId || null }
      if (modalitiesHere()) body.radiologyModalities = form.radiologyModalities
      if (isNew && form.passwordMode === 'set') body.password = form.password
      if (isNew && form.passwordMode === 'invite') body.invite = true
      if (addingStaff) body.staff = { category: staff.category, employmentType: staff.employmentType, joiningDate: staff.joiningDate }
      return isNew ? createUser(body) : updateUser(user.id, body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? t('admin.users.form.addTitle') : t('admin.users.form.editTitle', { name: user.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.email || !form.roleIds.length || (addingStaff && (!staff.category || !staff.employmentType || !staff.joiningDate))} onClick={() => save.mutate()}>{isNew ? t('admin.users.addUser') : t('admin.users.form.saveChanges')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('admin.users.form.fullName')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('admin.users.form.fullNamePlaceholder')} /></FormField>
        <FormField label={t('admin.users.form.designation')} error={errors.designation}><Input value={form.designation} onChange={set('designation')} placeholder={t('admin.users.form.designationPlaceholder')} /></FormField>
        <FormField label={t('admin.users.form.email')} required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></FormField>
        <FormField label={t('admin.users.form.mobile')} error={errors.mobile}><Input value={form.mobile} onChange={set('mobile')} placeholder="+91" /></FormField>
      </div>

      <div className="mt-5">
        <FormField label={t('admin.users.form.roles')} required error={errors.roleIds} hint={t('admin.users.form.rolesHint')}>
          <CheckList items={roles} value={form.roleIds} onChange={set('roleIds')} empty={t('admin.users.form.noRoles')}
            render={(r) => (
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">{r.fullAccess ? <ShieldCheck className="w-3.5 h-3.5 text-amber-600" /> : <Shield className="w-3.5 h-3.5 text-ink-faint" />}{r.name}{r.fullAccess && <span className="text-[10px] px-1.5 py-px rounded bg-amber-50 text-amber-600">{t('admin.users.form.fullAccess')}</span>}</span>
                {r.description && <span className="block text-xs text-ink-muted line-clamp-1">{r.description}</span>}
              </span>
            )} />
        </FormField>
      </div>

      <div className="mt-5 grid sm:grid-cols-2 gap-4">
        <FormField label={t('admin.users.form.departments')} hint={t('admin.users.form.departmentsHint', { scope: cl.scope('DEPARTMENT') })}>
          <CheckList items={departments} value={form.departmentIds} onChange={set('departmentIds')} empty={t('admin.users.form.noDepartments')}
            render={(d) => <span className="text-sm text-ink">{d.name}</span>} />
        </FormField>
        <div className="space-y-4">
          {modalitiesHere() && (
            <FormField label={t('admin.users.form.imaging')} hint={t('admin.users.form.imagingHint')}>
              <div className="flex flex-wrap gap-1.5">
                {MODALITIES.map((m) => {
                  const on = form.radiologyModalities.includes(m.value)
                  return <button key={m.value} type="button" aria-pressed={on} onClick={() => set('radiologyModalities')(on ? form.radiologyModalities.filter((x) => x !== m.value) : [...form.radiologyModalities, m.value])} className={clsx('px-2.5 py-1 rounded-full text-xs border', on ? 'bg-brand-500 border-brand-500 text-white' : 'border-border text-ink-muted hover:border-brand-300')}>{m.short}</button>
                })}
              </div>
            </FormField>
          )}
          {branches.length > 1 && (
            <FormField label={t('admin.users.form.branch')}>
              <Select value={form.branchId} onChange={set('branchId')}>
                <option value="">{t('admin.users.form.mainInstitution')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </FormField>
          )}
          {isNew && (
            <FormField label={t('admin.users.form.password')}>
              <div className="space-y-2">
                {canInvite() && <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" checked={form.passwordMode === 'invite'} onChange={() => set('passwordMode')('invite')} className="text-brand-500 focus:ring-brand-500" /> {t('admin.users.form.sendInvite')}</label>}
                <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" checked={form.passwordMode === 'temp'} onChange={() => set('passwordMode')('temp')} className="text-brand-500 focus:ring-brand-500" /> {t('admin.users.form.generateTemp')}</label>
                <label className="flex items-center gap-2 text-sm text-ink"><input type="radio" checked={form.passwordMode === 'set'} onChange={() => set('passwordMode')('set')} className="text-brand-500 focus:ring-brand-500" /> {t('admin.users.form.setNow')}</label>
                {form.passwordMode === 'set' && <Input type="password" value={form.password} onChange={set('password')} placeholder={t('admin.users.form.passwordPlaceholder')} />}
                {errors.password && <p className="text-xs text-danger-600">{errors.password}</p>}
              </div>
            </FormField>
          )}
          {canAddStaff && (
            <div className="rounded-lg border border-border p-3">
              <label className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{t('admin.users.form.alsoStaff')}</span>
                  <span className="block text-xs text-ink-muted">{t('admin.users.form.alsoStaffHint')}</span>
                </span>
                <Switch checked={staff.on} onChange={(on) => setStaff((x) => ({ ...x, on }))} label={t('admin.users.form.alsoStaff')} />
              </label>
              {staff.on && (
                <div className="mt-3 grid sm:grid-cols-3 gap-3">
                  <FormField label={t('hrms:hrms.employeeForm.staffCategory')} required error={errors['staff.category']}>
                    <Select value={staff.category} onChange={(e) => setStaff((x) => ({ ...x, category: e.target.value }))}>
                      <option value="">{t('common:common.pickOne')}</option>
                      {EMPLOYEE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(`hrms:hrms.enum.employeeCategories.${c.value}`, { defaultValue: c.label })}</option>)}
                    </Select>
                  </FormField>
                  <FormField label={t('hrms:hrms.employeeForm.employmentType')} required>
                    <Select value={staff.employmentType} onChange={(e) => setStaff((x) => ({ ...x, employmentType: e.target.value }))}>
                      {EMPLOYMENT_TYPES.map((c) => <option key={c.value} value={c.value}>{t(`hrms:hrms.enum.employmentTypes.${c.value}`, { defaultValue: c.label })}</option>)}
                    </Select>
                  </FormField>
                  <FormField label={t('hrms:hrms.employeeForm.joiningDate')} required>
                    <Input type="date" value={staff.joiningDate} onChange={(e) => setStaff((x) => ({ ...x, joiningDate: e.target.value }))} />
                  </FormField>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function Users() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const me = useAuthUser()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { dateTime, date } = useFormat()
  const [search, setSearch] = useState('')
  const [roleId, setRoleId] = useState('')
  const [status, setStatus] = useState('active')
  const [deptId, setDeptId] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null) // null | 'new' | user
  const [open, setOpen] = useState(null)
  const [temp, setTemp] = useState(null)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, roleId, status, deptId])

  const params = { search: q, roleId, status, departmentId: deptId, page, pageSize: 25 }
  const usersQ = useQuery({ queryKey: ['users', params], queryFn: () => fetchUsers(params), placeholderData: (prev) => prev })
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['roles'] }); qc.invalidateQueries({ queryKey: ['setup'] }) }
  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (res, { done }) => { refresh(); done?.(res) },
    onError: (e) => showError(e.message),
  })

  const rows = usersQ.data?.data ?? []
  const meta = usersQ.data?.meta
  const sub = me?.subscription
  const seatLimit = sub?.limits?.users
  const activeCount = meta?.counts?.active ?? sub?.usage?.users ?? 0
  const admins = useMemo(() => roles.filter((r) => r.fullAccess).reduce((n, r) => n + r.userCount, 0), [roles])
  const allLabel = t('admin.users.filters.all')
  const statusLabels = { active: t('admin.users.status.active'), inactive: t('admin.users.status.inactive'), '': allLabel }

  const columns = [
    { key: 'name', header: t('admin.users.cols.name'), mobilePrimary: true, render: (v, r) => (
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={v} size={32} />
        <div className="min-w-0"><p className="font-medium text-ink truncate">{v}{r.emailVerified && <VerifiedBadge size="xs" className="ms-1" title={t('admin.users.drawer.emailConfirmed')} />}{r.id === me?.user?.id && <span className="ms-1.5 text-[10px] text-ink-faint">{t('admin.users.you')}</span>}</p><p className="text-xs text-ink-faint truncate">{r.email}</p></div>
      </div>
    ) },
    { key: 'roles', header: t('admin.users.cols.roles'), render: (v) => (
      <div className="flex flex-wrap gap-1">{v.map((r) => <span key={r.id} className={clsx('text-[11px] px-1.5 py-0.5 rounded', r.fullAccess ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-700')}>{r.name}</span>)}</div>
    ) },
    { key: 'designation', header: t('admin.users.cols.designation'), mobileHidden: true, render: (v, r) => <div><p className="text-sm text-ink">{v || '—'}</p>{r.departments.length > 0 && <p className="text-xs text-ink-faint">{r.departments.map((d) => d.name).join(', ')}</p>}</div> },
    { key: 'lastLoginAt', header: t('admin.users.cols.lastSignIn'), nowrap: true, mobileHidden: true, render: (v) => (v ? <span className="text-sm text-ink-muted">{dateTime(v)}</span> : <span className="text-xs text-ink-faint">{t('admin.users.never')}</span>) },
    { key: 'active', header: t('admin.users.cols.status'), render: (v, r) => <StatusPill tone={v ? (r.mustChangePassword || r.invited ? 'warning' : 'success') : 'neutral'}>{v ? (r.mustChangePassword || r.invited ? t('admin.users.status.invited') : t('admin.users.status.active')) : t('admin.users.status.inactive')}</StatusPill> },
  ]

  const toggleActive = async (u) => {
    if (u.active) {
      const ok = await confirm({ title: t('admin.users.confirm.deactivateTitle', { name: u.name }), message: t('admin.users.confirm.deactivateMessage'), tone: 'danger', confirmLabel: t('admin.users.deactivate') })
      if (!ok) return
    }
    act.mutate({ fn: () => setUserActive(u.id, !u.active), done: (res) => { setOpen(res); showSuccess(u.active ? t('admin.users.toast.deactivated', { name: u.name }) : t('admin.users.toast.reactivated', { name: u.name })) } })
  }
  const reset = async (u) => {
    const ok = await confirm({ title: t('admin.users.confirm.resetTitle', { name: u.name }), message: t('admin.users.confirm.resetMessage'), confirmLabel: t('admin.users.resetPassword') })
    if (ok) act.mutate({ fn: () => resetUserPassword(u.id), done: (res) => setTemp({ name: u.name, email: u.email, password: res.tempPassword }) })
  }

  return (
    <PageContainer>
      <PageHeader icon={UsersIcon} title={t('admin.users.title')} subtitle={t('admin.users.subtitle')}
        actions={<>
          {/* each new user gets a temporary password; the file of them downloads once, right after the import */}
          {hasPermission('core.users.import') && <ImportExportButtons resourceLabel={t('ui:ui.importExport.resources.users')} requires="core.users.import"
            onImport={async (file) => importUsers(await readSheet(file), true)}
            onCommit={async (rows) => {
              const res = await importUsers(rows, false)
              if (res.credentials?.length) {
                downloadCsv(`new-users-${new Date().toISOString().slice(0, 10)}.csv`, [['name', 'email', 'temporaryPassword'], ...res.credentials.map((c) => [c.name, c.email, c.tempPassword])])
                showSuccess(t('ui:ui.importExport.credentialsDownloaded', { hours: res.validHours }))
              }
              return res
            }}
            templateHeaders={['name', 'email', 'mobile', 'designation', 'roles', 'departments', 'branch']}
            templateSample={['Dr. Neha Sinha', 'neha.sinha@cityhospital.in', '9876501234', 'Consultant physician', 'Consultant', 'GEN-MED', '']}
            onDone={refresh} />}
          {<HeaderButton icon={UserPlus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('admin.users.addUser')}</HeaderButton>}
        </>} />

      <StatCardRow items={[
        { icon: UserCheck, label: t('admin.users.stats.activeUsers'), value: activeCount, sub: seatLimit != null ? t('admin.users.stats.seatsLeft', { left: Math.max(0, seatLimit - activeCount), limit: seatLimit }) : t('admin.users.stats.unlimited'), tone: seatLimit != null && activeCount >= seatLimit ? 'danger' : 'brand', onClick: () => setStatus('active') },
        { icon: UserX, label: t('admin.users.status.inactive'), value: meta?.counts?.inactive ?? '—', sub: t('admin.users.stats.keptForHistory'), tone: 'neutral', onClick: () => setStatus('inactive') },
        { icon: ShieldCheck, label: t('admin.users.stats.fullAccessAdmins'), value: admins, sub: t('admin.users.stats.alwaysOne'), tone: 'warning' },
        { icon: Shield, label: t('admin.users.cols.roles'), value: roles.length, sub: t('admin.users.stats.severalPerUser'), tone: 'info' },
      ]} />

      <DataTable
        rows={rows}
        loading={usersQ.isLoading}
        columns={columns}
        onRowClick={setOpen}
        toolbar={(
          <Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('admin.users.searchPlaceholder')}
            right={(
              <ViewControls>
                <ControlChip label={t('admin.users.filters.status')} value={statusLabels[status]} active={status !== 'active'} options={Object.values(statusLabels)} onChange={(v) => setStatus(Object.keys(statusLabels).find((k) => statusLabels[k] === v) ?? 'active')} />
                <ControlChip label={t('admin.users.filters.role')} value={roles.find((r) => r.id === roleId)?.name ?? allLabel} active={!!roleId} options={[allLabel, ...roles.map((r) => r.name)]} onChange={(v) => setRoleId(roles.find((r) => r.name === v)?.id ?? '')} />
                <ControlChip label={t('admin.users.filters.department')} value={departments.find((d) => d.id === deptId)?.name ?? allLabel} active={!!deptId} options={[allLabel, ...departments.map((d) => d.name)]} onChange={(v) => setDeptId(departments.find((d) => d.name === v)?.id ?? '')} />
              </ViewControls>
            )} />
        )}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={UsersIcon}
        emptyTitle={q ? t('admin.users.empty.noMatch') : t('admin.users.empty.none')}
        emptyHint={q ? t('admin.users.empty.tryDifferent') : undefined}
      />

      {open && (
        <RecordDrawer
          open
          onClose={() => setOpen(null)}
          subtitle={t('admin.users.drawer.subtitle')}
          title={open.name}
          status={open.active ? t('admin.users.status.active') : t('admin.users.status.inactive')}
          statusTone={open.active ? 'success' : 'neutral'}
          fields={[
            { label: t('admin.users.drawer.email'), value: `${open.email} · ${open.emailVerified ? t('admin.users.drawer.emailConfirmed') : t('admin.users.drawer.emailNotConfirmed')}` },
            { label: t('admin.users.form.mobile'), value: open.mobile },
            { label: t('admin.users.cols.designation'), value: open.designation },
            { label: t('admin.users.form.branch'), value: open.branchName },
            { label: t('admin.users.cols.roles'), value: open.roles.map((r) => r.name).join(', '), full: true },
            { label: t('admin.users.form.departments'), value: open.departments.map((d) => d.name).join(', '), full: true },
            { label: t('admin.users.cols.lastSignIn'), value: open.lastLoginAt ? dateTime(open.lastLoginAt) : t('admin.users.never') },
            { label: t('admin.users.drawer.added'), value: date(open.createdAt) },
          ]}
          history={{ entityId: open.id }}
          footer={(
            <div className="flex flex-wrap gap-2 w-full">
              {hasPermission('core.users.edit') && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(open)}>{t('actions.edit')}</Button>}
              {hasPermission('core.users.reset_password') && <Button variant="secondary" icon={KeyRound} onClick={() => reset(open)}>{t('admin.users.resetPassword')}</Button>}
              {open.invited && open.active && canInvite() && hasPermission('core.users.create') && <Button variant="secondary" icon={Mail} onClick={() => act.mutate({ fn: () => resendUserInvite(open.id), done: (r) => { setOpen(r.user); showSuccess(t('admin.users.toast.inviteSent', { email: r.user.email })) } })}>{t('admin.users.resendInvite')}</Button>}
              {hasPermission('core.users.revoke_sessions') && <Button variant="ghost" icon={LogOut} onClick={() => act.mutate({ fn: () => revokeUserSessions(open.id), done: (r) => showSuccess(t('admin.users.toast.signedOut', { count: r.signedOut })) })}>{t('admin.users.signOutDevices')}</Button>}
              {hasPermission('core.users.edit') && open.id !== me?.user?.id && (
                <Button variant={open.active ? 'danger' : 'primary'} className="ms-auto" icon={open.active ? UserX : UserCheck} onClick={() => toggleActive(open)}>{open.active ? t('admin.users.deactivate') : t('admin.users.reactivate')}</Button>
              )}
            </div>
          )}
        />
      )}

      {editing && (
        <UserForm user={editing === 'new' ? null : editing} roles={roles} departments={departments.filter((d) => d.active)} branches={branches.filter((b) => b.active)}
          onClose={() => setEditing(null)}
          onSaved={(res) => {
            refresh()
            const isNew = editing === 'new'
            setEditing(null)
            if (isNew) {
              showSuccess(res.user.invited ? t('admin.users.toast.invited', { name: res.user.name, email: res.user.email }) : t('admin.users.toast.added', { name: res.user.name }))
              if (res.tempPassword) setTemp({ name: res.user.name, email: res.user.email, password: res.tempPassword })
            } else {
              showSuccess(t('admin.users.toast.saved'))
              setOpen(res)
            }
          }} />
      )}
      <TempPasswordModal open={!!temp} onClose={() => setTemp(null)} {...(temp ?? {})} />
    </PageContainer>
  )
}
