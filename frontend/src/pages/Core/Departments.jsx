import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building, ChevronLeft, GraduationCap, Pencil, Plus, ShieldCheck, Trash2, Users, Wrench, Briefcase } from 'lucide-react'
import { ImportExportButtons,
  Avatar, ColorChip, ControlChip, DataTable, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, PersonCell, Select, SideNav, SideNavLayout, StatCardRow, StatusPill, TONE, Textarea, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createDepartment, deleteDepartment, fetchDepartments, fetchUserLookup, fetchUsers, updateDepartment } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { importDepartments } from '../../api/core'
import { readSheet } from '../../utils/readSheet'

export const DEPT_TYPES = {
  ACADEMIC: { label: 'Academic', tone: 'brand', icon: GraduationCap },
  ADMINISTRATIVE: { label: 'Administrative', tone: 'neutral', icon: Briefcase },
  SUPPORT: { label: 'Support', tone: 'success', icon: Wrench },
}

// the colour a department type shows in (administrative is not "nothing", so not grey)
const typeTone = (k) => (k === 'ADMINISTRATIVE' ? 'violet' : DEPT_TYPES[k]?.tone ?? 'neutral')

function DeptForm({ dept, onClose, onSaved }) {
  const { t } = useTranslation('admin')
  const [form, setForm] = useState(() => ({ name: '', code: '', type: 'ACADEMIC', description: '', active: true, ...dept, headUserId: dept?.headUserId ?? '' }))
  const [errors, setErrors] = useState({})
  const { data: people = [] } = useQuery({ queryKey: ['user-lookup'], queryFn: fetchUserLookup })
  const { showError } = useSnackbar()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, code: form.code, type: form.type, headUserId: form.headUserId || null, description: form.description, active: form.active }
      return dept ? updateDepartment(dept.id, body) : createDepartment(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={dept ? t('admin.departments.editTitle', { name: dept.name }) : t('admin.departments.newDepartment')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>{dept ? t('actions.save') : t('admin.departments.addDepartment')}</Button>
    </>}>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><FormField label={t('common.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('admin.departments.namePlaceholder')} /></FormField></div>
        <FormField label={t('admin.departments.code')} required error={errors.code}><Input value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} placeholder="CARD" maxLength={12} /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <FormField label={t('admin.departments.type')} required>
          <Select value={form.type} onChange={set('type')}>{Object.keys(DEPT_TYPES).map((k) => <option key={k} value={k}>{t(`admin.departments.types.${k}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('admin.departments.head')}>
          <Select value={form.headUserId} onChange={set('headUserId')}>
            <option value="">{t('admin.departments.notSet')}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.designation ? ` — ${p.designation}` : ''}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="mt-4"><FormField label={t('admin.departments.description')}><Textarea rows={2} value={form.description ?? ''} onChange={set('description')} /></FormField></div>
      {dept && <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('status.active')} <Switch checked={form.active} onChange={set('active')} label={t('status.active')} /></label>}
    </Modal>
  )
}

/** One department: who is in it (active users with the department), its head, and Edit. */
function DeptDetail({ dept, typeLabel, onBack, onEdit }) {
  const { t } = useTranslation('admin')
  const canSeeUsers = hasPermission('core.users.view')
  const params = { departmentId: dept.id, status: 'active', pageSize: 200 }
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['users', params], queryFn: () => fetchUsers(params), enabled: canSeeUsers })
  const T = DEPT_TYPES[dept.type]
  const Icon = T?.icon ?? Building
  const tn = TONE[typeTone(dept.type)]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('admin.departments.back')} title={t('admin.departments.back')} className="shrink-0" />
          <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${tn.bg} ${tn.text} ${tn.border}`}><Icon className="w-5 h-5" /></span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">{dept.name}<span className="text-xs font-mono-num font-normal text-ink-faint">{dept.code}</span>{!dept.active && <StatusPill tone="neutral">{t('admin.departments.inactive')}</StatusPill>}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              <ColorChip label={typeLabel(dept.type)} tone={typeTone(dept.type)} icon={T?.icon} />
              {dept.headName && <span>{t('admin.departments.headedBy', { name: dept.headName })}</span>}
            </div>
          </div>
        </div>
        {hasPermission('core.departments.edit') && <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{t('actions.edit')}</Button>}
      </div>
      {dept.description && <p className="text-sm text-ink-muted">{dept.description}</p>}
      {canSeeUsers && (
        <DataTable
          title={t('admin.departments.people', { count: data?.meta?.total ?? dept.staffCount ?? 0 })}
          rows={data?.data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          columns={[
            { key: 'name', header: t('admin.users.cols.name'), mobilePrimary: true, render: (v, r) => (
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={v} size={32} />
                <div className="min-w-0"><p className="font-medium text-ink truncate">{v}{r.id === dept.headUserId && <span className="ms-1.5 text-[10px] font-semibold uppercase text-brand-600">{t('admin.departments.headCol')}</span>}</p><p className="text-xs text-ink-faint truncate">{r.designation || r.email}</p></div>
              </div>
            ) },
            { key: 'roles', header: t('admin.users.cols.roles'), mobilePrimary: true, render: (v) => (
              <div className="flex flex-wrap gap-1">{(v ?? []).map((r) => (r.fullAccess ? <ColorChip key={r.id} label={r.name} tone="warning" icon={ShieldCheck} /> : <ColorChip key={r.id} label={r.name} seed={r.id} dot />))}</div>
            ) },
            { key: 'email', header: t('admin.users.drawer.email'), mobileHidden: true, render: (v) => <span className="text-sm text-ink-muted">{v}</span> },
          ]}
          emptyIcon={Users}
          emptyTitle={t('admin.departments.noPeople')}
          emptyHint={t('admin.departments.noPeopleHint')}
        />
      )}
    </div>
  )
}

export default function Departments() {
  const { t } = useTranslation('admin')
  const typeLabel = (k) => (DEPT_TYPES[k] ? t(`admin.departments.types.${k}`) : k)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const [editing, setEditing] = useState(null)
  const [params, setParams] = useSearchParams()
  const openId = params.get('dept')
  const openDept = rows.find((d) => d.id === openId)
  const openRow = (id) => setParams(id ? { dept: id } : {})
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const del = useMutation({ mutationFn: deleteDepartment, onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); showSuccess(t('admin.departments.deleted')) }, onError: (e) => showError(e.message) })

  const q = search.trim().toLowerCase()
  const shown = rows.filter((d) => (!type || d.type === type) && (!q || d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)))
  const count = (t) => rows.filter((d) => d.type === t && d.active).length

  return (
    <PageContainer>
      <PageHeader icon={Building} title={t('admin.departments.title')} subtitle={t('admin.departments.subtitle')}
        actions={<>
          {!openDept && hasPermission('core.departments.import') && <ImportExportButtons resourceLabel={t('ui:ui.importExport.resources.departments')} requires="core.departments.import"
            onImport={async (file) => importDepartments(await readSheet(file), true)} onCommit={(rows) => importDepartments(rows, false)}
            templateHeaders={['name', 'code', 'type', 'description']}
            templateSample={['Mathematics', 'MATHS', 'ACADEMIC', 'Maths teachers of every class']}
            onDone={() => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['setup'] }) }} />}
          {<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('admin.departments.newDepartment')}</HeaderButton>}
        </>} />
      {openDept ? (
        <SideNavLayout nav={rows.length > 1 && (
          <SideNav title={t('admin.departments.title')} value={openDept.id} onChange={openRow} items={(shown.some((d) => d.id === openDept.id) ? shown : rows).map((d) => ({
            id: d.id, label: d.name, icon: DEPT_TYPES[d.type]?.icon ?? Building,
            hint: [d.code, d.headName].filter(Boolean).join(' · '),
            count: d.staffCount ?? 0,
          }))} />
        )}>
          <DeptDetail key={openDept.id} dept={openDept} typeLabel={typeLabel} onBack={() => openRow(null)} onEdit={() => setEditing(openDept)} />
        </SideNavLayout>
      ) : (<>
      <StatCardRow items={Object.keys(DEPT_TYPES).map((k) => ({
        icon: DEPT_TYPES[k].icon, label: typeLabel(k), value: count(k), tone: typeTone(k),
        sub: t('admin.departments.staffIn', { count: rows.filter((d) => d.type === k && d.active).reduce((n, d) => n + (d.staffCount ?? 0), 0) }),
        onClick: () => setType(type === k ? '' : k),
        className: type === k ? 'ring-2 ring-brand-400' : type ? 'opacity-60 hover:opacity-100' : undefined,
      }))} />
      <DataTable
        rows={shown}
        loading={isLoading}
        exportable exportName="departments"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('admin.departments.searchPlaceholder')} right={<ControlChip label={t('admin.departments.type')} value={type ? typeLabel(type) : t('admin.departments.all')} active={!!type} options={[t('admin.departments.all'), ...Object.keys(DEPT_TYPES).map(typeLabel)]} onChange={(v) => setType(Object.keys(DEPT_TYPES).find((k) => typeLabel(k) === v) ?? '')} />} />}
        columns={[
          { key: 'name', header: t('admin.departments.department'), mobilePrimary: true, render: (v, r) => { const T = DEPT_TYPES[r.type]; const Icon = T?.icon ?? Building; const tn = TONE[typeTone(r.type)]; return <div className="flex items-center gap-3"><span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${tn.bg} ${tn.text} ${tn.border}`}><Icon className="w-4 h-4" /></span><div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.code}</p></div></div> } },
          { key: 'type', header: t('admin.departments.type'), mobilePrimary: true, render: (v) => <ColorChip label={typeLabel(v)} tone={typeTone(v)} icon={DEPT_TYPES[v]?.icon} /> },
          { key: 'headName', header: t('admin.departments.headCol'), mobileHidden: true, render: (v) => (v ? <PersonCell name={v} size={26} /> : <span className="text-ink-faint">—</span>) },
          { key: 'staffCount', header: t('admin.departments.staff'), align: 'right', sortable: true, render: (v) => <span className={`tabular-nums ${v ? 'font-semibold text-ink' : 'text-ink-faint'}`}>{v ?? 0}</span> },
          { key: 'active', header: t('common.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('status.active') : t('admin.departments.inactive')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('core.departments.edit') && <button title={t('actions.edit')} onClick={() => setEditing(r)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg"><Pencil className="w-4 h-4" /></button>}
              {hasPermission('core.departments.delete') && <button title={t('actions.delete')} onClick={async () => { if (await confirm({ title: t('admin.departments.deleteConfirm.title', { name: r.name }), message: r.staffCount ? t('admin.departments.deleteConfirm.staffAssigned') : t('admin.departments.deleteConfirm.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-danger-50 hover:text-danger-600"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ) },
        ]}
        onRowClick={(r) => openRow(r.id)}
        emptyIcon={Building} emptyTitle={rows.length ? t('admin.departments.noMatch') : t('admin.departments.emptyTitle')} emptyHint={rows.length ? undefined : t('admin.departments.emptyHint')}
      />
      </>)}
      {editing && <DeptForm dept={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['setup'] }); showSuccess(t('admin.departments.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
