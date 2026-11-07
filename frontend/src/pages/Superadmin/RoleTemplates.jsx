import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ShieldCheck } from 'lucide-react'
import { modulesTouched, normalizePermissions, sensitivePermissions } from '@schoolgiant/shared'
import { DataTable, Drawer, FormField, Input, Note, PageContainer, PageHeader, StatusPill, Textarea } from '../../components/system'
import { canPlatform } from '../../api/auth'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import PermissionMatrix from '../../components/roles/PermissionMatrix'
import { catalogFromShared } from '../../components/roles/catalogUtils'
import { fetchSaRoleTemplates, updateRoleTemplate } from '../../api/superadmin'
import { useSnackbar } from '../../context/SnackbarContext'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

function TemplateEditor({ template, onClose, onSaved }) {
  const { t } = useTranslation('superadmin')
  const catalog = useMemo(catalogFromShared, [])
  const [form, setForm] = useState(() => ({ name: template.name, description: template.description, active: template.active, permissions: new Set(template.permissions) }))
  const { showError } = useSnackbar()
  const save = useMutation({
    mutationFn: () => updateRoleTemplate(template.code, { name: form.name, description: form.description, active: form.active, permissions: normalizePermissions([...form.permissions]) }),
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  return (
    <Drawer open onClose={onClose} size="xl" subtitle={t('superadmin.roleTemplates.drawerSubtitle', { code: template.code })} title={template.name}
      footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button icon={Check} loading={save.isPending} onClick={() => save.mutate()}>{t('superadmin.roleTemplates.save')}</Button></>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><FormField label={t('common.name')}><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></FormField></div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 mt-6 h-10 text-sm text-ink">{t('superadmin.roleTemplates.offeredToInstitutions')} <Switch checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} label={t('superadmin.common.active')} /></label>
        </div>
        <FormField label={t('superadmin.roleTemplates.description')}><Textarea rows={2} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></FormField>
        <Note>{t('superadmin.roleTemplates.note')}</Note>
        <PermissionMatrix catalog={catalog} selected={form.permissions} onChange={(next) => setForm((f) => ({ ...f, permissions: next }))} />
      </div>
    </Drawer>
  )
}

export default function RoleTemplates() {
  const { t } = useTranslation('superadmin')
  const cl = useCatalogLabel()
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['sa-role-templates'], queryFn: fetchSaRoleTemplates })
  const [editing, setEditing] = useState(null)
  return (
    <PageContainer>
      <PageHeader icon={ShieldCheck} title={t('superadmin.roleTemplates.title')} subtitle={t('superadmin.roleTemplates.subtitle')} />
      <DataTable
        rows={rows}
        loading={isLoading}
        onRowClick={canPlatform('templates') ? setEditing : undefined}
        columns={[
          { key: 'name', header: t('superadmin.roleTemplates.template'), mobilePrimary: true, render: (v, r) => { const Icon = iconFor(r.icon); return <div className="flex items-start gap-3"><span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span><div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-muted line-clamp-1">{r.description}</p></div></div> } },
          { key: 'permissions', header: t('superadmin.roleTemplates.permissions'), align: 'right', render: (v) => v.length },
          { key: 'modules', header: t('superadmin.common.modules'), mobileHidden: true, render: (_, r) => { const m = modulesTouched(r.permissions); return <span className="text-xs text-ink-muted">{m.slice(0, 4).map((id) => cl.module(id)).join(', ')}{m.length > 4 ? ` +${m.length - 4}` : ''}</span> } },
          { key: 'sensitive', header: t('superadmin.roleTemplates.sensitive'), align: 'right', mobileHidden: true, render: (_, r) => { const n = sensitivePermissions(r.permissions).length; return n ? <span className="text-amber-600">{n}</span> : <span className="text-ink-faint">—</span> } },
          { key: 'active', header: t('common.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('superadmin.roleTemplates.offered') : t('superadmin.roleTemplates.hidden')}</StatusPill> },
        ]}
      />
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['sa-role-templates'] }); showSuccess(t('superadmin.roleTemplates.saved')) }} />}
    </PageContainer>
  )
}
