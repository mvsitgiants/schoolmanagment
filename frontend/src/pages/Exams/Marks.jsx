import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, CircleDashed, ClipboardList, Lock, LockOpen, NotebookPen, PencilLine, Save } from 'lucide-react'
import { SHEET_STATUS, checkMark } from '@schoolgiant/shared'
import { ColorChip, DataTable, DateCell, Fraction, Input, Note, PageContainer, PageHeader, PersonCell, StatCardRow, StatusPill, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import useExamPick from '../../components/exams/useExamPick'
import { fetchMarkSheet, fetchMarksBoard, lockMarkSheet, saveMarkSheet, unlockMarkSheet } from '../../api/exams'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const sheetLabel = (t, s) => t(`exams.sheetStatus.${s}`, SHEET_STATUS[s]?.label ?? s)

/** One paper × section: a row per student with the marks box, Absent and Not taking. */
function SheetView({ paperId, sectionId, onBack }) {
  const { t } = useTranslation('exams')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const key = ['mark-sheet', paperId, sectionId]
  const { data: sheet, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchMarkSheet(paperId, sectionId) })
  const [rows, setRows] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  useEffect(() => { if (sheet) setRows(Object.fromEntries(sheet.students.map((s) => [s.id, { marks: s.marks ?? '', grade: s.grade ?? '', absent: s.absent, exempt: s.exempt }]))) }, [sheet])
  const set = (id, k, v) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }))
  const paper = sheet?.paper
  const local = useMemo(() => {
    if (!paper) return {}
    return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, checkMark({ ...r, marks: r.marks === '' ? null : r.marks }, paper)]).filter(([, e]) => e))
  }, [rows, paper])
  const dirty = sheet && sheet.students.some((s) => {
    const r = rows[s.id]
    return r && (String(r.marks ?? '') !== String(s.marks ?? '') || (r.grade ?? '') !== (s.grade ?? '') || r.absent !== s.absent || r.exempt !== s.exempt)
  })
  const after = (data, msg) => { qc.setQueryData(key, data); qc.invalidateQueries({ queryKey: ['marks-board'] }); setServerErrors({}); showSuccess(msg) }
  const entries = () => sheet.students.map((s) => {
    const r = rows[s.id] ?? {}
    return { studentId: s.id, marks: r.marks === '' || r.marks === undefined ? null : Number(r.marks), grade: r.grade || undefined, absent: !!r.absent, exempt: !!r.exempt }
  })
  const fail = (e) => {
    const fields = e.response?.data?.details?.fields ?? {}
    setServerErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => { const i = Number(k.split('.')[1]); return [sheet.students[i]?.id, v] })))
    showError(e.message)
  }
  const save = useMutation({ mutationFn: () => saveMarkSheet(paperId, sectionId, entries()), onSuccess: (d) => after(d, t('exams.marks.saved')), onError: fail })
  const lock = useMutation({ mutationFn: async () => { if (dirty) await saveMarkSheet(paperId, sectionId, entries()); return lockMarkSheet(paperId, sectionId) }, onSuccess: (d) => after(d, t('exams.marks.locked')), onError: fail })
  const unlock = useMutation({ mutationFn: (reason) => unlockMarkSheet(paperId, sectionId, reason), onSuccess: (d) => after(d, t('exams.marks.unlocked')), onError: (e) => showError(e.message) })

  if (isLoading) return <p className="text-sm text-ink-faint">{t('exams.loading')}</p>
  if (error || !sheet) return <Note tone="warning">{error?.message}</Note>
  const ro = !sheet.canEdit
  const filled = sheet.students.filter((s) => { const r = rows[s.id]; return r && (r.absent || r.exempt || (paper.gradeOnly ? r.grade : r.marks !== '')) }).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('exams.marks.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{paper.subject} · {sheet.section.label}</p>
            <p className="text-xs text-ink-muted">
              {paper.gradeOnly ? t('exams.marks.gradeOnly') : t('exams.marks.outOf', { max: paper.maxMarks, pass: paper.passMarks })}
              {sheet.enteredBy ? ` · ${t('exams.marks.enteredBy', { name: sheet.enteredBy, at: dateTime(sheet.enteredAt) })}` : ''}
            </p>
          </div>
          <StatusPill tone={SHEET_STATUS[sheet.status]?.tone}>{sheetLabel(t, sheet.status)}</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          {!ro && <Button variant="secondary" icon={Save} loading={save.isPending} disabled={!dirty || Object.keys(local).length > 0} onClick={() => save.mutate()}>{t('exams.marks.save')}</Button>}
          {sheet.canLock && <Button icon={Lock} loading={lock.isPending} disabled={filled < sheet.students.length || Object.keys(local).length > 0} onClick={() => lock.mutate()}>{t('exams.marks.lock')}</Button>}
          {sheet.canUnlock && <Button variant="secondary" icon={LockOpen} loading={unlock.isPending}
            onClick={async () => { const reason = await prompt({ title: t('exams.marks.unlockConfirm.title'), message: t('exams.marks.unlockConfirm.message'), label: t('exams.marks.unlockReason'), required: true }); if (reason) unlock.mutate(reason) }}>
            {t('exams.marks.unlock')}
          </Button>}
        </div>
      </div>
      {ro && <Note tone={sheet.status === 'LOCKED' ? 'success' : 'warning'}>{t(`exams.marks.blocked.${sheet.blockedBy ?? 'LOCKED'}`)}{sheet.lockedBy && sheet.status === 'LOCKED' ? ` ${t('exams.marks.lockedBy', { name: sheet.lockedBy, at: dateTime(sheet.lockedAt) })}` : ''}</Note>}
      {!ro && <Note>{t('exams.marks.hint', { filled, total: sheet.students.length })}</Note>}
      <DataTable
        rows={sheet.students}
        dense
        columns={[
          { key: 'rollNo', header: t('exams.roll'), width: 60, render: (v) => <span className="font-mono-num">{v ?? '—'}</span> },
          { key: 'name', header: t('exams.student'), mobilePrimary: true, render: (v, s) => <PersonCell name={v} sub={s.admissionNo} size={28} /> },
          { key: 'marks', header: paper.gradeOnly ? t('exams.marks.grade') : t('exams.marks.marks'), width: 150, render: (_, s) => {
            const r = rows[s.id] ?? {}
            const off = ro || r.absent || r.exempt
            const err = local[s.id] || serverErrors[s.id]
            return (
              <div>
                {paper.gradeOnly
                  ? <Input className="w-24 uppercase" maxLength={4} value={r.grade ?? ''} disabled={off} onChange={(e) => set(s.id, 'grade', e.target.value.toUpperCase())} aria-label={t('exams.marks.grade')} />
                  : <Input className="w-24 text-right" type="number" inputMode="decimal" min="0" max={paper.maxMarks} step="0.5" value={r.marks ?? ''} disabled={off} error={!!err} onChange={(e) => set(s.id, 'marks', e.target.value)} aria-label={t('exams.marks.marks')} />}
                {err && <p className="text-xs text-danger-600 mt-0.5">{err}</p>}
              </div>
            )
          } },
          { key: 'absent', header: t('exams.marks.absent'), width: 90, render: (_, s) => (
            <span className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={!!rows[s.id]?.absent} disabled={ro} onChange={(e) => setRows((x) => ({ ...x, [s.id]: { ...x[s.id], absent: e.target.checked, exempt: e.target.checked ? false : x[s.id]?.exempt } }))} aria-label={t('exams.marks.absent')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
              {s.hallAbsent && <span title={t('exams.marks.hallAbsentHint')} className="rounded bg-danger-50 px-1 text-[10px] font-semibold text-danger-600">{t('exams.marks.hallAbsent')}</span>}
            </span>
          ) },
          { key: 'exempt', header: t('exams.marks.exempt'), width: 110, render: (_, s) => (
            <input type="checkbox" checked={!!rows[s.id]?.exempt} disabled={ro} onChange={(e) => setRows((x) => ({ ...x, [s.id]: { ...x[s.id], exempt: e.target.checked, absent: e.target.checked ? false : x[s.id]?.absent } }))} aria-label={t('exams.marks.exempt')} className="rounded border-border text-brand-500 focus:ring-brand-500" />
          ) },
        ]}
        emptyIcon={NotebookPen} emptyTitle={t('exams.marks.noStudents')}
      />
    </div>
  )
}

export default function Marks() {
  const { t } = useTranslation('exams')
  const { exam, examId, chips, noExams } = useExamPick({ withSection: false })
  const [open, setOpen] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const { data: board, isLoading, error, refetch } = useQuery({ queryKey: ['marks-board', examId], queryFn: () => fetchMarksBoard(examId), enabled: !!examId && !open })
  const show = setOpen
  const sheets = board?.sheets ?? []
  const countOf = (s) => sheets.filter((x) => x.status === s).length
  const pick = (s) => setStatusFilter((cur) => (cur === s ? '' : s))

  return (
    <PageContainer>
      <PageHeader icon={NotebookPen} title={t('exams.marks.title')} subtitle={t('exams.marks.subtitle')} />
      {noExams && <Note className="mb-4">{t('exams.pick.noneScheduled')}</Note>}
      {!open && sheets.length > 0 && <StatCardRow className="mb-4" items={[
        { icon: ClipboardList, tone: 'brand', label: t('exams.marks.summary.sheets'), value: sheets.length, onClick: () => setStatusFilter('') },
        { icon: Lock, tone: 'success', label: sheetLabel(t, 'LOCKED'), value: countOf('LOCKED'), progress: (countOf('LOCKED') / sheets.length) * 100, onClick: () => pick('LOCKED') },
        { icon: PencilLine, tone: 'warning', label: sheetLabel(t, 'OPEN'), value: countOf('OPEN'), onClick: () => pick('OPEN') },
        { icon: CircleDashed, tone: countOf('NOT_STARTED') ? 'danger' : 'neutral', label: sheetLabel(t, 'NOT_STARTED'), value: countOf('NOT_STARTED'), onClick: () => pick('NOT_STARTED') },
      ]} />}
      {open ? <SheetView paperId={open.paperId} sectionId={open.sectionId} onBack={() => show(null)} /> : (
        <DataTable
          rows={statusFilter ? sheets.filter((x) => x.status === statusFilter) : sheets}
          rowKey="key"
          loading={isLoading}
          error={error}
          onRetry={refetch}
          toolbar={<div className="flex flex-wrap justify-end gap-2">{chips}</div>}
          rowTone={(r) => (r.status === 'LOCKED' ? 'success' : undefined)}
          columns={[
            { key: 'section', header: t('exams.marks.section'), mobilePrimary: true, render: (v, r) => <ColorChip label={r.sectionShort} /> },
            { key: 'subject', header: t('exams.marks.subject'), render: (v) => <ColorChip label={v} dot /> },
            { key: 'date', header: t('exams.marks.date'), nowrap: true, mobileHidden: true, render: (v) => <DateCell value={v} /> },
            { key: 'entered', header: t('exams.marks.entered'), align: 'right', render: (v, r) => <Fraction value={v} max={r.strength} /> },
            { key: 'status', header: t('exams.marks.status'), render: (v, r) => <div><StatusPill tone={SHEET_STATUS[v]?.tone}>{sheetLabel(t, v)}</StatusPill>{r.enteredBy && <p className="text-xs text-ink-faint mt-0.5">{r.enteredBy}</p>}</div> },
          ]}
          onRowClick={(r) => show({ paperId: r.paperId, sectionId: r.sectionId })}
          emptyIcon={NotebookPen} emptyTitle={exam ? t('exams.marks.empty') : t('exams.pick.pickFirst')} emptyHint={exam ? t('exams.marks.emptyHint') : undefined}
        />
      )}
    </PageContainer>
  )
}
