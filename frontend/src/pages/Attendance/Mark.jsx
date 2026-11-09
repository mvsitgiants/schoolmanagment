import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, CalendarCheck, CheckCheck, ChevronLeft, Clock, LayoutGrid, UserCheck, UserX } from 'lucide-react'
import { ATTENDANCE_MARKS, countMarks, takesDaily, takesPeriods } from '@schoolgiant/shared'
import { Avatar, ColorChip, FormField, Input, Note, PageContainer, PageHeader, PersonCell, StatCardRow, StatusPill, TONE, Tabs } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAttendanceBoard, fetchSheet, saveSheet } from '../../api/attendance'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { enqueue, isOffline } from '../../utils/offlineQueue'
import { getCurrentUser } from '../../api/auth'

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
    mutationFn: async () => {
      const body = { sectionId, date, period, entries: sheet.students.map((s) => ({ studentId: s.id, status: marks[s.id] })) }
      const offline = () => {
        enqueue({ kind: 'attendance', key: `${sectionId}|${date}|${period}`, label: `${sheet.section.label}${period ? ` · P${period}` : ''} · ${date}`, body })
        return { offline: true }
      }
      if (navigator.onLine === false) return offline() // known offline: don't wait for the request to time out and retry
      try { return await saveSheet(body) } catch (err) {
        if (!isOffline(err)) throw err
        // no connection: keep it on this device and send it when the connection is back (PwaPrompts)
        return offline()
      }
    },
    onSuccess: (data) => {
      if (data?.offline) {
        qc.setQueryData(key, { ...sheet, taken: true, takenBy: getCurrentUser()?.user?.name, takenAt: new Date().toISOString(), students: sheet.students.map((s) => ({ ...s, status: marks[s.id] })) })
        showSuccess(t('attendance.mark.savedOffline'))
        return
      }
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
            <p className="font-semibold text-ink truncate">{sheet.section.label}{sheet.period > 0 && <span className="text-ink-muted font-normal"> · {t('attendance.mark.periodN', { n: sheet.period })}</span>}</p>
            {sheet.slot && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                {sheet.slot.start && <span className="tabular-nums">{sheet.slot.start}–{sheet.slot.end}</span>}
                {sheet.slot.subject && <ColorChip label={sheet.slot.subject} seed={sheet.slot.subjectId} dot />}
                {sheet.slot.teacher && <span className="inline-flex items-center gap-1"><Avatar name={sheet.slot.teacher} size={16} soft />{sheet.slot.teacher}{sheet.slot.substitute && ` · ${t('attendance.mark.substitute')}`}</span>}
              </p>
            )}
            <p className="text-xs text-ink-muted">{sheet.derived ? t('attendance.mark.derivedNote') : sheet.taken ? t('attendance.mark.takenBy', { name: sheet.updatedBy || sheet.takenBy, at: dateTime(sheet.updatedAt || sheet.takenAt) }) : t('attendance.mark.notTaken')}</p>
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
              <PersonCell name={s.name} sub={s.onLeave ? t('attendance.mark.onLeave') : s.gateIn ? t('attendance.mark.gateIn', { time: s.gateIn }) : undefined} size={32} />
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
  const [period, setPeriod] = useState(null) // null = the first period still to mark (period modes) or the day
  const [params] = useSearchParams()
  const [open, setOpen] = useState(() => params.get('sectionId')) // a link from the class board opens that section's sheet
  const { data: board, isLoading } = useQuery({ queryKey: ['attendance-board', date], queryFn: () => fetchAttendanceBoard(date) })
  const day = date || board?.today
  const periodsOn = takesPeriods(board?.mode)
  const dailyOn = takesDaily(board?.mode)
  const sections = board?.sections ?? []
  const openSection = sections.find((s) => s.id === open)
  const openPeriods = openSection?.periods ?? []
  // which sheet to show for the open section: what was picked, else the first period not marked yet (or the day)
  const shownPeriod = period ?? (periodsOn && !dailyOn ? (openPeriods.find((p) => !p.taken)?.period ?? openPeriods[0]?.period ?? 1) : 0)
  const openAt = (sectionId, p = null) => { setOpen(sectionId); setPeriod(p) }
  const mine = sections.filter((s) => s.mine)
  const others = sections.filter((s) => !s.mine)
  const pending = sections.filter((s) => !s.taken).length
  const took = sections.filter((s) => s.taken && s.counts)
  const present = took.reduce((n, s) => n + (s.counts.P ?? 0) + (s.counts.L ?? 0) + (s.counts.HD ?? 0), 0)
  const absent = took.reduce((n, s) => n + (s.counts.A ?? 0), 0)
  const marked = took.reduce((n, s) => n + (s.counts.total ?? 0), 0)

  const tile = (s) => (
    <button key={s.id} type="button" onClick={() => openAt(s.id)}
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
      {s.periods?.length > 0 && (
        <span className="mt-2.5 flex gap-0.5" aria-hidden>
          {s.periods.map((p) => (
            <span key={p.period} title={[t('attendance.mark.periodN', { n: p.period }), p.subject, p.taken ? t('attendance.board.taken') : t('attendance.board.pending')].filter(Boolean).join(' · ')}
              className={clsx('h-2 flex-1 rounded-sm', p.taken ? 'bg-success-500' : 'bg-black/[0.08]')} />
          ))}
        </span>
      )}
      {s.periods?.length > 0 && <span className="mt-1 block text-[10.5px] text-ink-faint">{t('attendance.board.periodsTaken', { done: s.periods.filter((p) => p.taken).length, total: s.periods.length })}</span>}
    </button>
  )

  return (
    <PageContainer>
      <PageHeader icon={CalendarCheck} title={t('attendance.mark.title')} subtitle={day ? t('attendance.mark.subtitle', { date: fmt(day) }) : undefined} />
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <FormField label={t('attendance.mark.date')}><Input type="date" value={day ?? ''} max={board?.today} onChange={(e) => { setDate(e.target.value); setOpen(null) }} /></FormField>
        {board && periodsOn && <Note icon={Clock} className="flex-1">{t(`attendance.mark.modeNote.${board.mode}`, { rule: t(`attendance.mark.dayFrom.${board.dayFrom ?? 'FIRST'}`) })}</Note>}
      </div>
      {open && day ? (
        <>
          {periodsOn && openSection && (
            <Tabs className="mb-4" value={String(shownPeriod)} onChange={(v) => setPeriod(Number(v))} tabs={[
              { value: '0', label: dailyOn ? t('attendance.mark.dayTab') : t('attendance.mark.dayTabWorked') },
              ...openPeriods.map((p) => ({ value: String(p.period), label: `${p.taken ? '✓ ' : ''}P${p.period}${p.subject ? ` · ${p.subject}` : ''}` })),
            ]} />
          )}
          <SheetView key={`${open}|${shownPeriod}`} sectionId={open} date={day} period={periodsOn ? shownPeriod : 0} onBack={() => { setOpen(null); setPeriod(null) }} />
        </>
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
          {board?.myPeriods?.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('attendance.board.myPeriods')}</h2>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {board.myPeriods.map((p) => (
                  <button key={`${p.sectionId}|${p.period}`} type="button" onClick={() => openAt(p.sectionId, p.period)}
                    className={clsx('rounded-xl border p-4 text-start shadow-card transition-colors hover:border-brand-300', p.taken ? 'border-border bg-surface' : 'border-amber-200 bg-amber-50/40')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold tabular-nums text-ink">{t('attendance.mark.periodN', { n: p.period })}{p.start ? ` · ${p.start}–${p.end}` : ''}</span>
                      {p.taken ? <StatusPill tone="success">{t('attendance.board.taken')}</StatusPill> : <StatusPill tone="warning">{t('attendance.board.pending')}</StatusPill>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ColorChip label={p.short} seed={p.sectionId} mono />
                      {p.subject && <span className="inline-flex items-center gap-1 text-sm text-ink"><BookOpen className="h-3.5 w-3.5 text-ink-faint" aria-hidden />{p.subject}</span>}
                    </div>
                    {p.substitute && <p className="mt-1 text-[11px] text-ink-faint">{t('attendance.mark.covering')}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}
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
