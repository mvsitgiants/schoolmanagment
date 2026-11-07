import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Columns3, Copy, Layers, Lock, Pencil, Plus, Shield, ShieldCheck, Sparkles, Trash2, Users } from 'lucide-react'
import { DataTable, FormField, Modal, Note, PageContainer, PageHeader, HeaderButton, Select, StatCardRow } from '../../components/system'
import Button from '../../components/ui/Button'
import { cloneRole, deleteRole, fetchRoles } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { iconFor } from '../../catalog/icons'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

function DeleteRoleModal({ role, roles, onClose, onDeleted }) {
  const { t } = useTranslation('admin')
  const [target, setTarget] = useState('')
  const { showError } = useSnackbar()
  const del = useMutation({
    mutationFn: () => deleteRole(role.id, role.userCount ? target : undefined),
    onSuccess: onDeleted,
    onError: (e) => showError(e.message),
  })
  const others = roles.filter((r) => r.id !== role.id)
  return (
    <Modal open onClose={onClose} title={t('admin.roles.delete.title', { name: role.name })} size="sm" footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button variant="danger" icon={Trash2} loading={del.isPending} disabled={role.userCount > 0 && !target} onClick={() => del.mutate()}>{t('admin.roles.delete.confirm')}</Button>
    </>}>
      {role.userCount > 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted"><Trans t={t} i18nKey="admin.roles.delete.members" count={role.userCount} values={{ count: role.userCount }} components={{ b: <span className="font-medium text-ink" /> }} /></p>
          <FormField label={t('admin.roles.delete.moveTo')} required>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('admin.roles.delete.chooseRole')}</option>
              {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </FormField>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">{t('admin.roles.delete.noMembers')}</p>
      )}
    </Modal>
  )
}

export default function Roles() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: fetchRoles })
  const [deleting, setDeleting] = useState(null)

  const clone = useMutation({
    mutationFn: cloneRole,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['roles'] }); showSuccess(t('admin.roles.toast.cloned', { name: r.name })); navigate(`/core/roles/${r.id}`) },
    onError: (e) => showError(e.message),
  })

  const custom = roles.filter((r) => !r.system)
  const users = roles.reduce((n, r) => n + r.userCount, 0)
  const flagged = custom.filter((r) => r.sensitiveCount > 0 || r.sodCount > 0).length
  const onlyAdmin = !isLoading && custom.length === 0

  const columns = [
    {
      key: 'name', header: t('admin.roles.cols.role'), mobilePrimary: true, render: (v, r) => {
        const Icon = r.system ? ShieldCheck : iconFor(r.icon || 'Shield')
        return (
          <div className="flex items-start gap-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${r.system ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-600'}`}><Icon className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className="font-medium text-ink flex items-center gap-1.5">{v}{r.locked && <Lock className="w-3 h-3 text-ink-faint" aria-label={t('admin.roles.builtIn')} />}</p>
              {r.description && <p className="text-xs text-ink-muted line-clamp-1">{r.description}</p>}
            </div>
          </div>
        )
      },
    },
    { key: 'userCount', header: t('admin.roles.cols.users'), align: 'right', width: 80, sortable: true },
    {
      key: 'access', header: t('admin.roles.cols.access'), width: 210, sortAccessor: (r) => (r.fullAccess ? 1e9 : r.permissionCount), sortable: true, render: (_, r) => (r.fullAccess ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-amber-50 text-amber-600"><ShieldCheck className="w-3.5 h-3.5" />{t('admin.roles.fullAccess')}</span>
      ) : (
        <div>
          <p className="text-sm text-ink tabular-nums">{t('admin.roles.modules', { count: r.moduleCount })} <span className="text-ink-faint">· {t('admin.roles.permissions', { count: r.permissionCount })}</span></p>
        </div>
      )),
    },
    { key: 'scope', header: t('admin.roles.cols.seesRecords'), mobileHidden: true, render: (_, r) => { const sc = r.fullAccess ? 'ALL' : r.dataScopes?.default; return <span className="text-sm text-ink-muted">{sc ? cl.scope(sc) : '—'}</span> } },
    {
      key: 'flags', header: t('admin.roles.cols.flags'), mobileHidden: true, render: (_, r) => (
        <div className="flex flex-wrap gap-1">
          {r.sensitiveCount > 0 && <span title={t('admin.roles.sensitiveActions')} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600"><AlertTriangle className="w-3 h-3" />{t('admin.roles.sensitiveCount', { count: r.sensitiveCount })}</span>}
          {r.sodCount > 0 && <span title={t('admin.roles.sameBothSteps')} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-info-50 text-info-600"><Layers className="w-3 h-3" />{t('admin.roles.dutyOverlap', { count: r.sodCount })}</span>}
          {!r.sensitiveCount && !r.sodCount && <span className="text-xs text-ink-faint">—</span>}
        </div>
      ),
    },
    {
      key: 'actions', header: '', align: 'right', width: 120, render: (_, r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button title={t('admin.roles.open')} onClick={() => navigate(`/core/roles/${r.id}`)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><Pencil className="w-4 h-4" /></button>
          {hasPermission('core.roles.create') && !r.system && <button title={t('admin.roles.duplicate')} onClick={() => clone.mutate(r.id)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"><Copy className="w-4 h-4" /></button>}
          {hasPermission('core.roles.delete') && !r.locked && <button title={t('actions.delete')} onClick={() => setDeleting(r)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-danger-50 hover:text-danger-600"><Trash2 className="w-4 h-4" /></button>}
        </div>
      ),
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        icon={Shield}
        title={t('admin.roles.title')}
        subtitle={t('admin.roles.subtitle')}
        actions={<>
          {roles.length > 1 && <HeaderButton icon={Columns3} onClick={() => navigate('/core/roles/compare')}>{t('admin.roles.compare')}</HeaderButton>}
          <HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => navigate('/core/roles/new')}>{t('admin.roles.newRole')}</HeaderButton>
        </>}
      />

      <StatCardRow items={[
        { icon: Shield, label: t('admin.roles.stats.roles'), value: isLoading ? '—' : roles.length, sub: t('admin.roles.stats.designed', { count: custom.length }), tone: 'brand' },
        { icon: Users, label: t('admin.roles.stats.usersWithRole'), value: isLoading ? '—' : users, sub: t('admin.roles.stats.holdSeveral'), tone: 'info' },
        { icon: AlertTriangle, label: t('admin.roles.stats.toReview'), value: isLoading ? '—' : flagged, sub: t('admin.roles.stats.toReviewSub'), tone: flagged ? 'warning' : 'neutral' },
      ]} />

      {onlyAdmin && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5 flex flex-col md:flex-row md:items-center gap-4">
          <span className="w-11 h-11 rounded-xl bg-brand-500 text-white flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
          <div className="flex-1">
            <p className="font-display font-semibold text-ink">{t('admin.roles.onlyAdmin.title')}</p>
            <p className="text-sm text-ink-muted mt-0.5">{t('admin.roles.onlyAdmin.body')}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button to="/core/setup#roles" icon={Sparkles}>{t('admin.roles.onlyAdmin.pickRecommended')}</Button>
            <Button to="/core/roles/new" variant="secondary" icon={Plus}>{t('admin.roles.onlyAdmin.blank')}</Button>
          </div>
        </div>
      )}

      <DataTable
        rows={roles}
        loading={isLoading}
        columns={columns}
        onRowClick={(r) => navigate(`/core/roles/${r.id}`)}
        emptyIcon={Shield}
        emptyTitle={t('admin.roles.empty')}
      />

      <Note>{t('admin.roles.note')}</Note>

      {deleting && (
        <DeleteRoleModal role={deleting} roles={roles} onClose={() => setDeleting(null)} onDeleted={() => {
          qc.invalidateQueries({ queryKey: ['roles'] })
          showSuccess(t('admin.roles.toast.deleted', { name: deleting.name }))
          setDeleting(null)
        }} />
      )}
    </PageContainer>
  )
}
