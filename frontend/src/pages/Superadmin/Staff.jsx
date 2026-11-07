import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, UserCog } from 'lucide-react'
import { PLATFORM_ROLES } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Modal, PageContainer, PageHeader, Select, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { createStaff, fetchStaff, resetStaffPassword, updateStaff } from '../../api/superadmin'
import { getCurrentUser } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const roleLabel = (t, r) => t(`superadmin.staff.roles.${r}`, { defaultValue: PLATFORM_ROLES.find((x) => x.value === r)?.label ?? r })

/** Shown once: the temporary password a new or reset staff member signs in with. */
function TempPassword({ value, onClose }) {
  const { t } = useTranslation('superadmin')
  return (
    <Modal open={!!value} onClose={onClose} size="sm" title={t('superadmin.staff.tempTitle')} footer={<Button onClick={onClose}>{t('superadmin.staff.done')}</Button>}>
      <p className="text-sm text-ink-muted">{t('superadmin.staff.tempIntro', { email: value?.email })}</p>
      <p className="mt-3 font-mono-num text-lg text-ink bg-bg border border-border rounded-lg px-3 py-2 select-all">{value?.password}</p>
    </Modal>
  )
}

function AddStaff({ onClose, onDone }) {
  const { t } = useTranslation('superadmin')
  const [form, setForm] = useState({ name: '', email: '', role: 'SUPPORT' })
  const [errors, setErrors] = useState({})
  const { showError } = useSnackbar()
  const save = useMutation({
    mutationFn: () => createStaff(form),
    onSuccess: onDone,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="sm" title={t('superadmin.staff.addTitle')} footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button loading={save.isPending} disabled={!form.name || !form.email} onClick={() => save.mutate()}>{t('superadmin.staff.add')}</Button></>}>
      <div className="space-y-4">
        <FormField label={t('common.name')} error={errors.name}><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></FormField>
        <FormField label={t('superadmin.staff.email')} error={errors.email} hint={t('superadmin.staff.emailHint')}><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></FormField>
        <FormField label={t('superadmin.staff.role')} hint={t(`superadmin.staff.roleHints.${form.role}`)}>
          <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {PLATFORM_ROLES.map((r) => <option key={r.value} value={r.value}>{roleLabel(t, r.value)}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  )
}

/** Platform console users and what each may change (Owner · Billing · Support · Read-only). */
export default function Staff() {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const me = getCurrentUser()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['sa-staff'], queryFn: fetchStaff })
  const [adding, setAdding] = useState(false)
  const [temp, setTemp] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['sa-staff'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (res, { done }) => { refresh(); done?.(res) }, onError: (e) => showError(e.message) })

  return (
    <PageContainer>
      <PageHeader icon={UserCog} title={t('superadmin.staff.title')} subtitle={t('superadmin.staff.subtitle')} actions={<Button icon={Plus} onClick={() => setAdding(true)}>{t('superadmin.staff.add')}</Button>} />
      <DataTable
        rows={rows}
        loading={isLoading}
        columns={[
          { key: 'name', header: t('common.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}{r.id === me?.user?.id && <span className="text-ink-faint font-normal"> · {t('superadmin.staff.you')}</span>}</p><p className="text-xs text-ink-muted">{r.email}</p></div> },
          { key: 'role', header: t('superadmin.staff.role'), render: (v, r) => (
            <Select value={v} disabled={r.id === me?.user?.id || act.isPending} onChange={(e) => act.mutate({ fn: () => updateStaff(r.id, { role: e.target.value }), done: () => showSuccess(t('superadmin.staff.saved')) })} aria-label={t('superadmin.staff.role')}>
              {PLATFORM_ROLES.map((x) => <option key={x.value} value={x.value}>{roleLabel(t, x.value)}</option>)}
            </Select>
          ) },
          { key: 'lastLoginAt', header: t('superadmin.staff.lastSignIn'), mobileHidden: true, render: (v) => (v ? dateTime(v) : t('superadmin.staff.never')) },
          { key: 'active', header: t('common.status'), render: (v, r) => <StatusPill tone={!v ? 'neutral' : r.mustChangePassword ? 'warning' : 'success'}>{!v ? t('superadmin.staff.inactive') : r.mustChangePassword ? t('superadmin.staff.tempPassword') : t('superadmin.staff.active')}</StatusPill> },
          { key: 'id', header: '', align: 'right', render: (_, r) => r.id !== me?.user?.id && (
            <div className="flex justify-end gap-1">
              {r.active && <Button size="sm" variant="ghost" icon={KeyRound} onClick={async () => { if (await confirm({ title: t('superadmin.staff.resetTitle', { name: r.name }), message: t('superadmin.staff.resetMsg'), confirmLabel: t('superadmin.staff.reset') })) act.mutate({ fn: () => resetStaffPassword(r.id), done: (res) => setTemp({ email: r.email, password: res.tempPassword }) }) }}>{t('superadmin.staff.reset')}</Button>}
              <Button size="sm" variant={r.active ? 'ghost' : 'secondary'} onClick={() => act.mutate({ fn: () => updateStaff(r.id, { active: !r.active }), done: () => showSuccess(t(r.active ? 'superadmin.staff.deactivated' : 'superadmin.staff.reactivated', { name: r.name })) })}>{t(r.active ? 'superadmin.staff.deactivate' : 'superadmin.staff.reactivate')}</Button>
            </div>
          ) },
        ]}
      />
      {adding && <AddStaff onClose={() => setAdding(false)} onDone={(res) => { setAdding(false); refresh(); setTemp({ email: res.staff.email, password: res.tempPassword }) }} />}
      <TempPassword value={temp} onClose={() => setTemp(null)} />
    </PageContainer>
  )
}
