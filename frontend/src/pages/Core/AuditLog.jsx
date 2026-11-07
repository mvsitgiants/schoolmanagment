import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { History, Minus, Plus, ScrollText, ShieldAlert } from 'lucide-react'
import { describePermission, MODULE_BY_ID } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, DateRangeChip, Drawer, PageContainer, PageHeader, StatusPill, Toolbar, ViewControls, presetRange,
} from '../../components/system'
import { DefinitionGrid } from '../../components/app/Controls'
import { fetchAudit } from '../../api/core'
import { hasPermission } from '../../api/auth'
import Button from '../../components/ui/Button'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { useFormat } from '../../context/SettingsContext'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

const ACTIONS = { CREATE: ['success', 'Created'], UPDATE: ['info', 'Updated'], DELETE: ['danger', 'Deleted'], LOGIN: ['neutral', 'Signed in'], LOGIN_FAILED: ['warning', 'Sign-in failed'], LOGOUT: ['neutral', 'Signed out'], SECURITY: ['danger', 'Security'], PLAN_CHANGE: ['warning', 'Plan change'], VIEW: ['neutral', 'Opened a chart'], BREAK_GLASS: ['danger', 'Emergency access'] }
const ENTITIES = { role: 'Role', user: 'User', department: 'Department', branch: 'Branch', module: 'Module', tenant: 'Institution' }
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const itemLabel = (k, cl) => {
  if (k.split('.').length === 3) {
    const p = describePermission(k)
    return p.exists ? `${cl.module(p.module)} › ${cl.page(p.module, p.page)} › ${cl.action({ id: p.action, label: p.label })}` : k
  }
  return MODULE_BY_ID[k] ? cl.module(k) : k
}

export default function AuditLog() {
  const { t } = useTranslation('admin')
  const cl = useCatalogLabel()
  const actionLabel = (code) => (ACTIONS[code] ? t(`admin.auditLog.actions.${code}`, { defaultValue: ACTIONS[code][1] }) : code)
  const entityLabel = (code) => (ENTITIES[code] ? t(`admin.auditLog.entities.${code}`, { defaultValue: ENTITIES[code] }) : code)
  const all = t('admin.auditLog.all')
  const { dateTime } = useFormat()
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [range, setRange] = useState(() => presetRange('last30'))
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const q = useDebouncedValue(search, 300)
  useEffect(() => setPage(1), [q, action, entity, range])

  const params = { search: q, action, entityType: entity, from: range?.from, to: range?.to, page, pageSize: 30 }
  const { data, isLoading } = useQuery({ queryKey: ['audit', params], queryFn: () => fetchAudit(params), placeholderData: (p) => p })
  const meta = data?.meta

  return (
    <PageContainer>
      <PageHeader icon={ScrollText} title={t('admin.auditLog.title')} subtitle={t('admin.auditLog.subtitle')}
        actions={hasPermission('core.audit.break_glass_report') && <Button to="/core/audit/break-glass" variant="secondary" icon={ShieldAlert}>{t('admin.auditLog.breakGlassReport')}</Button>} />
      <DataTable
        rows={data?.data ?? []}
        loading={isLoading}
        onRowClick={setOpen}
        toolbar={(
          <Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('admin.auditLog.searchPlaceholder')} right={(
            <ViewControls>
              <ControlChip label={t('admin.auditLog.action')} value={action ? actionLabel(action) : all} active={!!action} options={[all, ...Object.keys(ACTIONS).map(actionLabel)]} onChange={(v) => setAction(Object.keys(ACTIONS).find((c) => actionLabel(c) === v) ?? '')} />
              <ControlChip label={t('admin.auditLog.record')} value={entity ? entityLabel(entity) : all} active={!!entity} options={[all, ...Object.keys(ENTITIES).map(entityLabel)]} onChange={(v) => setEntity(Object.keys(ENTITIES).find((c) => entityLabel(c) === v) ?? '')} />
              <DateRangeChip value={range} onChange={setRange} />
            </ViewControls>
          )} />
        )}
        columns={[
          { key: 'at', header: t('admin.auditLog.when'), nowrap: true, width: 170, render: (v) => <span className="text-sm text-ink-muted">{dateTime(v)}</span> },
          { key: 'userName', header: t('admin.auditLog.who'), render: (v) => <span className="text-sm text-ink">{v}</span> },
          { key: 'action', header: t('admin.auditLog.action'), render: (v) => <StatusPill tone={ACTIONS[v]?.[0]}>{actionLabel(v)}</StatusPill> },
          { key: 'summary', header: t('admin.auditLog.whatHappened'), mobilePrimary: true, render: (v, r) => <div><p className="text-sm text-ink">{v}</p>{(r.added?.length > 0 || r.removed?.length > 0) && <p className="text-xs text-ink-faint">{t('admin.auditLog.itemsChanged', { changes: [r.added?.length ? `+${r.added.length}` : '', r.removed?.length ? `−${r.removed.length}` : ''].filter(Boolean).join(' · ') })}</p>}</div> },
          { key: 'entityType', header: t('admin.auditLog.record'), mobileHidden: true, render: (v, r) => <span className="text-xs text-ink-muted">{entityLabel(v)}{r.entityName ? ` · ${r.entityName}` : ''}</span> },
        ]}
        pagination={meta && { page: meta.page - 1, size: meta.pageSize, totalElements: meta.total, totalPages: meta.totalPages, onPageChange: (p) => setPage(p + 1) }}
        emptyIcon={History}
        emptyTitle={t('admin.auditLog.empty')}
      />

      <Drawer open={!!open} onClose={() => setOpen(null)} subtitle={t('admin.auditLog.entry')} title={open?.summary}>
        {open && (
          <div className="space-y-5">
            <DefinitionGrid items={[
              { label: t('admin.auditLog.when'), value: dateTime(open.at) },
              { label: t('admin.auditLog.who'), value: open.userName },
              { label: t('admin.auditLog.action'), value: actionLabel(open.action) },
              { label: t('admin.auditLog.record'), value: `${open.entityType ? entityLabel(open.entityType) : '—'}${open.entityName ? ` · ${open.entityName}` : ''}` },
              open.ip && { label: t('admin.auditLog.ipAddress'), value: open.ip, mono: true },
            ]} />
            {open.changes?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('admin.auditLog.fieldChanges')}</p>
                <DataTable dense rows={open.changes.map((c, i) => ({ ...c, id: i }))} columns={[
                  { key: 'field', header: t('admin.auditLog.field'), render: (v) => <span className="font-medium">{v}</span> },
                  { key: 'from', header: t('admin.auditLog.before'), render: (v) => <span className="text-ink-muted break-all">{show(v)}</span> },
                  { key: 'to', header: t('admin.auditLog.after'), render: (v) => <span className="break-all">{show(v)}</span> },
                ]} />
              </div>
            )}
            {open.added?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-success-600 mb-1.5">{t('admin.auditLog.addedCount', { count: open.added.length })}</p>
                <ul className="space-y-0.5">{open.added.map((k) => <li key={k} className="text-xs text-ink flex gap-1.5"><Plus className="w-3 h-3 text-success-500 mt-0.5 shrink-0" />{itemLabel(k, cl)}</li>)}</ul>
              </div>
            )}
            {open.removed?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-danger-600 mb-1.5">{t('admin.auditLog.removedCount', { count: open.removed.length })}</p>
                <ul className="space-y-0.5">{open.removed.map((k) => <li key={k} className="text-xs text-ink flex gap-1.5"><Minus className="w-3 h-3 text-danger-500 mt-0.5 shrink-0" />{itemLabel(k, cl)}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </PageContainer>
  )
}
