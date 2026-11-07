import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Settings2 } from 'lucide-react'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { createExamType, fetchExamTypes, updateExamType } from '../../api/exams'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

function TypeForm({ type, onClose, onSaved }) {
  const { t } = useTranslation('exams')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ name: type?.name ?? '', code: type?.code ?? '', weightage: String(type?.weightage ?? 0), defaultMaxMarks: String(type?.defaultMaxMarks ?? 100) })
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value }))
  const body = { name: form.name, code: form.code, weightage: Number(form.weightage) || 0, defaultMaxMarks: Number(form.defaultMaxMarks) || 100 }
  const save = useMutation({
    mutationFn: () => (type ? updateExamType(type.id, body) : createExamType(body)),
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={type ? t('exams.setup.editTitle') : t('exams.setup.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.code.trim()} onClick={() => save.mutate()}>{t('exams.setup.save')}</Button>
    </>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><FormField label={t('exams.setup.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('exams.setup.namePlaceholder')} /></FormField></div>
        <FormField label={t('exams.setup.code')} required error={errors.code}><Input value={form.code} onChange={set('code')} /></FormField>
        <FormField label={t('exams.setup.defaultMax')} hint={t('exams.setup.defaultMaxHint')} error={errors.defaultMaxMarks}><Input type="number" min="1" value={form.defaultMaxMarks} onChange={set('defaultMaxMarks')} /></FormField>
        <div className="col-span-2"><FormField label={t('exams.setup.weightage')} hint={t('exams.setup.weightageHint')} error={errors.weightage}><Input type="number" min="0" max="100" value={form.weightage} onChange={set('weightage')} /></FormField></div>
      </div>
    </Modal>
  )
}

/** Exam setup: the kinds of exam the institution holds. Grading scales live in Academic setup › Grading. */
export default function Setup() {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['exam-types'], queryFn: fetchExamTypes })
  const toggle = useMutation({ mutationFn: (r) => updateExamType(r.id, { active: !r.active }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-types'] }); showSuccess(t('exams.setup.saved')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('exams.setup.edit')
  const weight = rows.filter((r) => r.active).reduce((n, r) => n + (Number(r.weightage) || 0), 0)

  return (
    <PageContainer>
      <PageHeader icon={Settings2} title={t('exams.setup.title')} subtitle={t('exams.setup.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="exams.setup.create" onClick={() => setEditing('new')}>{t('exams.setup.new')}</HeaderButton>} />
      {rows.length > 0 && weight !== 100 && <Note tone="warning" className="mb-4">{t('exams.setup.weightNot100', { total: weight })}</Note>}
      <DataTable
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        columns={[
          { key: 'name', header: t('exams.setup.name'), mobilePrimary: true, render: (v, r) => <span className={r.active ? 'font-medium text-ink' : 'text-ink-faint line-through'}>{v}</span> },
          { key: 'code', header: t('exams.setup.code'), render: (v) => <span className="font-mono-num text-sm">{v}</span> },
          { key: 'defaultMaxMarks', header: t('exams.setup.defaultMax'), align: 'right' },
          { key: 'weightage', header: t('exams.setup.weightage'), align: 'right', render: (v) => `${v ?? 0}%` },
          { key: 'active', header: t('exams.setup.status'), render: (v) => <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('exams.setup.inUse') : t('exams.setup.notInUse')}</StatusPill> },
          { key: 'id', header: '', align: 'right', width: 150, render: (_, r) => canEdit && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('exams.setup.edit')} title={t('exams.setup.edit')} onClick={() => setEditing(r)} />
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>{r.active ? t('exams.setup.deactivate') : t('exams.setup.activate')}</Button>
            </div>
          ) },
        ]}
        onRowClick={canEdit ? (r) => setEditing(r) : undefined}
        emptyIcon={Settings2} emptyTitle={t('exams.setup.empty')}
      />
      <Note className="mt-4">{t('exams.setup.gradingHint')}</Note>
      {editing && <TypeForm type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['exam-types'] }); setEditing(null); showSuccess(t('exams.setup.saved')) }} />}
    </PageContainer>
  )
}
