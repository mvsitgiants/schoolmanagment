import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, NotebookPen, Plus, Save, UserPlus } from 'lucide-react'
import { DataTable, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, Textarea, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useCycle from '../../components/admissions/useCycle'
import { assignTest, createTest, fetchTestMarks, fetchTests, saveTestMarks, updateTest } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function TestForm({ cycle, test, onClose, onSaved }) {
  const { t } = useTranslation('admissions')
  const { showError } = useSnackbar()
  const [form, setForm] = useState({ name: test?.name ?? '', classIds: test?.classIds ?? [], date: test?.date ?? '', time: test?.time ?? '10:00', venue: test?.venue ?? '', maxMarks: String(test?.maxMarks ?? 50), instructions: test?.instructions ?? '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = useMutation({ mutationFn: () => (test ? updateTest(test.id, { ...form, cycleId: cycle.id }) : createTest({ ...form, cycleId: cycle.id })), onSuccess: onSaved, onError: (e) => showError(e.message) })
  return (
    <Modal open onClose={onClose} size="lg" title={test ? t('admissions.tests.editTitle') : t('admissions.tests.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={form.name.trim().length < 2 || !form.date || !form.classIds.length} onClick={() => save.mutate()}>{t('admissions.tests.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><FormField label={t('admissions.tests.name')} required><Input value={form.name} onChange={set('name')} placeholder={t('admissions.tests.namePlaceholder')} /></FormField></div>
        <div className="sm:col-span-2">
          <p className="text-xs font-medium text-ink-muted mb-1.5">{t('admissions.tests.classes')}</p>
          <div className="flex flex-wrap gap-2">
            {cycle.classes.map((c) => (
              <label key={c.classId} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm cursor-pointer hover:bg-bg">
                <input type="checkbox" checked={form.classIds.includes(c.classId)} onChange={() => setForm((f) => ({ ...f, classIds: f.classIds.includes(c.classId) ? f.classIds.filter((x) => x !== c.classId) : [...f.classIds, c.classId] }))} className="rounded border-border text-brand-500 focus:ring-brand-500" />{c.className}
              </label>
            ))}
          </div>
        </div>
        <FormField label={t('admissions.tests.date')} required><Input type="date" value={form.date} onChange={set('date')} /></FormField>
        <FormField label={t('admissions.tests.time')}><Input type="time" value={form.time} onChange={set('time')} /></FormField>
        <FormField label={t('admissions.tests.venue')}><Input value={form.venue} onChange={set('venue')} /></FormField>
        <FormField label={t('admissions.tests.maxMarks')}><Input type="number" min="1" value={form.maxMarks} onChange={set('maxMarks')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('admissions.tests.instructions')}><Textarea rows={2} value={form.instructions} onChange={set('instructions')} /></FormField></div>
      </div>
    </Modal>
  )
}

function MarksSheet({ testId, onBack }) {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading } = useQuery({ queryKey: ['test-marks', testId], queryFn: () => fetchTestMarks(testId) })
  const [rows, setRows] = useState({})
  useEffect(() => { if (data) setRows(Object.fromEntries(data.rows.map((r) => [r.id, { marks: r.marks ?? '', absent: r.absent }]))) }, [data])
  const after = (d) => { qc.setQueryData(['test-marks', testId], d); qc.invalidateQueries({ queryKey: ['admission-tests'] }); qc.invalidateQueries({ queryKey: ['applications'] }) }
  const save = useMutation({ mutationFn: () => saveTestMarks(testId, Object.entries(rows).map(([applicationId, r]) => ({ applicationId, marks: r.marks === '' ? null : Number(r.marks), absent: !!r.absent }))), onSuccess: (d) => { after(d); showSuccess(t('admissions.tests.marksSaved')) }, onError: (e) => showError(e.message) })
  const assign = useMutation({ mutationFn: () => assignTest(testId), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['test-marks', testId] }); showSuccess(t('admissions.tests.assigned', { count: r.assigned })) }, onError: (e) => showError(e.message) })
  if (isLoading || !data) return <p className="text-sm text-ink-faint">{t('admissions.loading')}</p>
  const canEdit = hasPermission('admissions.tests.edit')
  const test = data.test
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('admissions.tests.back')} />
          <div><p className="font-semibold text-ink">{test.name}</p><p className="text-xs text-ink-muted">{date(test.date)}{test.time ? ` · ${test.time}` : ''}{test.venue ? ` · ${test.venue}` : ''} · {t('admissions.tests.outOf', { max: test.maxMarks })}</p></div>
        </div>
        {canEdit && <div className="flex gap-2">
          <Button variant="secondary" icon={UserPlus} loading={assign.isPending} onClick={async () => { if (await confirm({ title: t('admissions.tests.assignTitle'), message: t('admissions.tests.assignHint'), confirmLabel: t('admissions.tests.assign') })) assign.mutate() }}>{t('admissions.tests.assign')}</Button>
          <Button icon={Save} loading={save.isPending} disabled={!data.rows.length} onClick={() => save.mutate()}>{t('admissions.tests.saveMarks')}</Button>
        </div>}
      </div>
      <DataTable
        rows={data.rows}
        dense
        columns={[
          { key: 'applicationNo', header: t('admissions.applications.no'), render: (v) => <span className="font-mono-num">{v}</span> },
          { key: 'childName', header: t('admissions.enquiries.child'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{r.className}</p></div> },
          { key: 'marks', header: t('admissions.tests.marks'), width: 140, render: (_, r) => <Input type="number" min="0" max={test.maxMarks} className="w-24 text-right" disabled={!canEdit || rows[r.id]?.absent} value={rows[r.id]?.marks ?? ''} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...x[r.id], marks: e.target.value } }))} aria-label={t('admissions.tests.marks')} /> },
          { key: 'absent', header: t('admissions.tests.absent'), width: 90, render: (_, r) => <input type="checkbox" disabled={!canEdit} checked={!!rows[r.id]?.absent} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...x[r.id], absent: e.target.checked } }))} aria-label={t('admissions.tests.absent')} className="rounded border-border text-brand-500 focus:ring-brand-500" /> },
        ]}
        emptyIcon={NotebookPen} emptyTitle={t('admissions.tests.noApplicants')} emptyHint={t('admissions.tests.noApplicantsHint')}
      />
    </div>
  )
}

export default function Tests() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess } = useSnackbar()
  const { cycle, chip } = useCycle()
  const [editing, setEditing] = useState(null)
  const [openId, setOpenId] = useState(null)
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['admission-tests', cycle?.id], queryFn: () => fetchTests(cycle.id), enabled: !!cycle })
  return (
    <PageContainer>
      <PageHeader icon={NotebookPen} title={t('admissions.tests.title')} subtitle={t('admissions.tests.subtitle')}
        actions={!openId && cycle && <HeaderButton icon={Plus} variant="primary" requires="admissions.tests.create" onClick={() => setEditing('new')}>{t('admissions.tests.new')}</HeaderButton>} />
      {!cycle && <Note tone="warning">{t('admissions.noCycles')}</Note>}
      {openId ? <MarksSheet testId={openId} onBack={() => setOpenId(null)} /> : cycle && (
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          toolbar={<div className="flex justify-end">{chip}</div>}
          columns={[
            { key: 'name', header: t('admissions.tests.name'), mobilePrimary: true, render: (v, r) => <div><p className="font-medium text-ink">{v}</p><p className="text-xs text-ink-faint">{r.classes.join(', ')}</p></div> },
            { key: 'date', header: t('admissions.tests.date'), nowrap: true, render: (v, r) => `${date(v)}${r.time ? ` · ${r.time}` : ''}` },
            { key: 'venue', header: t('admissions.tests.venue'), mobileHidden: true, render: (v) => v ?? '—' },
            { key: 'applicants', header: t('admissions.tests.applicants'), align: 'right' },
            { key: 'marked', header: t('admissions.tests.marked'), align: 'right', render: (v, r) => `${v} / ${r.applicants}` },
            { key: 'id', header: '', align: 'right', width: 80, render: (_, r) => hasPermission('admissions.tests.edit') && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(r) }}>{t('admissions.tests.edit')}</Button> },
          ]}
          onRowClick={(r) => setOpenId(r.id)}
          emptyIcon={NotebookPen} emptyTitle={t('admissions.tests.empty')}
        />
      )}
      {editing && cycle && <TestForm cycle={cycle} test={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admission-tests'] }); setEditing(null); showSuccess(t('admissions.tests.saved')) }} />}
    </PageContainer>
  )
}
