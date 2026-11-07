import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building, GraduationCap, Pencil, Plus, Trash2, Wrench, Briefcase } from 'lucide-react'
import { ImportExportButtons,
  ControlChip, DataTable, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, Select, StatCardRow, StatusPill, Textarea, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createDepartment, deleteDepartment, fetchDepartments, fetchUserLookup, updateDepartment } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { importDepartments } from '../../api/core'
import { readSheet } from '../../utils/readSheet'

export const DEPT_TYPES = {
  ACADEMIC: { label: 'Academic', tone: 'brand', icon: GraduationCap },
  ADMINISTRATIVE: { label: 'Administrative', tone: 'neutral', icon: Briefcase },
  SUPPORT: { label: 'Support', tone: 'success', icon: Wrench },
}

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

export default function Departments() {
  const { t } = useTranslation('admin')
  const typeLabel = (k) => (DEPT_TYPES[k] ? t(`admin.departments.types.${k}`) : k)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const [editing, setEditing] = useState(null)
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
          {hasPermission('core.departments.import') && <ImportExportButtons resourceLabel={t('ui:ui.importExport.resources.departments')} requires="core.departments.import"
            onImport={async (file) => importDepartments(await readSheet(file), true)} onCommit={(rows) => importDepartments(rows, false)}
            templateHeaders={['name', 'code', 'type', 'description']}
            templateSample={['Mathematics', 'MATHS', 'ACADEMIC', 'Maths teachers of every class']}
            onDone={() => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['setup'] }) }} />}
          {<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('admin.departments.newDepartment')}</HeaderButton>}
        </>} />
      <StatCardRow items={[
        { icon: GraduationCap, label: typeLabel('ACADEMIC'), value: count('ACADEMIC'), tone: 'brand', onClick: () => setType('ACADEMIC') },
        { icon: Briefcase, label: typeLabel('ADMINISTRATIVE'), value: count('ADMINISTRATIVE'), tone: 'neutral', onClick: () => setType('ADMINISTRATIVE') },
        { icon: Wrench, label: typeLabel('SUPPORT'), value: count('SUPPORT'), tone: 'success', onClick: () => setType('SUPPORT') },
      ]} />
      <DataTable
        rows={shown}
        loading={isLoading}
        exportable exportName="departments"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('admin.departments.searchPlaceholder')} right={<ControlChip label={t('admin.departments.type')} value={type ? typeLabel(type) : t('admin.departments.all')} active={!!type} options={[t('admin.departments.all'), ...Object.keys(DEPT_TYPES).map(typeLabel)]} onChange={(v) => setType(Object.keys(DEPT_TYPES).find((k) => typeLabel(k) === v) ?? '')} />} />}
        columns={[
          { key: 'name', header: t('admin.departments.department'), mobilePrimary: true, render: (v, r) => { const T = DEPT_TYPES[r.type]; const Icon = T?.icon ?? Building; return <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-lg bg-bg flex items-center justify-center text-ink-muted"><Icon className="w-4 h-4" /></span><div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.code}</p></div></div> } },
          { key: 'type', header: t('admin.departments.type'), render: (v) => <StatusPill tone={DEPT_TYPES[v]?.tone}>{typeLabel(v)}</StatusPill> },
          { key: 'headName', header: t('admin.departments.headCol'), mobileHidden: true, render: (v) => v || <span className="text-ink-faint">—</span> },
          { key: 'staffCount', header: t('admin.departments.staff'), align: 'right', sortable: true },
          { key: 'active', header: t('common.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('status.active') : t('admin.departments.inactive')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('core.departments.edit') && <button title={t('actions.edit')} onClick={() => setEditing(r)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg"><Pencil className="w-4 h-4" /></button>}
              {hasPermission('core.departments.delete') && <button title={t('actions.delete')} onClick={async () => { if (await confirm({ title: t('admin.departments.deleteConfirm.title', { name: r.name }), message: r.staffCount ? t('admin.departments.deleteConfirm.staffAssigned') : t('admin.departments.deleteConfirm.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-danger-50 hover:text-danger-600"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ) },
        ]}
        onRowClick={hasPermission('core.departments.edit') ? setEditing : undefined}
        emptyIcon={Building} emptyTitle={rows.length ? t('admin.departments.noMatch') : t('admin.departments.emptyTitle')} emptyHint={rows.length ? undefined : t('admin.departments.emptyHint')}
      />
      {editing && <DeptForm dept={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['setup'] }); showSuccess(t('admin.departments.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
