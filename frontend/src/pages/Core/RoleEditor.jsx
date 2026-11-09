import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, Check, Eye, Layers, Lock, Shield, ShieldCheck, Users as UsersIcon } from 'lucide-react'
import { describePermission, normalizePermissions, sensitivePermissions, sodWarnings, visiblePages } from '@schoolgiant/shared'
import {
  DataTable, DateCell, FormField, Input, Note, PageContainer, PageHeader, PersonCell, RecordHistory, Select, StatusPill, Tabs, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import PermissionMatrix from '../../components/roles/PermissionMatrix'
import SidebarPreview from '../../components/roles/SidebarPreview'
import ScopeLimits from '../../components/roles/ScopeLimits'
import { moduleKeys } from '../../components/roles/catalogUtils'
import { createRole, fetchCatalog, fetchRole, fetchRoleMembers, fetchRoleTemplates, updateRole } from '../../api/core'
import { hasPermission, isFullAccess } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useSnackbar } from '../../context/SnackbarContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const EMPTY = { name: '', description: '', homePage: '', fullAccess: false, permissions: [], dataScopes: { default: 'BRANCH' }, limits: {}, security: { idleMinutes: null, require2fa: false } }

const snapshot = (s) => JSON.stringify({ ...s, permissions: [...s.permissions].sort() })

export default function RoleEditor() {
  const { t } = useTranslation('admin')
  const { id } = useParams()
  const isNew = id === 'new'
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const me = useAuthUser()

  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog })
  const roleQ = useQuery({ queryKey: ['role', id], queryFn: () => fetchRole(id), enabled: !isNew })
  const templatesQ = useQuery({ queryKey: ['role-templates'], queryFn: fetchRoleTemplates, enabled: isNew })
  const membersQ = useQuery({ queryKey: ['role-members', id], queryFn: () => fetchRoleMembers(id), enabled: !isNew })

  const [form, setForm] = useState(null)
  const [initial, setInitial] = useState(null)
  const [tab, setTab] = useState('pages')
  const [template, setTemplate] = useState(params.get('template') || '')

  // Load the role (or an empty / template-based new role) into the form once.
  useEffect(() => {
    if (form) return
    if (isNew) {
      const tpl = templatesQ.data?.find((x) => x.code === template)
      if (template && !templatesQ.data) return
      const start = tpl ? { ...EMPTY, name: tpl.name, description: tpl.description, homePage: tpl.homePage || '', permissions: tpl.permissions, dataScopes: { ...EMPTY.dataScopes, ...tpl.dataScopes }, limits: tpl.limits ?? {} } : EMPTY
      setForm({ ...start, permissions: new Set(start.permissions) })
      setInitial(snapshot({ ...EMPTY, permissions: [] }))
    } else if (roleQ.data) {
      const r = roleQ.data
      const loaded = { name: r.name, description: r.description || '', homePage: r.homePage || '', fullAccess: r.fullAccess, permissions: r.fullAccess ? [] : r.permissions, dataScopes: r.dataScopes || {}, limits: r.limits || {}, security: { idleMinutes: null, require2fa: false, ...r.security } }
      setForm({ ...loaded, permissions: new Set(loaded.permissions) })
      setInitial(snapshot(loaded))
    }
  }, [isNew, roleQ.data, templatesQ.data, template, form])

  const pickTemplate = (code) => {
    setTemplate(code)
    const tpl = templatesQ.data?.find((x) => x.code === code)
    setForm((f) => (tpl
      ? { ...f, name: f.name || tpl.name, description: f.description || tpl.description, homePage: tpl.homePage || '', permissions: new Set(tpl.permissions), dataScopes: { ...EMPTY.dataScopes, ...tpl.dataScopes }, limits: tpl.limits ?? {} }
      : { ...f, permissions: new Set() }))
  }

  const role = roleQ.data
  const catalog = catalogQ.data
  const holdsRole = !isNew && me?.roles?.some((r) => r.id === id)
  const readOnly = !!role?.locked || (isNew ? !hasPermission('core.roles.create') : !hasPermission('core.roles.edit')) || (holdsRole && !isFullAccess())
  const canFull = isFullAccess()
  const canSave = !readOnly || (!!role?.locked && hasPermission('core.roles.edit'))

  const perms = useMemo(() => (form ? normalizePermissions([...form.permissions]) : []), [form])
  const dirty = form && initial && snapshot({ ...form, permissions: perms }) !== initial
  const sensitive = sensitivePermissions(perms)
  const sod = sodWarnings(perms)
  const totalKeys = catalog ? catalog.modules.filter((m) => m.enabled).reduce((n, m) => n + moduleKeys(m).length, 0) : 0
  const cl = useCatalogLabel()
  // describePermission() returns English names; rebuild them from the translated catalog
  const permAction = (k) => { const d = describePermission(k); return d.exists ? cl.action({ id: d.action, label: d.label }) : k }
  const permText = (k) => { const d = describePermission(k); return d.exists ? `${cl.module(d.module)} › ${cl.page(d.module, d.page)} › ${permAction(k)}` : k }
  const sodText = (w) => t(`admin.roleEditor.sod.${`${w.a}__${w.b}`.replace(/\./g, '_')}`, { defaultValue: w.message })
  const homeOptions = useMemo(() => (form ? visiblePages(form.fullAccess ? ['*'] : perms, me?.enabledModules).flatMap((g) => g.pages.map((p) => ({ path: p.path, label: `${cl.module(g.module)} › ${cl.page(g.module, p)}` }))) : []), [form, perms, me, cl])

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: form.name, description: form.description, homePage: form.homePage, fullAccess: form.fullAccess, permissions: form.fullAccess ? [] : perms, dataScopes: form.dataScopes, limits: form.limits, security: form.security }
      if (role?.locked) return updateRole(id, { description: form.description })
      return isNew ? createRole({ ...body, templateCode: template || undefined }) : updateRole(id, body)
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['setup'] })
      qc.setQueryData(['role', saved.id], saved)
      const loaded = { name: saved.name, description: saved.description || '', homePage: saved.homePage || '', fullAccess: saved.fullAccess, permissions: saved.fullAccess ? [] : saved.permissions, dataScopes: saved.dataScopes || {}, limits: saved.limits || {}, security: { idleMinutes: null, require2fa: false, ...saved.security } }
      setForm({ ...loaded, permissions: new Set(loaded.permissions) })
      setInitial(snapshot(loaded))
      showSuccess(isNew ? t('admin.roleEditor.toast.created', { name: saved.name }) : t('admin.roleEditor.toast.saved', { count: saved.userCount }))
      if (isNew) navigate(`/core/roles/${saved.id}`, { replace: true })
    },
    onError: (err) => showError(err.message),
  })

  const onSave = async () => {
    if (!form.name.trim()) { showError(t('admin.roleEditor.nameRequired')); return }
    if (form.fullAccess && !(role?.fullAccess)) {
      const ok = await confirm({ title: t('admin.roleEditor.confirm.fullTitle'), message: t('admin.roleEditor.confirm.fullMessage', { name: form.name }), tone: 'danger', confirmLabel: t('admin.roleEditor.confirm.fullConfirm') })
      if (!ok) return
    }
    if (!form.fullAccess && sensitive.length && !isNew && role && sensitivePermissions(role.permissions ?? []).length < sensitive.length) {
      const ok = await confirm({ title: t('admin.roleEditor.confirm.sensitiveTitle'), message: t('admin.roleEditor.confirm.sensitiveMessage', { count: sensitive.length, examples: sensitive.slice(0, 3).map(permAction).join(', ') }), confirmLabel: t('admin.roleEditor.confirm.saveRole') })
      if (!ok) return
    }
    save.mutate()
  }

  const back = async () => {
    if (dirty && !readOnly) {
      const ok = await confirm({ title: t('admin.roleEditor.confirm.discardTitle'), message: t('admin.roleEditor.confirm.discardMessage'), tone: 'danger', confirmLabel: t('admin.roleEditor.confirm.discard') })
      if (!ok) return
    }
    navigate('/core/roles')
  }

  if (catalogQ.isError || roleQ.isError) {
    return <PageContainer><Note tone="danger">{(catalogQ.error || roleQ.error)?.message || t('admin.roleEditor.loadError')}</Note></PageContainer>
  }
  if (!form || !catalog) {
    return <PageContainer><div className="h-10 w-80 rounded-lg bg-black/5 animate-pulse" /><div className="h-[60vh] rounded-xl bg-black/5 animate-pulse" /></PageContainer>
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const memberCount = role?.userCount ?? 0

  return (
    <PageContainer>
      <PageHeader
        icon={role?.system ? ShieldCheck : Shield}
        title={isNew ? t('admin.roles.newRole') : role.name}
        subtitle={isNew ? t('admin.roleEditor.subtitleNew') : role.system ? t('admin.roleEditor.subtitleSystem') : t('admin.roleEditor.subtitleMembers', { count: memberCount })}
        actions={<>
          <Button variant="secondary" icon={ArrowLeft} onClick={back}>{t('admin.roleCompare.roles')}</Button>
          {canSave && <Button icon={Check} loading={save.isPending} disabled={!dirty || !form.name.trim()} onClick={onSave}>{isNew ? t('admin.roleEditor.create') : t('admin.users.form.saveChanges')}</Button>}
        </>}
      />

      {role?.locked && (
        <Note tone="info" icon={Lock}>
          <Trans t={t} i18nKey="admin.roleEditor.lockedNote" values={{ name: role.name }} components={{ b: <span className="font-medium text-ink" />, link: <Link to="/core/all-pages" className="text-brand-600 font-medium hover:underline" /> }} />
        </Note>
      )}
      {holdsRole && !canFull && !role?.locked && <Note tone="warning" icon={Eye}>{t('admin.roleEditor.holdsRole')}</Note>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <aside className="space-y-5">
          <div className="rounded-xl border border-border bg-surface shadow-card p-5 space-y-4">
            {isNew && templatesQ.data && (
              <FormField label={t('admin.roleEditor.startFrom')} hint={t('admin.roleEditor.startFromHint')}>
                <Select value={template} onChange={(e) => pickTemplate(e.target.value)}>
                  <option value="">{t('admin.roles.onlyAdmin.blank')}</option>
                  {templatesQ.data.filter((x) => x.available).map((x) => <option key={x.code} value={x.code}>{t('admin.roleEditor.templateOption', { name: x.name, count: x.permissionCount })}</option>)}
                </Select>
              </FormField>
            )}
            <FormField label={t('admin.roleEditor.roleName')} required>
              <Input value={form.name} disabled={readOnly || role?.locked} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={t('admin.roleEditor.roleNamePlaceholder')} />
            </FormField>
            <FormField label={t('admin.roleEditor.description')} hint={t('admin.roleEditor.descriptionHint')}>
              <Textarea rows={3} value={form.description} disabled={!canSave} maxLength={500} onChange={(e) => set({ description: e.target.value })} placeholder={t('admin.roleEditor.descriptionPlaceholder')} />
            </FormField>
            {!role?.locked && (
              <FormField label={t('admin.roleEditor.homePage')} hint={t('admin.roleEditor.homePageHint')}>
                <Select value={form.homePage} disabled={readOnly} onChange={(e) => set({ homePage: e.target.value })}>
                  <option value="">{t('admin.roleEditor.home')}</option>
                  {homeOptions.map((o) => <option key={o.path} value={o.path}>{o.label}</option>)}
                </Select>
              </FormField>
            )}

            {!role?.locked && (
              <div className={clsx('flex items-start gap-3 rounded-lg border px-3 py-3', form.fullAccess ? 'border-amber-400/50 bg-amber-50' : 'border-border bg-bg/50')}>
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><ShieldCheck className="w-4 h-4 text-amber-600" />{t('admin.roles.fullAccess')}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{t('admin.roleEditor.fullAccessDesc')}{!canFull && ` ${t('admin.roleEditor.fullAccessOnlyAdmin')}`}</p>
                </div>
                <Switch checked={form.fullAccess} disabled={readOnly || !canFull} onChange={(v) => set({ fullAccess: v })} label={t('admin.roles.fullAccess')} />
              </div>
            )}

            {!form.fullAccess && !role?.locked && (
              <div className="rounded-lg bg-bg/60 border border-border p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('admin.roleEditor.granted')}</span>
                  <span className="text-sm text-ink tabular-nums"><span className="font-semibold">{perms.length}</span><span className="text-ink-faint"> / {totalKeys}</span></span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-black/5 overflow-hidden"><div className="h-full bg-brand-500 transition-all" style={{ width: `${totalKeys ? (perms.length / totalKeys) * 100 : 0}%` }} /></div>
                {!readOnly && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => set({ permissions: new Set(catalog.modules.filter((m) => m.enabled).flatMap((m) => m.pages.flatMap((p) => p.actions.filter((a) => a.id === 'view' && a.grantable !== false).map((a) => a.key))) ) })}>{t('admin.roleEditor.viewEverything')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => set({ permissions: new Set() })}>{t('admin.roleEditor.clearAll')}</Button>
                  </div>
                )}
              </div>
            )}

            {!form.fullAccess && (sensitive.length > 0 || sod.length > 0) && (
              <div className="space-y-2">
                {sensitive.length > 0 && (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {t('admin.roleEditor.sensitiveCount', { count: sensitive.length })}</p>
                    <ul className="mt-1 space-y-0.5">{sensitive.slice(0, 6).map((k) => <li key={k} className="text-xs text-ink-muted">{permText(k)}</li>)}</ul>
                    {sensitive.length > 6 && <p className="text-xs text-ink-faint mt-0.5">{t('admin.roleEditor.more', { count: sensitive.length - 6 })}</p>}
                  </div>
                )}
                {sod.map((w) => (
                  <div key={w.a + w.b} className="rounded-lg border border-info-500/20 bg-info-50 px-3 py-2 text-xs text-info-600 flex gap-1.5">
                    <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span><Trans t={t} i18nKey="admin.roleEditor.sodWarning" values={{ message: sodText(w) }} components={{ b: <span className="font-semibold" /> }} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <SidebarPreview permissions={perms} fullAccess={form.fullAccess} enabledModules={me?.enabledModules} />
        </aside>

        <div className="lg:col-span-2 rounded-xl border border-border bg-surface shadow-card min-w-0">
          <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
            { value: 'pages', label: t('admin.roleEditor.tabs.pages') },
            { value: 'scope', label: t('admin.roleEditor.tabs.scope') },
            ...(isNew ? [] : [{ value: 'members', label: t('admin.roleEditor.tabs.members', { count: memberCount }) }, { value: 'history', label: t('ui.common.history') }]),
          ]} />
          <div className="p-4">
            {tab === 'pages' && (form.fullAccess || role?.locked ? (
              <div className="py-12 text-center text-sm text-ink-muted">
                <ShieldCheck className="w-9 h-9 mx-auto text-amber-500 mb-3" />
                <p><Trans t={t} i18nKey="admin.roleEditor.fullAccessPanel" components={{ b: <span className="font-medium text-ink" /> }} /></p>
                <Link to="/core/all-pages" className="inline-block mt-3 text-brand-600 font-medium hover:underline">{t('admin.roleEditor.seeAllPages')}</Link>
                {!readOnly && !role?.locked && <p className="mt-2 text-xs"><Trans t={t} i18nKey="admin.roleEditor.switchOff" components={{ b: <span className="font-medium" /> }} /></p>}
              </div>
            ) : (
              <PermissionMatrix catalog={catalog} selected={form.permissions} onChange={(next) => set({ permissions: next })} readOnly={readOnly} />
            ))}
            {tab === 'scope' && (
              <ScopeLimits catalog={catalog} selected={form.permissions} fullAccess={form.fullAccess || role?.locked}
                dataScopes={form.dataScopes} onScopes={(v) => set({ dataScopes: v })}
                limits={form.limits} onLimits={(v) => set({ limits: v })}
                security={form.security} onSecurity={(v) => set({ security: v })} readOnly={readOnly || role?.locked} />
            )}
            {tab === 'members' && (
              <div>
                <DataTable
                  rowKey="id" loading={membersQ.isLoading} rows={membersQ.data ?? []} dense
                  columns={[
                    { key: 'name', header: t('admin.users.cols.name'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.email} /> },
                    { key: 'designation', header: t('admin.users.cols.designation') },
                    { key: 'lastLoginAt', header: t('admin.users.cols.lastSignIn'), nowrap: true, render: (v) => (v ? <DateCell value={v} time /> : <span className="text-ink-faint">{t('admin.users.never')}</span>) },
                    { key: 'active', header: t('admin.users.cols.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('admin.users.status.active') : t('admin.users.status.inactive')}</StatusPill> },
                  ]}
                  emptyIcon={UsersIcon} emptyTitle={t('admin.roleEditor.noMembers')} emptyHint={t('admin.roleEditor.noMembersHint')}
                />
                <Link to="/core/users" className="inline-block mt-3 text-sm text-brand-600 hover:underline">{t('admin.roleEditor.manageUsers')}</Link>
              </div>
            )}
            {tab === 'history' && <RecordHistory entityId={id} label={t('admin.roleEditor.historyLabel')} />}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
