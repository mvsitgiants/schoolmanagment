import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { SUBJECT_TYPES } from '@schoolgiant/shared'
import {
  ControlChip, DataTable, FormField, HeaderButton, ImportExportButtons, Input, Modal, PageContainer, PageHeader, Select, StatusPill, Toolbar, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createSubject, deleteSubject, fetchSubjects, importSubjects, updateSubject } from '../../api/academics'
import { fetchDepartments } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { readSheet } from '../../utils/readSheet'

const TYPE_TONE = { THEORY: 'brand', PRACTICAL: 'info', LANGUAGE: 'success', ACTIVITY: 'warning' }

function SubjectForm({ subject, onClose, onSaved }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const [form, setForm] = useState(() => ({ name: '', code: '', type: 'THEORY', departmentId: '', active: true, ...subject, departmentId: subject?.departmentId ?? '' }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, code: form.code, type: form.type, departmentId: form.departmentId || null, ...(subject && { active: form.active }) }
      return subject ? updateSubject(subject.id, body) : createSubject(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={subject ? t('academics.subjects.editTitle', { name: subject.name }) : t('academics.subjects.newSubject')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><FormField label={t('academics.subjects.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('academics.subjects.namePlaceholder')} /></FormField></div>
        <FormField label={t('academics.subjects.code')} required error={errors.code}><Input value={form.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} maxLength={12} placeholder="MATH" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <FormField label={t('academics.subjects.type')} required>
          <Select value={form.type} onChange={set('type')}>{SUBJECT_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`academics.subjectTypes.${x.value}`, x.label)}</option>)}</Select>
        </FormField>
        <FormField label={t('academics.subjects.department')} error={errors.departmentId}>
          <Select value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('academics.notSet')}</option>
            {depts.filter((d) => d.active || d.id === form.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </FormField>
      </div>
      {subject && <label className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('status.active')} <Switch checked={form.active} onChange={set('active')} label={t('status.active')} /></label>}
    </Modal>
  )
}

export default function Subjects() {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['subjects'], queryFn: fetchSubjects })
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['subjects'] }); qc.invalidateQueries({ queryKey: ['academic-lookup'] }) }
  const del = useMutation({ mutationFn: deleteSubject, onSuccess: () => { refresh(); showSuccess(t('academics.subjects.deleted')) }, onError: (e) => showError(e.message) })
  const typeLabel = (v) => t(`academics.subjectTypes.${v}`, SUBJECT_TYPES.find((x) => x.value === v)?.label ?? v)

  const q = search.trim().toLowerCase()
  const shown = rows.filter((s) => (!type || s.type === type) && (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)))

  return (
    <PageContainer>
      <PageHeader icon={BookOpen} title={t('academics.subjects.title')} subtitle={t('academics.subjects.subtitle')}
        actions={<>
          {hasPermission('academics.subjects.import') && <ImportExportButtons resourceLabel={t('academics.subjects.resource')} requires="academics.subjects.import"
            onImport={async (file) => importSubjects(await readSheet(file), true)} onCommit={(r) => importSubjects(r, false)}
            templateHeaders={['name', 'code', 'type', 'department']} templateSample={['Mathematics', 'MATH', 'THEORY', 'MATHS']} onDone={refresh} />}
          <HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('academics.subjects.newSubject')}</HeaderButton>
        </>} />
      <DataTable
        rows={shown}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        exportable exportName="subjects"
        toolbar={<Toolbar search={search} onSearch={setSearch} searchPlaceholder={t('academics.subjects.search')}
          right={<ControlChip label={t('academics.subjects.type')} value={type ? typeLabel(type) : t('academics.all')} active={!!type} options={[t('academics.all'), ...SUBJECT_TYPES.map((x) => typeLabel(x.value))]} onChange={(v) => setType(SUBJECT_TYPES.find((x) => typeLabel(x.value) === v)?.value ?? '')} />} />}
        columns={[
          { key: 'name', header: t('academics.subjects.subject'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.code}</p></div> },
          { key: 'type', header: t('academics.subjects.type'), render: (v) => <StatusPill tone={TYPE_TONE[v]}>{typeLabel(v)}</StatusPill> },
          { key: 'departmentName', header: t('academics.subjects.department'), mobileHidden: true, render: (v) => v || <span className="text-ink-faint">—</span> },
          { key: 'classCount', header: t('academics.subjects.classes'), align: 'right', sortable: true },
          { key: 'teacherCount', header: t('academics.subjects.allocations'), align: 'right', mobileHidden: true },
          { key: 'active', header: t('academics.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('status.active') : t('academics.inactive')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 90, render: (_, r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {hasPermission('academics.subjects.edit') && <Button size="sm" variant="ghost" icon={Pencil} title={t('actions.edit')} aria-label={t('actions.edit')} onClick={() => setEditing(r)} />}
              {hasPermission('academics.subjects.delete') && <Button size="sm" variant="ghost" icon={Trash2} title={t('actions.delete')} aria-label={t('actions.delete')}
                onClick={async () => { if (await confirm({ title: t('academics.subjects.deleteConfirm', { name: r.name }), message: t('academics.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} />}
            </div>
          ) },
        ]}
        onRowClick={hasPermission('academics.subjects.edit') ? setEditing : undefined}
        emptyIcon={BookOpen} emptyTitle={rows.length ? t('academics.noMatch') : t('academics.subjects.emptyTitle')} emptyHint={rows.length ? undefined : t('academics.subjects.emptyHint')}
      />
      {editing && <SubjectForm subject={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); showSuccess(t('academics.subjects.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
