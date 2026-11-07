import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Check, ClipboardList, Copy, Plus, Rocket, Trash2 } from 'lucide-react'
import { COMPUTED_TYPES, FIELD_TYPES, FIELD_TYPE_LABEL, FORM_STATUSES, FORM_USES, FORM_USE_LABEL, checkFormDefinition } from '@schoolgiant/shared'
import { DataTable, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, SegmentedControl, Select, StatusPill, Tabs, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import FormRenderer from '../../components/forms/FormRenderer'
import { archiveForm, createForm, duplicateForm, fetchForm, fetchForms, publishForm, saveForm } from '../../api/forms'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const keyFrom = (label) => String(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'F_$1').slice(0, 24)
const move = (arr, i, d) => { const out = [...arr]; const j = i + d; if (j < 0 || j >= out.length) return out; [out[i], out[j]] = [out[j], out[i]]; return out }
const BackIcon = ({ className, ...rest }) => <ArrowLeft {...rest} className={`${className ?? ''} rtl:rotate-180`} />
const errorsUnder = (errors, prefix) => Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]))

// ───────────────────────────────────────────────────────── list

function NewFormModal({ onClose }) {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()
  const { showError } = useSnackbar()
  const [f, setF] = useState({ name: '', code: '', use: 'SURVEY', codeTouched: false })
  const [errors, setErrors] = useState({})
  const create = useMutation({
    mutationFn: () => createForm({ name: f.name, code: f.code, use: f.use }),
    onSuccess: (form) => navigate(`/core/forms/${form.id}`),
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} title={t('admin.forms.newForm')} footer={<><Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button><Button icon={Plus} loading={create.isPending} disabled={f.name.trim().length < 2 || !f.code} onClick={() => create.mutate()}>{t('admin.forms.create')}</Button></>}>
      <div className="space-y-4">
        <FormField label={t('common.name')} required error={errors.name}><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, code: f.codeTouched ? f.code : keyFrom(e.target.value) })} placeholder={t('admin.forms.namePlaceholder')} /></FormField>
        <FormField label={t('admin.forms.code')} required error={errors.code} hint={t('admin.forms.codeHint')}><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase(), codeTouched: true })} /></FormField>
        <FormField label={t('admin.forms.usedAs')}><Select value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })}>{FORM_USES.map((u) => <option key={u.value} value={u.value}>{t(`admin.forms.uses.${u.value}`, { defaultValue: u.label })}</option>)}</Select></FormField>
      </div>
    </Modal>
  )
}

function FormList() {
  const { t } = useTranslation('admin')
  const navigate = useNavigate()
  const { dateTime } = useFormat()
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  const { data = [], isLoading } = useQuery({ queryKey: ['forms', status], queryFn: () => fetchForms(status ? { status } : undefined) })
  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('admin.forms.title')} subtitle={t('admin.forms.subtitle')}
        actions={hasPermission('core.forms.create') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('admin.forms.newForm')}</Button>} />
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={status} onChange={setStatus} tabs={[{ value: '', label: t('admin.forms.tabs.inUse') }, { value: 'DRAFT', label: t('admin.forms.tabs.drafts') }, { value: 'ARCHIVED', label: t('admin.forms.tabs.archived') }]} />
        <div className="p-4">
          <DataTable
            rows={data}
            loading={isLoading}
            onRowClick={(r) => navigate(`/core/forms/${r.id}`)}
            columns={[
              { key: 'name', header: t('admin.forms.cols.form'), mobilePrimary: true, render: (v, r) => <div><p className="text-sm font-medium text-ink">{v}</p><p className="text-xs text-ink-faint font-mono-num">{r.code}</p></div> },
              { key: 'useLabel', header: t('admin.forms.usedAs'), render: (v, r) => (r.use ? t(`admin.forms.uses.${r.use}`, { defaultValue: v ?? r.use }) : v) },
              { key: 'fields', header: t('admin.forms.cols.fields'), align: 'right', render: (v, r) => t('admin.forms.fieldsInSections', { fields: v, count: r.sections }) },
              { key: 'status', header: t('common.status'), render: (v, r) => <div className="flex items-center gap-2"><StatusPill tone={FORM_STATUSES[v]?.tone}>{t(`admin.forms.status.${v}`, { defaultValue: FORM_STATUSES[v]?.label ?? v })}{r.version ? ` · v${r.version}` : ''}</StatusPill>{v === 'PUBLISHED' && r.changedSincePublish && <span className="text-[11px] text-amber-700">{t('admin.forms.changesNotPublished')}</span>}</div> },
              { key: 'updatedAt', header: t('admin.forms.cols.changed'), mobileHidden: true, render: (v, r) => <span className="text-xs text-ink-muted">{r.updatedBy ? `${r.updatedBy} · ` : ''}{dateTime(v)}</span> },
            ]}
            emptyIcon={ClipboardList}
            emptyTitle={t('admin.forms.empty')}
          />
        </div>
      </div>
      {adding && <NewFormModal onClose={() => setAdding(false)} />}
    </PageContainer>
  )
}

// ───────────────────────────────────────────────────────── editor

function FieldEditor({ f, before, errors, onChange }) {
  const { t } = useTranslation('admin')
  const set = (patch) => onChange({ ...f, ...patch })
  const showIfOptions = before.filter((x) => !COMPUTED_TYPES.includes(x.type))
  return (
    <div className="grid sm:grid-cols-2 gap-3 p-3 bg-bg/60 border-t border-border">
      <div className="sm:col-span-2">
        <FormField label={f.type === 'INFO' ? t('admin.forms.field.text') : t('admin.forms.field.questionOrLabel')} error={errors.label}>
          {f.type === 'INFO' ? <Textarea rows={2} value={f.label} onChange={(e) => set({ label: e.target.value })} />
            : <Input value={f.label} onChange={(e) => set({ label: e.target.value, ...(f._auto ? { key: keyFrom(e.target.value) } : {}) })} placeholder={t('admin.forms.field.labelPlaceholder')} />}
        </FormField>
      </div>
      <FormField label={t('admin.forms.code')} error={errors.key} hint={t('admin.forms.field.codeHint')}><Input value={f.key} className="font-mono-num" onChange={(e) => set({ key: e.target.value.toUpperCase(), _auto: false })} /></FormField>
      <FormField label={t('admin.forms.field.type')}><Select value={f.type} onChange={(e) => set({ type: e.target.value })}>{FIELD_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`admin.forms.fieldTypes.${x.value}`, { defaultValue: x.label })}</option>)}</Select></FormField>
      {!COMPUTED_TYPES.includes(f.type) && <div className="flex items-end pb-2"><Switch checked={!!f.required} onChange={(required) => set({ required })} label={t('admin.forms.field.required')} /><span className="ms-2 text-sm text-ink-muted">{t('admin.forms.field.mustAnswer')}</span></div>}
      {f.type !== 'INFO' && <FormField label={t('admin.forms.field.helpText')}><Input value={f.help ?? ''} onChange={(e) => set({ help: e.target.value })} placeholder={t('admin.forms.field.helpPlaceholder')} /></FormField>}
      {['NUMBER', 'CALC'].includes(f.type) && <FormField label={t('admin.forms.field.unit')}><Input value={f.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} placeholder={t('admin.forms.field.unitPlaceholder')} /></FormField>}
      {f.type === 'NUMBER' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('admin.forms.field.min')}><Input inputMode="decimal" value={f.min ?? ''} onChange={(e) => set({ min: e.target.value })} /></FormField>
          <FormField label={t('admin.forms.field.max')} error={errors.max}><Input inputMode="decimal" value={f.max ?? ''} onChange={(e) => set({ max: e.target.value })} /></FormField>
        </div>
      )}
      {f.type === 'CALC' && (
        <>
          <div className="sm:col-span-2"><FormField label={t('admin.forms.field.formula')} error={errors.formula} hint={t('admin.forms.field.formulaHint')}><Input className="font-mono-num" value={f.formula ?? ''} onChange={(e) => set({ formula: e.target.value.toUpperCase() })} /></FormField></div>
          <FormField label={t('admin.forms.field.decimals')}><Input type="number" min="0" max="4" value={f.decimals ?? 1} onChange={(e) => set({ decimals: Number(e.target.value) })} /></FormField>
        </>
      )}
      {['SELECT', 'MULTI'].includes(f.type) && (
        <div className="sm:col-span-2"><FormField label={t('admin.forms.field.choices')} error={errors.options}><Textarea rows={4} value={(f.options ?? []).join('\n')} onChange={(e) => set({ options: e.target.value.split('\n') })} /></FormField></div>
      )}
      {f.type === 'SCORE' && (
        <div className="sm:col-span-2">
          <FormField label={t('admin.forms.field.answersPoints')} error={errors.options}>
            <div className="space-y-2">
              {(f.options ?? []).map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={o.label} placeholder={t('admin.forms.field.answer')} onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input className="!w-20" inputMode="numeric" value={o.points} placeholder={t('admin.forms.field.points')} onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)) })} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('admin.forms.field.removeAnswer')} onClick={() => set({ options: f.options.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ options: [...(f.options ?? []), { label: '', points: (f.options ?? []).length }] })}>{t('admin.forms.field.addAnswer')}</Button>
            </div>
          </FormField>
        </div>
      )}
      {f.type === 'TOTAL' && (
        <div className="sm:col-span-2">
          <FormField label={t('admin.forms.field.bands')} error={errors.of} hint={t('admin.forms.field.bandsHint')}>
            <div className="space-y-2">
              {(f.bands ?? []).map((b, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="!w-20" inputMode="numeric" value={b.min ?? ''} placeholder={t('admin.forms.field.from')} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} />
                  <Input className="!w-20" inputMode="numeric" value={b.max ?? ''} placeholder={t('admin.forms.field.to')} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)) })} />
                  <Input value={b.label} placeholder={t('admin.forms.field.bandPlaceholder')} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('admin.forms.field.removeBand')} onClick={() => set({ bands: f.bands.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ bands: [...(f.bands ?? []), { min: '', max: '', label: '' }] })}>{t('admin.forms.field.addBand')}</Button>
            </div>
          </FormField>
        </div>
      )}
      <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
        <FormField label={t('admin.forms.field.showOnlyIf')} error={errors.showIf}>
          <Select value={f.showIf?.field ?? ''} onChange={(e) => set({ showIf: e.target.value ? { field: e.target.value, equals: f.showIf?.equals ?? '' } : null })}>
            <option value="">{t('admin.forms.field.alwaysShow')}</option>
            {showIfOptions.map((x) => <option key={x.key} value={x.key}>{x.label || x.key}</option>)}
          </Select>
        </FormField>
        {f.showIf?.field && (
          <FormField label={t('admin.forms.field.isAnswered')} hint={t('admin.forms.field.isAnsweredHint')}>
            <Input value={[].concat(f.showIf.equals ?? '').join(', ')} onChange={(e) => { const parts = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); set({ showIf: { ...f.showIf, equals: parts.length > 1 ? parts : parts[0] ?? '' } }) }} />
          </FormField>
        )}
      </div>
    </div>
  )
}

function FormEditor({ id }) {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data: form, isLoading } = useQuery({ queryKey: ['form', id], queryFn: () => fetchForm(id) })
  const [draft, setDraft] = useState(null)
  const [open, setOpen] = useState(null) // "si:fi" of the field being edited
  const [tab, setTab] = useState('design')
  const [errors, setErrors] = useState({})
  const [preview, setPreview] = useState({})
  useEffect(() => { if (form) setDraft({ code: form.code, name: form.name, description: form.description ?? '', use: form.use, specialities: form.specialities ?? [], definition: form.definition }) }, [form])
  const canEdit = hasPermission('core.forms.edit') && form?.status !== 'ARCHIVED'
  const saved = form && draft && JSON.stringify(draft) === JSON.stringify({ code: form.code, name: form.name, description: form.description ?? '', use: form.use, specialities: form.specialities ?? [], definition: form.definition })
  const localErrors = useMemo(() => (draft ? checkFormDefinition(draft.definition) : {}), [draft])

  const refresh = (f) => { qc.setQueryData(['form', id], f); qc.invalidateQueries({ queryKey: ['forms'] }) }
  const save = useMutation({ mutationFn: () => saveForm(id, draft), onSuccess: (f) => { refresh(f); setErrors({}); showSuccess(t('common.saved')) }, onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) } })
  const publish = useMutation({
    mutationFn: async () => { if (!saved) await saveForm(id, draft); return publishForm(id) },
    onSuccess: (f) => { refresh(f); setErrors({}); showSuccess(t('admin.forms.published', { version: f.version })) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const dup = useMutation({ mutationFn: () => duplicateForm(id), onSuccess: (f) => { qc.invalidateQueries({ queryKey: ['forms'] }); navigate(`/core/forms/${f.id}`); showSuccess(t('admin.forms.copied')) }, onError: (e) => showError(e.message) })
  const archive = async (archived) => {
    if (archived && !(await confirm({ title: t('admin.forms.archiveConfirm.title', { name: form.name }), message: t('admin.forms.archiveConfirm.message'), confirmLabel: t('admin.forms.archive'), tone: 'danger' }))) return
    try { refresh(await archiveForm(id, archived)); showSuccess(archived ? t('admin.forms.archived') : t('admin.forms.backInUse')) } catch (e) { showError(e.message) }
  }

  if (isLoading || !draft) return <PageContainer><div className="h-96 rounded-xl bg-black/5 animate-pulse" /></PageContainer>
  const def = draft.definition
  const setDef = (definition) => setDraft({ ...draft, definition })
  const setSection = (si, patch) => setDef({ sections: def.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) })
  const allFields = def.sections.flatMap((s, si) => (s.fields ?? []).map((f, fi) => ({ f, si, fi })))
  const shown = { ...localErrors, ...errors }

  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={draft.name || t('admin.forms.cols.form')} subtitle={`${t(`admin.forms.uses.${draft.use}`, { defaultValue: FORM_USE_LABEL[draft.use] ?? draft.use })} · ${form.version ? `${t('admin.forms.versionPublished', { version: form.version, at: dateTime(form.publishedAt) })}${form.changedSincePublish ? ` · ${t('admin.forms.changesNotPublishedYet')}` : ''}` : t('admin.forms.neverPublished')}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button to="/core/forms" variant="ghost" icon={BackIcon}>{t('admin.forms.allForms')}</Button>
            {hasPermission('core.forms.create') && <Button variant="secondary" icon={Copy} loading={dup.isPending} onClick={() => dup.mutate()}>{t('admin.forms.copy')}</Button>}
            {hasPermission('core.forms.delete') && (form.status === 'ARCHIVED' ? <Button variant="secondary" icon={ArchiveRestore} onClick={() => archive(false)}>{t('admin.forms.bringBack')}</Button> : <Button variant="ghost" icon={Archive} onClick={() => archive(true)}>{t('admin.forms.archive')}</Button>)}
            {canEdit && <Button variant="secondary" icon={Check} disabled={saved} loading={save.isPending} onClick={() => save.mutate()}>{t('admin.forms.saveDraft')}</Button>}
            {canEdit && hasPermission('core.forms.publish') && <Button icon={Rocket} loading={publish.isPending} disabled={saved && !form.changedSincePublish && form.version > 0} onClick={() => publish.mutate()}>{t('admin.forms.publish')}</Button>}
          </div>
        )} />
      {form.status === 'ARCHIVED' && <Note tone="warning">{t('admin.forms.archivedNote')}</Note>}
      {Object.keys(errors).length > 0 && <Note tone="danger">{t('admin.forms.fixMarked')}</Note>}

      <div className="rounded-xl border border-border bg-surface shadow-card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: 'design', label: t('admin.forms.tabs.design') }, { value: 'preview', label: t('admin.forms.tabs.preview') }]} />
        <div className="p-4 space-y-4">
          {tab === 'preview' ? (
            <div className="max-w-3xl">
              <p className="text-xs text-ink-muted mb-3">{t('admin.forms.previewNote')}</p>
              <FormRenderer definition={def} values={preview} onChange={setPreview} />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-4 gap-3">
                <FormField label={t('common.name')} error={shown.name}><Input value={draft.name} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></FormField>
                <FormField label={t('admin.forms.code')} error={shown.code}><Input value={draft.code} disabled={!canEdit} className="font-mono-num" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></FormField>
                <FormField label={t('admin.forms.usedAs')}><Select value={draft.use} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, use: e.target.value })}>{FORM_USES.map((u) => <option key={u.value} value={u.value}>{t(`admin.forms.uses.${u.value}`, { defaultValue: u.label })}</option>)}</Select></FormField>
                <FormField label={t('admin.forms.specialities')} hint={t('admin.forms.commaSeparated')}><Input value={draft.specialities.join(', ')} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, specialities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></FormField>
                <div className="md:col-span-4"><FormField label={t('admin.forms.description')}><Input value={draft.description} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t('admin.forms.descriptionPlaceholder')} /></FormField></div>
              </div>

              {def.sections.map((s, si) => (
                <Panel key={si} title={(
                  <div className="flex items-center gap-2">
                    <Input value={s.title} disabled={!canEdit} onChange={(e) => setSection(si, { title: e.target.value })} placeholder={t('admin.forms.sectionTitle')} className={clsx('!h-8 max-w-xs font-semibold', shown[`sections.${si}.title`] && '!border-danger-500')} />
                    <SegmentedControl value={String(s.columns ?? 1)} onChange={(c) => canEdit && setSection(si, { columns: Number(c) })} options={[{ value: '1', label: t('admin.forms.oneCol') }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
                  </div>
                )} actions={canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={ArrowUp} aria-label={t('admin.forms.moveSectionUp')} disabled={si === 0} onClick={() => setDef({ sections: move(def.sections, si, -1) })} />
                    <Button size="sm" variant="ghost" icon={ArrowDown} aria-label={t('admin.forms.moveSectionDown')} disabled={si === def.sections.length - 1} onClick={() => setDef({ sections: move(def.sections, si, 1) })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('admin.forms.deleteSection')} onClick={() => setDef({ sections: def.sections.filter((_, i) => i !== si) })} />
                  </div>
                )} flush>
                  {shown[`sections.${si}.fields`] && <p className="px-4 pt-2 text-xs text-danger-600">{shown[`sections.${si}.fields`]}</p>}
                  <ul className="divide-y divide-border">
                    {(s.fields ?? []).map((f, fi) => {
                      const k = `${si}:${fi}`
                      const ferr = errorsUnder(shown, `sections.${si}.fields.${fi}.`)
                      const before = allFields.filter((x) => x.si < si || (x.si === si && x.fi < fi)).map((x) => x.f)
                      const setField = (nf) => setSection(si, { fields: s.fields.map((x, j) => (j === fi ? nf : x)) })
                      return (
                        <li key={fi}>
                          <div className="flex items-center gap-3 px-4 py-2.5">
                            <button type="button" className="flex-1 min-w-0 text-start" onClick={() => setOpen(open === k ? null : k)}>
                              <p className={clsx('text-sm truncate', f.label ? 'text-ink' : 'text-ink-faint')}>{f.label || t('admin.forms.untitledField')}{f.required && <span className="text-danger-500"> *</span>}</p>
                              <p className="text-[11px] text-ink-faint"><span className="font-mono-num">{f.key || '—'}</span> · {t(`admin.forms.fieldTypes.${f.type}`, { defaultValue: FIELD_TYPE_LABEL[f.type] ?? f.type })}{f.showIf?.field ? ` · ${t('admin.forms.onlyIf', { field: f.showIf.field })}` : ''}</p>
                            </button>
                            {Object.keys(ferr).length > 0 && <span className="text-[11px] text-danger-600">{t('admin.forms.needsFixing')}</span>}
                            {canEdit && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" icon={ArrowUp} aria-label={t('admin.forms.moveUp')} disabled={fi === 0} onClick={() => setSection(si, { fields: move(s.fields, fi, -1) })} />
                                <Button size="sm" variant="ghost" icon={ArrowDown} aria-label={t('admin.forms.moveDown')} disabled={fi === s.fields.length - 1} onClick={() => setSection(si, { fields: move(s.fields, fi, 1) })} />
                                <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('admin.forms.deleteField')} onClick={() => setSection(si, { fields: s.fields.filter((_, j) => j !== fi) })} />
                              </div>
                            )}
                          </div>
                          {open === k && canEdit && <FieldEditor f={f} before={before} errors={ferr} onChange={setField} />}
                        </li>
                      )
                    })}
                  </ul>
                  {canEdit && (
                    <div className="px-4 py-3 border-t border-border max-w-xs">
                      <Select value="" onChange={(e) => { if (!e.target.value) return; const fields = [...(s.fields ?? []), { key: '', label: '', type: e.target.value, _auto: true, ...(e.target.value === 'SCORE' ? { options: [{ label: '', points: 0 }, { label: '', points: 1 }] } : {}) }]; setSection(si, { fields }); setOpen(`${si}:${fields.length - 1}`) }}>
                        <option value="">{t('admin.forms.addField')}</option>
                        {FIELD_TYPES.map((x) => <option key={x.value} value={x.value}>{t(`admin.forms.fieldTypes.${x.value}`, { defaultValue: x.label })}</option>)}
                      </Select>
                    </div>
                  )}
                </Panel>
              ))}
              {shown.sections && <p className="text-xs text-danger-600">{shown.sections}</p>}
              {canEdit && <Button variant="secondary" icon={Plus} onClick={() => setDef({ sections: [...def.sections, { title: '', columns: 2, fields: [] }] })}>{t('admin.forms.addSection')}</Button>}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  )
}

/** Administration › Form builder (docs/00 §7 E6). */
export default function Forms() {
  const { id } = useParams()
  return id ? <FormEditor id={id} /> : <FormList />
}
