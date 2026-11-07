import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from '@schoolgiant/shared'
import {
  DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, Select, StatusPill, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { createCustomField, deleteCustomField, fetchCustomFields, updateCustomField } from '../../api/core'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const TYPE_LABEL = Object.fromEntries(CUSTOM_FIELD_TYPES.map((x) => [x.value, x.label]))

function FieldForm({ field, entity, onClose, onSaved }) {
  const { t } = useTranslation('admin')
  const isNew = !field
  const [form, setForm] = useState(() => ({ label: '', type: 'TEXT', required: false, showInList: false, help: '', ...field, options: (field?.options ?? []).join(', ') }))
  const { showError } = useSnackbar()
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
  const hasOptions = ['SELECT', 'MULTI'].includes(form.type)
  const save = useMutation({
    mutationFn: () => {
      const body = { label: form.label, options: hasOptions ? form.options.split(',').map((s) => s.trim()).filter(Boolean) : [], required: form.required, showInList: form.showInList, help: form.help }
      return isNew ? createCustomField({ ...body, entity, type: form.type }) : updateCustomField(field.id, body)
    },
    onSuccess: onSaved,
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={isNew ? t('admin.customFields.newTitle') : t('admin.customFields.editTitle', { label: field.label })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.label.trim()} onClick={() => save.mutate()}>{isNew ? t('admin.customFields.addField') : t('actions.save')}</Button>
    </>}>
      <div className="space-y-4">
        <FormField label={t('admin.customFields.label')} required><Input value={form.label} onChange={set('label')} placeholder={t('admin.customFields.labelPlaceholder')} autoFocus /></FormField>
        <FormField label={t('admin.customFields.type')} hint={isNew ? undefined : t('admin.customFields.typeHint')}>
          <Select value={form.type} disabled={!isNew} onChange={set('type')}>{CUSTOM_FIELD_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`admin.customFields.types.${x.value}`, { defaultValue: x.label })}</option>)}</Select>
        </FormField>
        {hasOptions && <FormField label={t('admin.customFields.options')} required hint={t('admin.customFields.optionsHint')}><Input value={form.options} onChange={set('options')} placeholder={t('admin.customFields.optionsPlaceholder')} /></FormField>}
        <FormField label={t('admin.customFields.helpText')}><Input value={form.help ?? ''} onChange={set('help')} placeholder={t('admin.customFields.helpPlaceholder')} /></FormField>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('admin.customFields.required')} <Switch checked={form.required} onChange={set('required')} label={t('admin.customFields.required')} /></label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-ink">{t('admin.customFields.showAsColumn')} <Switch checked={form.showInList} onChange={set('showInList')} label={t('admin.customFields.showInList')} /></label>
        </div>
      </div>
    </Modal>
  )
}

export default function CustomFields() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const [entity, setEntity] = useState(CUSTOM_FIELD_ENTITIES[0].value)
  const [editing, setEditing] = useState(null)
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['custom-fields', entity], queryFn: () => fetchCustomFields(entity) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['custom-fields'] }); qc.invalidateQueries({ queryKey: ['student-meta'] }) }
  const patch = useMutation({ mutationFn: ({ id, body }) => updateCustomField(id, body), onSuccess: refresh, onError: (e) => showError(e.message) })
  const del = useMutation({ mutationFn: deleteCustomField, onSuccess: () => { refresh(); showSuccess(t('admin.customFields.deleted')) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('core.custom-fields.edit')

  const move = (i, dir) => {
    const a = rows[i]
    const b = rows[i + dir]
    if (!a || !b) return
    patch.mutate({ id: a.id, body: { order: b.order } })
    patch.mutate({ id: b.id, body: { order: a.order } })
  }

  return (
    <PageContainer>
      <PageHeader icon={ListPlus} title={t('admin.customFields.title')} subtitle={t('admin.customFields.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('admin.customFields.newField')}</HeaderButton>} />
      {CUSTOM_FIELD_ENTITIES.length > 1 && <SegmentedControl value={entity} onChange={setEntity} options={CUSTOM_FIELD_ENTITIES.map((e) => ({ value: e.value, label: t(`admin.customFields.entities.${e.value}`, { defaultValue: e.label }) }))} />}
      <DataTable
        rows={rows}
        loading={isLoading}
        title={t('admin.customFields.tableTitle', { entity: t(`admin.customFields.entities.${entity}`, { defaultValue: CUSTOM_FIELD_ENTITIES.find((e) => e.value === entity)?.label ?? entity }) })}
        columns={[
          { key: 'order', header: '', width: 70, render: (_, r) => canEdit && (
            <div className="flex gap-0.5">
              <button onClick={() => move(rows.indexOf(r), -1)} disabled={rows.indexOf(r) === 0} className="w-7 h-7 rounded flex items-center justify-center text-ink-faint hover:bg-bg disabled:opacity-30" aria-label={t('admin.customFields.moveUp')}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => move(rows.indexOf(r), 1)} disabled={rows.indexOf(r) === rows.length - 1} className="w-7 h-7 rounded flex items-center justify-center text-ink-faint hover:bg-bg disabled:opacity-30" aria-label={t('admin.customFields.moveDown')}><ArrowDown className="w-3.5 h-3.5" /></button>
            </div>
          ) },
          { key: 'label', header: t('admin.customFields.field'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}{r.required && <span className="text-danger-500"> *</span>}</p>{r.help && <p className="text-xs text-ink-faint">{r.help}</p>}</div> },
          { key: 'type', header: t('admin.customFields.type'), render: (v) => t(`admin.customFields.types.${v}`, { defaultValue: TYPE_LABEL[v] ?? v }) },
          { key: 'options', header: t('admin.customFields.options'), render: (v) => (v?.length ? <span className="text-xs text-ink-muted">{v.join(', ')}</span> : <span className="text-ink-faint">—</span>) },
          { key: 'showInList', header: t('admin.customFields.inList'), render: (v) => (v ? t('common.yes') : '—') },
          { key: 'active', header: t('common.status'), render: (v, r) => canEdit ? <Switch size="sm" checked={v} onChange={(on) => patch.mutate({ id: r.id, body: { active: on } })} label={t('status.active')} /> : <StatusPill tone={v ? 'success' : 'neutral'}>{v ? t('ui.common.on') : t('ui.common.off')}</StatusPill> },
          { key: 'id', header: '', align: 'right', render: (_, r) => (
            <div className="flex justify-end gap-1">
              {canEdit && <button onClick={() => setEditing(r)} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg" title={t('actions.edit')}><Pencil className="w-4 h-4" /></button>}
              {hasPermission('core.custom-fields.delete') && !r.active && <button onClick={async () => { if (await confirm({ title: t('admin.customFields.deleteConfirm.title', { label: r.label }), message: t('admin.customFields.deleteConfirm.message'), tone: 'danger', confirmLabel: t('actions.delete') })) del.mutate(r.id) }} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-danger-50 hover:text-danger-600" title={t('actions.delete')}><Trash2 className="w-4 h-4" /></button>}
            </div>
          ) },
        ]}
        emptyIcon={ListPlus} emptyTitle={t('admin.customFields.emptyTitle')} emptyHint={t('admin.customFields.emptyHint')}
      />
      <Note>{t('admin.customFields.note')}</Note>
      {editing && <FieldForm field={editing === 'new' ? null : editing} entity={entity} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); showSuccess(t('admin.customFields.saved')) }} />}
    </PageContainer>
  )
}
