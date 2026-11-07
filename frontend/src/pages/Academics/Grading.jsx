import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, Copy, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { DEFAULT_GRADING_BANDS, GRADING_KINDS, checkGradingBands, gradeFor } from '@schoolgiant/shared'
import { DataTable, FormField, HeaderButton, Input, Modal, PageContainer, PageHeader, Panel, Select, StatusPill, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import { createGrading, deleteGrading, fetchGrading, makeGradingDefault, updateGrading } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const blankBand = { min: '', max: '', grade: '', points: '', remark: '' }

function GradingForm({ scheme, onClose, onSaved }) {
  const { t } = useTranslation('academics')
  const { showError } = useSnackbar()
  const [form, setForm] = useState(() => ({ name: '', kind: 'GRADES', ...scheme, bands: (scheme?.bands ?? DEFAULT_GRADING_BANDS).map((b) => ({ ...blankBand, ...b })) }))
  const [errors, setErrors] = useState({})
  const [tryPct, setTryPct] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setBand = (i, k) => (e) => setForm((f) => ({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, [k]: e.target.value } : b)) }))
  const local = checkGradingBands(form.bands)
  const shown = { ...local, ...errors }
  const hit = tryPct === '' ? null : gradeFor(form.bands, tryPct)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name, kind: form.kind,
        bands: form.bands.map((b) => ({ min: Number(b.min), max: Number(b.max), grade: b.grade, points: b.points === '' ? null : Number(b.points), remark: b.remark || undefined })),
      }
      return scheme?.id ? updateGrading(scheme.id, body) : createGrading(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  const columns = [
    { key: 'min', header: t('academics.grading.from'), width: 90, render: (_, b) => <Input type="number" value={b.min} onChange={setBand(b.i, 'min')} aria-label={t('academics.grading.from')} /> },
    { key: 'max', header: t('academics.grading.to'), width: 90, render: (_, b) => <Input type="number" value={b.max} onChange={setBand(b.i, 'max')} aria-label={t('academics.grading.to')} /> },
    { key: 'grade', header: t('academics.grading.grade'), width: 90, render: (_, b) => <Input value={b.grade} onChange={setBand(b.i, 'grade')} maxLength={10} aria-label={t('academics.grading.grade')} /> },
    ...(form.kind === 'GPA' || form.bands.some((b) => b.points !== '' && b.points != null) ? [{ key: 'points', header: t('academics.grading.points'), width: 90, render: (_, b) => <Input type="number" value={b.points ?? ''} onChange={setBand(b.i, 'points')} aria-label={t('academics.grading.points')} /> }] : []),
    { key: 'remark', header: t('academics.grading.remark'), render: (_, b) => <Input value={b.remark ?? ''} onChange={setBand(b.i, 'remark')} maxLength={60} aria-label={t('academics.grading.remark')} /> },
    { key: 'x', header: '', width: 50, render: (_, b) => <Button size="sm" variant="ghost" icon={X} aria-label={t('academics.grading.removeBand')} onClick={() => setForm((f) => ({ ...f, bands: f.bands.filter((_, j) => j !== b.i) }))} /> },
  ]
  const bandErrors = Object.entries(shown).filter(([k]) => k.startsWith('bands')).map(([k, v]) => {
    const i = Number(k.split('.')[1])
    return Number.isFinite(i) ? `${form.bands[i]?.grade || t('academics.grading.rowN', { n: i + 1 })}: ${v}` : v
  })
  return (
    <Modal open onClose={onClose} size="xl" title={scheme?.id ? t('academics.grading.editTitle', { name: scheme.name }) : t('academics.grading.newScheme')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.name || Object.keys(local).length > 0} onClick={() => save.mutate()}>{t('actions.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('academics.grading.name')} required error={errors.name}><Input value={form.name} onChange={set('name')} placeholder={t('academics.grading.namePlaceholder')} /></FormField>
        <FormField label={t('academics.grading.kind')}>
          <Select value={form.kind} onChange={set('kind')}>{GRADING_KINDS.map((k) => <option key={k.value} value={k.value}>{t(`academics.gradingKinds.${k.value}`, k.label)}</option>)}</Select>
        </FormField>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-ink">{t('academics.grading.bands')}</p>
          <Button size="sm" variant="ghost" icon={Plus} disabled={form.bands.length >= 20} onClick={() => setForm((f) => ({ ...f, bands: [...f.bands, { ...blankBand }] }))}>{t('academics.grading.addBand')}</Button>
        </div>
        <DataTable dense rows={form.bands.map((b, i) => ({ ...b, i, id: String(i) }))} columns={columns} emptyTitle={t('academics.grading.noBands')} />
        {bandErrors.length > 0 && <ul className="mt-2 text-xs text-danger-600 space-y-0.5">{bandErrors.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <FormField label={t('academics.grading.tryIt')} hint={t('academics.grading.tryItHint')}><Input type="number" value={tryPct} onChange={(e) => setTryPct(e.target.value)} placeholder="78.5" className="w-32" /></FormField>
        {tryPct !== '' && (hit
          ? <p className="text-sm text-ink pb-2">{t('academics.grading.tryResult', { pct: tryPct, grade: hit.grade })}{hit.remark ? ` · ${hit.remark}` : ''}</p>
          : <p className="text-sm text-ink-faint pb-2">{t('academics.grading.tryNone')}</p>)}
      </div>
    </Modal>
  )
}

export default function Grading() {
  const { t } = useTranslation('academics')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showSuccess, showError } = useSnackbar()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['grading'], queryFn: fetchGrading })
  const [editing, setEditing] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['grading'] })
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('academics.grading.edit')

  return (
    <PageContainer>
      <PageHeader icon={Award} title={t('academics.grading.title')} subtitle={t('academics.grading.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="create" onClick={() => setEditing('new')}>{t('academics.grading.newScheme')}</HeaderButton>} />
      {isLoading && <p className="text-sm text-ink-faint">{t('academics.loading')}</p>}
      <div className="grid lg:grid-cols-2 gap-6">
        {rows.map((g) => (
          <Panel key={g.id} title={g.name}
            subtitle={[t(`academics.gradingKinds.${g.kind}`, g.kind), t('academics.grading.usedBy', { count: g.classCount })].join(' · ')}
            actions={<div className="flex items-center gap-1">
              {g.isDefault ? <StatusPill tone="success">{t('academics.grading.default')}</StatusPill> : canEdit && (
                <Button size="sm" variant="ghost" icon={Star} onClick={() => act.mutate({ fn: () => makeGradingDefault(g.id), done: t('academics.grading.nowDefault', { name: g.name }) })}>{t('academics.grading.makeDefault')}</Button>
              )}
              {hasPermission('academics.grading.create') && <Button size="sm" variant="ghost" icon={Copy} title={t('academics.grading.copy')} aria-label={t('academics.grading.copy')} onClick={() => setEditing({ ...g, id: undefined, name: t('academics.grading.copyName', { name: g.name }) })} />}
              {canEdit && <Button size="sm" variant="ghost" icon={Pencil} title={t('actions.edit')} aria-label={t('actions.edit')} onClick={() => setEditing(g)} />}
              {hasPermission('academics.grading.delete') && !g.isDefault && <Button size="sm" variant="ghost" icon={Trash2} title={t('actions.delete')} aria-label={t('actions.delete')}
                onClick={async () => { if (await confirm({ title: t('academics.grading.deleteConfirm', { name: g.name }), message: t('academics.cantUndo'), tone: 'danger', confirmLabel: t('actions.delete') })) act.mutate({ fn: () => deleteGrading(g.id), done: t('academics.grading.deleted') }) }} />}
            </div>}>
            <DataTable dense rows={g.bands.map((b, i) => ({ ...b, id: String(i) }))} columns={[
              { key: 'grade', header: t('academics.grading.grade'), render: (v) => <span className="font-semibold text-ink">{v}</span> },
              { key: 'min', header: t('academics.grading.range'), render: (v, b) => <span className="font-mono-num text-sm">{v}–{b.max}%</span> },
              ...(g.bands.some((b) => b.points != null) ? [{ key: 'points', header: t('academics.grading.points'), align: 'right' }] : []),
              { key: 'remark', header: t('academics.grading.remark'), render: (v) => v || <span className="text-ink-faint">—</span> },
            ]} />
          </Panel>
        ))}
      </div>
      {editing && <GradingForm scheme={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); showSuccess(t('academics.grading.saved')); setEditing(null) }} />}
    </PageContainer>
  )
}
