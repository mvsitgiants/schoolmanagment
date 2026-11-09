import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCheck, ChevronLeft, NotebookPen, Plus, Save, UserPlus, UsersRound } from 'lucide-react'
import clsx from 'clsx'
import { CodeBadge, ColorChip, DataTable, DateCell, FormField, HeaderButton, Input, LevelBar, Modal, Note, PANEL, PageContainer, PageHeader, PersonCell, SideNav, SideNavLayout, StatCardRow, Textarea, localIso, pillClass, useConfirm } from '../../components/system'
import Button from '../../components/ui/Button'
import useCycle from '../../components/admissions/useCycle'
import { assignTest, createTest, fetchTestMarks, fetchTests, saveTestMarks, updateTest } from '../../api/admissions'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useIsMobile } from '../../hooks/useMediaQuery'

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
  const isMobile = useIsMobile()
  if (isLoading || !data) return <p className="text-sm text-ink-faint">{t('admissions.loading')}</p>
  const canEdit = hasPermission('admissions.tests.edit')
  const test = data.test
  const setRow = (id, patch) => setRows((x) => ({ ...x, [id]: { ...x[id], ...patch } }))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('admissions.tests.back')} title={t('admissions.tests.back')} />
          <div className="min-w-0"><p className="font-semibold text-ink">{test.name}</p><p className="text-xs text-ink-muted">{date(test.date)}{test.time ? ` · ${test.time}` : ''}{test.venue ? ` · ${test.venue}` : ''} · {t('admissions.tests.outOf', { max: test.maxMarks })}</p></div>
        </div>
        {canEdit && <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={UserPlus} loading={assign.isPending} onClick={async () => { if (await confirm({ title: t('admissions.tests.assignTitle'), message: t('admissions.tests.assignHint'), confirmLabel: t('admissions.tests.assign') })) assign.mutate() }}>{t('admissions.tests.assign')}</Button>
          <Button icon={Save} loading={save.isPending} disabled={!data.rows.length} onClick={() => save.mutate()}>{t('admissions.tests.saveMarks')}</Button>
        </div>}
      </div>
      {isMobile && data.rows.length > 0 ? (
        // a phone gets one line per applicant with the marks box and an absent toggle (inputs can't sit in a table's tap-to-expand row)
        <ul className={clsx(PANEL, 'divide-y divide-border overflow-hidden')}>
          {data.rows.map((r) => {
            const absent = !!rows[r.id]?.absent
            return (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-ink line-clamp-2">{r.childName}</p>
                  <p className="text-[11px] text-ink-faint truncate">{[r.className, r.applicationNo].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" aria-pressed={absent} disabled={!canEdit} aria-label={`${r.childName} ${t('admissions.tests.absent')}`} title={t('admissions.tests.absent')}
                  onClick={() => setRow(r.id, { absent: !absent })}
                  className={clsx(pillClass(absent), 'min-w-[44px] justify-center px-2 disabled:opacity-50', absent && 'border-danger-200 bg-danger-50 text-danger-600')}>
                  {t('admissions.tests.absentShort')}
                </button>
                <Input className="w-[72px] text-right" type="number" inputMode="decimal" min="0" max={test.maxMarks} disabled={!canEdit || absent} value={rows[r.id]?.marks ?? ''}
                  onChange={(e) => setRow(r.id, { marks: e.target.value })} aria-label={`${r.childName} ${t('admissions.tests.marks')}`} enterKeyHint="next" />
              </li>
            )
          })}
          {canEdit && (
            // the save sits under a long list too, where the thumb ends up after the last mark
            <li className="p-3"><Button className="w-full" icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('admissions.tests.saveMarks')}</Button></li>
          )}
        </ul>
      ) : (
        <DataTable
          rows={data.rows}
          dense
          columns={[
            { key: 'applicationNo', header: t('admissions.applications.no'), render: (v) => <CodeBadge>{v}</CodeBadge> },
            { key: 'childName', header: t('admissions.enquiries.child'), mobilePrimary: true, render: (v, r) => <PersonCell name={v} sub={r.className} /> },
            { key: 'marks', header: t('admissions.tests.marks'), width: 140, render: (_, r) => <Input type="number" min="0" max={test.maxMarks} className="w-24 text-right" disabled={!canEdit || rows[r.id]?.absent} value={rows[r.id]?.marks ?? ''} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...x[r.id], marks: e.target.value } }))} aria-label={t('admissions.tests.marks')} /> },
            { key: 'absent', header: t('admissions.tests.absent'), width: 90, render: (_, r) => <input type="checkbox" disabled={!canEdit} checked={!!rows[r.id]?.absent} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...x[r.id], absent: e.target.checked } }))} aria-label={t('admissions.tests.absent')} className="rounded border-border text-brand-500 focus:ring-brand-500" /> },
          ]}
          emptyIcon={NotebookPen} emptyTitle={t('admissions.tests.noApplicants')} emptyHint={t('admissions.tests.noApplicantsHint')}
        />
      )}
    </div>
  )
}

export default function Tests() {
  const { t } = useTranslation('admissions')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { date } = useFormat()
  const { cycle, chip, isLoading: cyclesLoading } = useCycle()
  const [editing, setEditing] = useState(null)
  // the open test lives in the URL (?test=), so the phone's back button returns to the list
  const [params, setParams] = useSearchParams()
  const openId = params.get('test')
  const setOpenId = (id) => setParams(id ? { test: id } : {})
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ['admission-tests', cycle?.id], queryFn: () => fetchTests(cycle.id), enabled: !!cycle })
  const today = localIso(new Date())
  const applicants = rows.reduce((n, r) => n + r.applicants, 0)
  const marked = rows.reduce((n, r) => n + r.marked, 0)
  return (
    <PageContainer>
      <PageHeader icon={NotebookPen} title={t('admissions.tests.title')} subtitle={t('admissions.tests.subtitle')}
        actions={!openId && cycle && <HeaderButton icon={Plus} variant="primary" requires="admissions.tests.create" onClick={() => setEditing('new')}>{t('admissions.tests.new')}</HeaderButton>} />
      {!cycle && !cyclesLoading && <Note tone="warning">{t('admissions.noCycles')}</Note>}
      {!openId && rows.length > 0 && (
        <StatCardRow className="mb-4" items={[
          { icon: NotebookPen, tone: 'brand', label: t('admissions.tests.summary.tests'), value: rows.length, sub: t('admissions.tests.summary.upcoming', { count: rows.filter((r) => r.date >= today).length }) },
          { icon: UsersRound, tone: 'violet', label: t('admissions.tests.applicants'), value: applicants },
          { icon: CheckCheck, tone: applicants && marked >= applicants ? 'success' : 'warning', label: t('admissions.tests.marked'), value: marked, sub: t('admissions.tests.summary.ofApplicants', { count: applicants }), progress: applicants ? (marked / applicants) * 100 : undefined },
        ]} />
      )}
      {openId ? (
        <SideNavLayout nav={rows.length > 1 && (
          // the cycle's other tests stay one tap away while marking
          <SideNav title={t('admissions.tests.testsNav')} value={openId} onChange={setOpenId} items={rows.map((r) => ({
            id: r.id, label: r.name, icon: NotebookPen, hint: [date(r.date), r.time].filter(Boolean).join(' · '),
            count: r.applicants ? `${r.marked}/${r.applicants}` : undefined,
            progress: r.applicants ? { value: r.marked, max: r.applicants, kind: 'done' } : undefined,
          }))} />
        )}>
          <MarksSheet key={openId} testId={openId} onBack={() => setOpenId(null)} />
        </SideNavLayout>
      ) : cycle && (
        <DataTable
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          toolbar={<div className="flex justify-end">{chip}</div>}
          columns={[
            { key: 'name', header: t('admissions.tests.name'), render: (v, r) => (
              <div className="min-w-0">
                <p className="font-medium text-ink">{v}</p>
                <div className="mt-1 flex flex-wrap gap-1">{r.classes.map((c, i) => <ColorChip key={c} label={c} seed={r.classIds?.[i] ?? c} />)}</div>
              </div>
            ) },
            { key: 'date', header: t('admissions.tests.date'), nowrap: true, mobilePrimary: true, render: (v, r) => (
              <span className="block">
                <DateCell value={v} tone={v < today && r.marked < r.applicants ? 'danger' : v === today ? 'warning' : undefined} />
                {r.time && <span className="block text-[11px] text-ink-faint tabular-nums">{r.time}</span>}
              </span>
            ) },
            { key: 'venue', header: t('admissions.tests.venue'), mobileHidden: true, render: (v) => (v ? <span className="text-sm text-ink-muted">{v}</span> : <span className="text-ink-faint">—</span>) },
            { key: 'applicants', header: t('admissions.tests.applicants'), align: 'right', mobileHidden: true, render: (v) => <span className="font-semibold tabular-nums text-ink">{v}</span> },
            { key: 'marked', header: t('admissions.tests.marked'), align: 'right', mobileTrail: true, render: (v, r) => (r.applicants ? <LevelBar value={v} max={r.applicants} warnAt={r.applicants - 1} /> : <span className="text-ink-faint">—</span>) },
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
