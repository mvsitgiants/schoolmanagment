import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { Building2, MapPin, Pencil, Plus, Star } from 'lucide-react'
import { CodeBadge, ColorChip, DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, StatusPill, TONE, hueTone } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch, UsageMeter } from '../../components/app/Controls'
import { createBranch, fetchBranches, updateBranch } from '../../api/core'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useSnackbar } from '../../context/SnackbarContext'

function BranchForm({ branch, onClose, onSaved }) {
  const { t } = useTranslation('admin')
  const [form, setForm] = useState(() => ({ name: '', code: '', addressLine: '', city: '', state: '', pincode: '', phone: '', gstin: '', active: true, ...branch }))
  const [errors, setErrors] = useState({})
  const { showError } = useSnackbar()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const save = useMutation({
    mutationFn: () => {
      const { name, code, addressLine, city, state, pincode, phone, gstin, active } = form
      const body = { name, code, addressLine, city, state, pincode, phone, gstin }
      return branch ? updateBranch(branch.id, { ...body, active }) : createBranch(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={branch ? t('admin.branches.editTitle', { name: branch.name }) : t('admin.branches.newBranch')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>{branch ? t('actions.save') : t('admin.branches.addBranch')}</Button>
    </>}>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><FormField label={t('admin.branches.branchName')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('admin.branches.namePlaceholder')} /></FormField></div>
        <FormField label={t('admin.branches.code')} required error={errors.code} hint={t('admin.branches.codeHint')}><Input value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} maxLength={12} placeholder="WFD" /></FormField>
      </div>
      <div className="mt-4"><FormField label={t('admin.branches.address')}><Input value={form.addressLine ?? ''} onChange={set('addressLine')} /></FormField></div>
      <div className="grid grid-cols-3 gap-4 mt-4">
        <FormField label={t('admin.branches.city')}><Input value={form.city ?? ''} onChange={set('city')} /></FormField>
        <FormField label={t('admin.branches.state')}><Input value={form.state ?? ''} onChange={set('state')} /></FormField>
        <FormField label={t('admin.branches.pincode')}><Input value={form.pincode ?? ''} onChange={set('pincode')} /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <FormField label={t('admin.branches.phone')}><Input value={form.phone ?? ''} onChange={set('phone')} /></FormField>
        <FormField label="GSTIN" error={errors.gstin} hint={t('admin.branches.gstinHint')}><Input value={form.gstin ?? ''} onChange={(e) => set('gstin')(e.target.value.toUpperCase())} maxLength={15} /></FormField>
      </div>
      {branch && !branch.isDefault && <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('status.active')} <Switch checked={form.active} onChange={set('active')} label={t('status.active')} /></label>}
    </Modal>
  )
}

export default function Branches() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const me = useAuthUser()
  const { showSuccess } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches })
  const [editing, setEditing] = useState(null)
  const limit = me?.subscription?.limits?.branches
  const active = rows.filter((b) => b.active).length
  const full = limit != null && active >= limit

  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('admin.branches.title')} subtitle={t('admin.branches.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" disabled={full} onClick={() => setEditing('new')}>{t('admin.branches.newBranch')}</HeaderButton>} />
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <DataTable
            rows={rows}
            loading={isLoading}
            onRowClick={hasPermission('core.branches.edit') ? setEditing : undefined}
            columns={[
              { key: 'name', header: t('admin.branches.branch'), mobilePrimary: true, render: (v, r) => { const tn = TONE[r.isDefault ? 'warning' : hueTone(r.code ?? v)]; return (
                <div className="flex items-center gap-3">
                  <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${tn.bg} ${tn.text} ${tn.border}`}><Building2 className="w-4 h-4" /></span>
                  <div className="min-w-0"><p className="font-medium text-ink flex items-center gap-1.5">{v}{r.isDefault && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" aria-label={t('admin.branches.mainBranch')} />}</p><CodeBadge>{r.code}</CodeBadge></div>
                </div>
              ) } },
              { key: 'city', header: t('admin.branches.location'), render: (v, r) => (v || r.addressLine ? <ColorChip label={[r.city, r.state].filter(Boolean).join(', ') || r.addressLine} seed={r.state || r.city} icon={MapPin} /> : <span className="text-ink-faint">—</span>) },
              { key: 'userCount', header: t('admin.branches.staff'), align: 'right', render: (v) => <span className={`tabular-nums ${v ? 'font-semibold text-ink' : 'text-ink-faint'}`}>{v ?? 0}</span> },
              { key: 'active', header: t('common.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('status.active') : t('admin.branches.inactive')}</StatusPill> },
              { key: 'id', header: '', align: 'right', width: 60, render: (_, r) => hasPermission('core.branches.edit') && <button onClick={(e) => { e.stopPropagation(); setEditing(r) }} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg" title={t('actions.edit')}><Pencil className="w-4 h-4" /></button> },
            ]}
          />
        </div>
        <div className="rounded-xl border border-border bg-surface shadow-card p-5 space-y-4">
          <UsageMeter label={t('admin.branches.onYourPlan')} used={active} limit={limit} />
          {full ? (
            <Note tone="warning"><Trans t={t} i18nKey="admin.branches.planFull" values={{ plan: me?.subscription?.plan?.name ?? '' }} components={{ link: <Link to="/core/subscription" className="font-medium underline" /> }} /></Note>
          ) : (
            <p className="text-xs text-ink-muted">{t('admin.branches.sharedNote')}</p>
          )}
        </div>
      </div>
      {editing && <BranchForm branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['branches'] }); showSuccess(t('admin.branches.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
