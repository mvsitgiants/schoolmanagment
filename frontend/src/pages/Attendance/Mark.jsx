import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CalendarCheck, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, ScanQrCode } from 'lucide-react'
import { ATTENDANCE_MARKS, addDaysYmd, countMarks, takesDaily, takesPeriods } from '@schoolgiant/shared'
import { DateInput, Avatar, ColorChip, Note, PageContainer, PageHeader, PillRow, ProgressBar, SideNav, SideNavLayout, StatusPill, TONE, Tabs, pillClass } from '../../components/system'
import groupByClass, { classKeyOf } from '../../components/attendance/groupByClass'
import { useWeekdayLabel } from '../../components/homework/HomeworkKit'
import Button from '../../components/ui/Button'
import { fetchAttendanceBoard, fetchSheet, saveSheet } from '../../api/attendance'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { enqueue, isOffline } from '../../utils/offlineQueue'
import { getCurrentUser } from '../../api/auth'
import { resolveCode } from '../../api/scan'
import { ScanDialog, scanFeedback } from '../../components/scan/Scanner'

const MARK_STYLE = {
  P: 'bg-success-500 text-white border-success-500',
  A: 'bg-danger-500 text-white border-danger-500',
  L: 'bg-amber-400 text-white border-amber-400',
  HD: 'bg-info-500 text-white border-info-500',
  LV: 'bg-ink-muted text-white border-ink-muted',
}

// the row behind a student who isn't simply present, so the exceptions stand out down a long list
const ROW_TINT = { A: 'bg-danger-50/60', L: 'bg-amber-50/60', HD: 'bg-info-50/50', LV: 'bg-black/[0.03]' }

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
  // scanning ID cards in class: each card scanned marks that child present; then "the rest absent"
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState([]) // newest first: { id, name, ok, note }
  const onCard = async (code) => {
    try {
      const r = await resolveCode(code)
      const s = r.kind === 'STUDENT' ? sheet.students.find((x) => x.id === r.id) : null
      if (!s) { scanFeedback(false); setScanned((l) => [{ id: `${Date.now()}`, name: r.title, ok: false, note: t('attendance.mark.scan.notHere') }, ...l].slice(0, 20)); return }
      setMarks((x) => ({ ...x, [s.id]: x[s.id] === 'L' || x[s.id] === 'HD' ? x[s.id] : 'P' }))
      setScanned((l) => [{ id: s.id, name: s.name, ok: true }, ...l.filter((y) => y.id !== s.id)].slice(0, 20))
    } catch (e) {
      scanFeedback(false)
      setScanned((l) => [{ id: `${Date.now()}`, name: code, ok: false, note: e.message }, ...l].slice(0, 20))
    }
  }
  const scannedIds = new Set(scanned.filter((x) => x.ok).map((x) => x.id))
  const restAbsent = () => setMarks((x) => Object.fromEntries(sheet.students.map((s) => [s.id, scannedIds.has(s.id) ? x[s.id] : s.onLeave ? 'LV' : 'A'])))
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label={t('attendance.mark.back')} title={t('attendance.mark.back')} />}
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
        <div className="hidden sm:flex flex-wrap items-center gap-2 text-sm">
          {ATTENDANCE_MARKS.filter((m) => counts[m.value]).map((m) => <StatusPill key={m.value} tone={m.tone}>{label(m)} {counts[m.value]}</StatusPill>)}
        </div>
      </div>
      {!sheet.workingDay && <Note tone="warning" className="mb-3">{t('attendance.mark.notWorkingDay')}</Note>}
      {readOnly && <Note tone="info" className="mb-3">{t(`attendance.mark.readOnly.${sheet.reason}`, t('attendance.mark.readOnly.NO_PERMISSION'))}</Note>}
      {!sheet.students.length && <Note>{t('attendance.mark.noStudents')}</Note>}
      {!readOnly && sheet.students.length > 0 && (<>
        <div className="flex flex-wrap justify-end gap-2 mb-2">
          <Button size="sm" variant="secondary" icon={ScanQrCode} onClick={() => setScanning(true)}>{t('attendance.mark.scan.button')}</Button>
          {scannedIds.size > 0 && <Button size="sm" variant="secondary" icon={UserX} onClick={restAbsent}>{t('attendance.mark.scan.restAbsent', { count: sheet.students.length - scannedIds.size })}</Button>}
          <Button size="sm" variant="secondary" icon={CheckCheck} onClick={() => setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, s.onLeave ? 'LV' : 'P'])))}>{t('attendance.mark.allPresent')}</Button>
        </div>
        <ScanDialog open={scanning} continuous onClose={() => setScanning(false)} onCode={onCard} title={t('attendance.mark.scan.title')} hint={t('attendance.mark.scan.hint', { done: scannedIds.size, total: sheet.students.length })}>
          <ul className="divide-y divide-border rounded-lg border border-border max-h-40 overflow-y-auto">
            {scanned.slice(0, 6).map((x) => (
              <li key={`${x.id}-${x.name}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-ink">{x.name}</span>
                {x.ok ? <StatusPill tone="success">{t('attendance.mark.scan.present')}</StatusPill> : <span className="text-xs text-danger-600 truncate">{x.note}</span>}
              </li>
            ))}
          </ul>
        </ScanDialog>
      </>)}
      {/* phones first: the name may wrap to two lines rather than be cut, the five marks stay 40px+ */}
      <ul className="rounded-xl border border-border bg-surface divide-y divide-border overflow-hidden">
        {sheet.students.map((s) => (
          <li key={s.id} className={clsx('flex items-center justify-between gap-2 ps-2 pe-2 sm:ps-3 py-2 min-h-[56px] transition-colors', ROW_TINT[marks[s.id]])}>
            <div className="min-w-0 flex flex-1 items-center gap-2 sm:gap-3">
              <span className="w-6 sm:w-8 shrink-0 text-end text-xs sm:text-sm text-ink-faint font-mono-num">{s.rollNo ?? '–'}</span>
              <Avatar name={s.name} size={32} soft className="hidden sm:inline-flex shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-snug text-ink break-words">{s.name}</span>
                {(s.onLeave || s.gateIn) && <span className="block text-[11.5px] leading-snug text-ink-muted">{s.onLeave ? t('attendance.mark.onLeave') : t('attendance.mark.gateIn', { time: s.gateIn })}</span>}
              </span>
            </div>
            <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={t('attendance.mark.markFor', { name: s.name })}>
              {ATTENDANCE_MARKS.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={marks[s.id] === m.value} title={label(m)} aria-label={label(m)} disabled={readOnly}
                  onClick={() => setMarks((x) => ({ ...x, [s.id]: m.value }))}
                  className={clsx('w-10 sm:w-auto sm:min-w-[40px] h-11 sm:h-10 sm:px-2 rounded-lg border text-[13px] sm:text-sm font-semibold transition-colors disabled:opacity-60',
                    marks[s.id] === m.value ? MARK_STYLE[m.value] : 'bg-surface text-ink-muted border-border hover:bg-bg')}>
                  {t(`attendance.short.${m.value}`, m.short)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && sheet.students.length > 0 && (
        <div className="action-bar mt-4 lg:-mx-1 flex items-center justify-end gap-3 lg:rounded-xl bg-bg/95 border-t border-border lg:border-0 lg:!px-1 py-3 backdrop-blur">
          <span className="me-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold tabular-nums sm:hidden">
            {ATTENDANCE_MARKS.filter((m) => counts[m.value]).map((m) => <span key={m.value} className={TONE[m.tone]?.text}>{t(`attendance.short.${m.value}`, m.short)} {counts[m.value]}</span>)}
          </span>
          {dirty && <span className="hidden sm:inline text-xs text-ink-muted">{t('attendance.mark.unsaved')}</span>}
          <Button icon={CalendarCheck} loading={save.isPending} disabled={sheet.taken && !dirty} onClick={() => save.mutate()}>{sheet.taken ? t('attendance.mark.saveChanges') : t('attendance.mark.save')}</Button>
        </div>
      )}
    </div>
  )
}

/**
 * Attendance › Mark attendance: the classes on the left (each marked ✓ or still to mark, with the day's progress above
 * them), the register of the chosen class on the right — it opens on the first class still to mark (a teacher's own
 * first). Period-wise schools get the class's periods as tabs, and the teacher's own periods today as chips on top.
 */
export default function Mark() {
  const { t } = useTranslation('attendance')
  const weekday = useWeekdayLabel()
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
  // nothing open (first visit, another day): the first class still to mark — the teacher's own first — else the first
  useEffect(() => {
    if (!board || !sections.length || sections.some((s) => s.id === open)) return
    const first = sections.find((s) => !s.taken && s.mine) ?? sections.find((s) => !s.taken) ?? sections.find((s) => s.mine) ?? sections[0]
    openAt(first.id)
  }, [board]) // eslint-disable-line react-hooks/exhaustive-deps
  const pending = sections.filter((s) => !s.taken).length
  const classes = useMemo(() => groupByClass(sections), [sections])
  const openClass = openSection ? classes.find((c) => c.key === classKeyOf(openSection)) : null
  const openFirst = (c) => openAt((c.sections.find((s) => !s.taken) ?? c.sections[0]).id)
  const took = sections.filter((s) => s.taken && s.counts)
  const present = took.reduce((n, s) => n + (s.counts.P ?? 0) + (s.counts.L ?? 0) + (s.counts.HD ?? 0), 0)
  const absent = took.reduce((n, s) => n + (s.counts.A ?? 0), 0)
  const marked = took.reduce((n, s) => n + (s.counts.total ?? 0), 0)
  const isToday = !!day && !!board?.today && day === board.today
  const changeDay = (d) => { setDate(d); setOpen(null); setPeriod(null) }
  const presentOf = (s) => (s.counts?.P ?? 0) + (s.counts?.L ?? 0) + (s.counts?.HD ?? 0)

  // the left: the day's progress, then every class — ✓ when marked, else how many students are waiting
  const nav = sections.length > 0 && (
    <div className="space-y-2">
      <div className="px-3 pt-1">
        <p className="text-sm text-ink-muted">
          <span className="text-lg font-semibold tabular-nums text-ink">{sections.length - pending}</span>
          <span className="tabular-nums"> / {sections.length}</span> {t('attendance.board.classesMarked', { count: sections.length })}
        </p>
        <ProgressBar value={((sections.length - pending) / sections.length) * 100} tone={pending ? 'brand' : 'success'} showValue={false} className="mt-1.5" />
        {marked > 0 && (
          <p className="mt-1.5 text-xs text-ink-muted">
            <strong className="font-semibold tabular-nums text-ink">{present}</strong> {t('attendance.board.presentWord')}
            {' · '}<strong className={clsx('font-semibold tabular-nums', absent ? 'text-danger-600' : 'text-ink')}>{absent}</strong> {t('attendance.board.absentWord')}
          </p>
        )}
      </div>
      <SideNav title={t('attendance.mark.classesNav')} value={openClass?.key} onChange={(key) => openFirst(classes.find((c) => c.key === key))} items={classes.map((c) => {
        const done = c.sections.filter((x) => x.taken).length
        const all = done === c.sections.length
        const one = c.sections.length === 1 ? c.sections[0] : null
        const hint = one
          ? (one.taken && one.counts ? t('attendance.board.navMarked', { present: presentOf(one), absent: one.counts.A ?? 0 }) : t('attendance.board.navToMark', { count: one.strength }))
          : t('attendance.mark.navHint', { done, total: c.sections.length })
        return { id: c.key, label: c.name, hint, count: all ? '✓' : one ? undefined : `${done}/${c.sections.length}`, ...(one ? {} : { progress: { value: done, max: c.sections.length, kind: 'done' } }) }
      })} />
    </div>
  )

  return (
    <PageContainer>
      <PageHeader icon={CalendarCheck} title={t('attendance.mark.title')} subtitle={day ? t('attendance.mark.subtitleDay', { weekday: weekday(day), date: fmt(day) }) : undefined}
        actions={day && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" icon={ChevronLeft} aria-label={t('attendance.mark.prevDay')} title={t('attendance.mark.prevDay')} onClick={() => changeDay(addDaysYmd(day, -1))} />
            <DateInput className="w-40" value={day} max={board?.today} onChange={(e) => changeDay(e.target.value)} aria-label={t('attendance.mark.date')} />
            <Button size="sm" variant="secondary" icon={ChevronRight} disabled={isToday} aria-label={t('attendance.mark.nextDay')} title={t('attendance.mark.nextDay')} onClick={() => changeDay(addDaysYmd(day, 1))} />
            {!isToday && <Button size="sm" variant="ghost" onClick={() => changeDay('')}>{t('attendance.mark.today')}</Button>}
          </div>
        )} />
      {board && periodsOn && <Note icon={Clock} className="mb-4">{t(`attendance.mark.modeNote.${board.mode}`, { rule: t(`attendance.mark.dayFrom.${board.dayFrom ?? 'FIRST'}`) })}</Note>}
      {isLoading && <p className="text-sm text-ink-faint">{t('attendance.loading')}</p>}
      {board && !sections.length && <Note>{t('attendance.board.none')}</Note>}
      {/* period-wise schools: the teacher's own periods today, one tap each */}
      {board?.myPeriods?.length > 0 && (
        <PillRow className="mb-3">
          {board.myPeriods.map((p) => (
            <button key={`${p.sectionId}|${p.period}`} type="button" aria-pressed={open === p.sectionId && shownPeriod === p.period} onClick={() => openAt(p.sectionId, p.period)} className={pillClass(open === p.sectionId && shownPeriod === p.period)}>
              {p.taken ? <Check className="h-3.5 w-3.5 text-success-600" aria-label={t('attendance.board.taken')} /> : <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />}
              {t('attendance.mark.periodN', { n: p.period })} · {p.short}{p.subject ? ` · ${p.subject}` : ''}
            </button>
          ))}
        </PillRow>
      )}
      {open && day && openSection && (
        <SideNavLayout nav={nav}>
          {openClass && openClass.sections.length > 1 && (
            <PillRow>
              {openClass.sections.map((x) => (
                <button key={x.id} type="button" aria-pressed={open === x.id} onClick={() => openAt(x.id)} className={pillClass(open === x.id)}>
                  {x.taken ? <Check className="h-3.5 w-3.5 text-success-600" aria-label={t('attendance.board.taken')} /> : <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />}
                  {x.short} <span className="tabular-nums opacity-70">· {x.strength}</span>
                </button>
              ))}
            </PillRow>
          )}
          {periodsOn && (
            <Tabs value={String(shownPeriod)} onChange={(v) => setPeriod(Number(v))} tabs={[
              { value: '0', label: dailyOn ? t('attendance.mark.dayTab') : t('attendance.mark.dayTabWorked') },
              ...openPeriods.map((p) => ({ value: String(p.period), label: `${p.taken ? '✓ ' : ''}${t('attendance.mark.periodN', { n: p.period })}${p.subject ? ` · ${p.subject}` : ''}` })),
            ]} />
          )}
          <SheetView key={`${open}|${shownPeriod}`} sectionId={open} date={day} period={periodsOn ? shownPeriod : 0} />
        </SideNavLayout>
      )}
    </PageContainer>
  )
}
