import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarCheck, CheckCheck, ChevronLeft, LayoutGrid, UserCheck, UserX } from 'lucide-react'
import { ATTENDANCE_MARKS, countMarks } from '@schoolgiant/shared'
import { ColorChip, FormField, Input, Note, PageContainer, PageHeader, PersonCell, Select, StatCardRow, StatusPill, TONE } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAttendanceBoard, fetchSheet, saveSheet } from '../../api/attendance'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

const MARK_STYLE = {
  P: 'bg-success-500 text-white border-success-500',
  A: 'bg-danger-500 text-white border-danger-500',
  L: 'bg-amber-400 text-white border-amber-400',
  HD: 'bg-info-500 text-white border-info-500',
  LV: 'bg-ink-muted text-white border-ink-muted',
}

/** One section's sheet: a row per student with big mark buttons (phones first), then Save. */
function SheetView({ sectionId, date, period, onBack }) {
  const { t } = useTranslation('attendance')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const key = ['attendance-sheet', sectionId, date, period]
  const { data: sheet, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchSheet({ sectionId, date, period }) })
  const [marks, setMarks] = useState({})
  useEffect(() => { if (sheet) setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, s.status]))) }, [sheet])
  const counts = useMemo(() => countMarks(Object.values(marks).map((status) => ({ status }))), [marks])
  const dirty = sheet && sheet.students.some((s) => marks[s.id] !== s.status)
  const save = useMutation({
    mutationFn: () => saveSheet({ sectionId, date, period, entries: sheet.students.map((s) => ({ studentId: s.id, status: marks[s.id] })) }),
    onSuccess: (data) => {
      qc.setQueryData(key, data)
      qc.invalidateQueries({ queryKey: ['attendance-board'] })
      showSuccess(t('attendance.mark.saved', { present: counts.P + counts.L + counts.HD, absent: counts.A }))
    },
    onError: (e) => showError(e.message),
  })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('attendance.loading')}</p>
  if (error || !sheet) return <Note tone="warning">{error?.message}</Note>
  const readOnly = !sheet.canEdit
  const label = (m) => t(`attendance.marks.${m.value}`, m.label)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('attendance.mark.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{sheet.section.label}</p>
            <p className="text-xs text-ink-muted">{sheet.taken ? t('attendance.mark.takenBy', { name: sheet.updatedBy || sheet.takenBy, at: dateTime(sheet.updatedAt || sheet.takenAt) }) : t('attendance.mark.notTaken')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ATTENDANCE_MARKS.filter((m) => counts[m.value]).map((m) => <StatusPill key={m.value} tone={m.tone}>{label(m)} {counts[m.value]}</StatusPill>)}
        </div>
      </div>
      {!sheet.workingDay && <Note tone="warning" className="mb-3">{t('attendance.mark.notWorkingDay')}</Note>}
      {readOnly && <Note tone="info" className="mb-3">{t(`attendance.mark.readOnly.${sheet.reason}`, t('attendance.mark.readOnly.NO_PERMISSION'))}</Note>}
      {!sheet.students.length && <Note>{t('attendance.mark.noStudents')}</Note>}
      {!readOnly && sheet.students.length > 0 && (
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, s.onLeave ? 'LV' : 'P'])))}>{t('attendance.mark.allPresent')}</Button>
        </div>
      )}
      <ul className="rounded-xl border border-border bg-surface divide-y divide-border">
        {sheet.students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0 flex items-center gap-3">
              <span className="w-8 text-end text-sm text-ink-faint font-mono-num">{s.rollNo ?? '–'}</span>
              <PersonCell name={s.name} sub={s.onLeave ? t('attendance.mark.onLeave') : undefined} size={32} />
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={t('attendance.mark.markFor', { name: s.name })}>
              {ATTENDANCE_MARKS.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={marks[s.id] === m.value} title={label(m)} disabled={readOnly}
                  onClick={() => setMarks((x) => ({ ...x, [s.id]: m.value }))}
                  className={clsx('min-w-[40px] h-10 px-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60',
                    marks[s.id] === m.value ? MARK_STYLE[m.value] : 'bg-surface text-ink-muted border-border hover:bg-bg')}>
                  {t(`attendance.short.${m.value}`, m.short)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && sheet.students.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 bg-bg/90 backdrop-blur py-3">
          {dirty && <span className="text-xs text-ink-muted">{t('attendance.mark.unsaved')}</span>}
          <Button icon={CalendarCheck} loading={save.isPending} disabled={sheet.taken && !dirty} onClick={() => save.mutate()}>{sheet.taken ? t('attendance.mark.saveChanges') : t('attendance.mark.save')}</Button>
        </div>
      )}
    </div>
  )
}

export default function Mark() {
  const { t } = useTranslation('attendance')
  const { date: fmt } = useFormat()
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState(0)
  const [params] = useSearchParams()
  const [open, setOpen] = useState(() => params.get('sectionId')) // a link from the class board opens that section's sheet
  const { data: board, isLoading } = useQuery({ queryKey: ['attendance-board', date], queryFn: () => fetchAttendanceBoard(date) })
  const day = date || board?.today
  useEffect(() => { if (board?.mode === 'PERIOD' && period === 0) setPeriod(1) }, [board, period])
  const sections = board?.sections ?? []
  const mine = sections.filter((s) => s.mine)
  const others = sections.filter((s) => !s.mine)
  const pending = sections.filter((s) => !s.taken).length
  const took = sections.filter((s) => s.taken && s.counts)
  const present = took.reduce((n, s) => n + (s.counts.P ?? 0) + (s.counts.L ?? 0) + (s.counts.HD ?? 0), 0)
  const absent = took.reduce((n, s) => n + (s.counts.A ?? 0), 0)
  const marked = took.reduce((n, s) => n + (s.counts.total ?? 0), 0)

  const tile = (s) => (
    <button key={s.id} type="button" onClick={() => setOpen(s.id)}
      className="text-start rounded-xl border border-border bg-surface p-4 shadow-card hover:border-brand-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <ColorChip label={s.short} seed={`class-${s.classOrder}`} mono />
        {s.taken ? <StatusPill tone="success">{t('attendance.board.taken')}</StatusPill> : <StatusPill tone="warning">{t('attendance.board.pending')}</StatusPill>}
      </div>
      <p className="text-xs text-ink-muted mt-2">{s.taken && s.counts ? t('attendance.board.counts', { present: (s.counts.P ?? 0) + (s.counts.L ?? 0) + (s.counts.HD ?? 0), absent: s.counts.A ?? 0, total: s.counts.total }) : t('attendance.board.strength', { count: s.strength })}</p>
      {s.taken && s.counts?.total > 0 && (
        <span className="mt-2 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden>
          {[['P', 'success'], ['L', 'warning'], ['HD', 'info'], ['LV', 'neutral'], ['A', 'danger']].map(([k, tone]) => (s.counts[k] ? <span key={k} className={clsx('h-full', TONE[tone].fill)} style={{ width: `${(s.counts[k] / s.counts.total) * 100}%` }} /> : null))}
        </span>
      )}
    </button>
  )

  return (
    <PageContainer>
      <PageHeader icon={CalendarCheck} title={t('attendance.mark.title')} subtitle={day ? t('attendance.mark.subtitle', { date: fmt(day) }) : undefined} />
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <FormField label={t('attendance.mark.date')}><Input type="date" value={day ?? ''} max={board?.today} onChange={(e) => { setDate(e.target.value); setOpen(null) }} /></FormField>
        {board?.mode === 'PERIOD' && (
          <FormField label={t('attendance.mark.period')}>
            <Select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map((p) => <option key={p} value={p}>{t('attendance.mark.periodN', { n: p })}</option>)}</Select>
          </FormField>
        )}
      </div>
      {open && day ? (
        <SheetView sectionId={open} date={day} period={board?.mode === 'PERIOD' ? period : 0} onBack={() => setOpen(null)} />
      ) : (
        <>
          {isLoading && <p className="text-sm text-ink-faint">{t('attendance.loading')}</p>}
          {board && !sections.length && <Note>{t('attendance.board.none')}</Note>}
          {board && sections.length > 0 && (
            <StatCardRow className="mb-4" items={[
              { icon: LayoutGrid, tone: 'brand', label: t('attendance.board.summary.sections'), value: sections.length },
              { icon: CalendarCheck, tone: pending ? 'warning' : 'success', label: t('attendance.board.summary.taken'), value: sections.length - pending, sub: t('attendance.board.summary.ofSections', { count: sections.length }), progress: ((sections.length - pending) / sections.length) * 100 },
              { icon: UserCheck, tone: 'success', label: t('attendance.board.summary.present'), value: present, sub: marked ? t('attendance.board.summary.ofMarked', { count: marked }) : undefined, progress: marked ? (present / marked) * 100 : undefined },
              { icon: UserX, tone: 'danger', label: t('attendance.board.summary.absent'), value: absent },
            ]} />
          )}
          {board && sections.length > 0 && <p className="text-sm text-ink-muted mb-3">{pending ? t('attendance.board.pendingCount', { count: pending }) : t('attendance.board.allTaken')}</p>}
          {mine.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('attendance.board.mine')}</h2>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{mine.map(tile)}</div>
            </section>
          )}
          {others.length > 0 && (
            <section>
              {mine.length > 0 && <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('attendance.board.others')}</h2>}
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{others.map(tile)}</div>
            </section>
          )}
        </>
      )}
    </PageContainer>
  )
}
