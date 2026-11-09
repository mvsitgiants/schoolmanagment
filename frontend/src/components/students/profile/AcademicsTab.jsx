import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Award, BookOpenCheck, Briefcase, CalendarRange, GraduationCap, NotebookPen, Printer, Trophy } from 'lucide-react'
import { YEAR_STATUS } from '@schoolgiant/shared'
import { ColorChip, ColumnBars, DataTable, DateCell, Money, SectionCard, StatusPill } from '../../system'
import Button from '../../ui/Button'
import { hasPermission } from '../../../api/auth'
import { printDocument } from '../../print/printDocument'
import { useFormat } from '../../../context/SettingsContext'
import { BarList, Figure, Legend, Quiet, SectionError, broken, list, pctTone, useLabels } from './kit'
import { NextExam, shortExam } from './OverviewTab'

const FLAT = '!rounded-none !border-0 !shadow-none'

/**
 * Student 360 › Academics: the year-end result (published or so far), every published exam of the year, the latest
 * exam subject by subject, the next exam, homework this term and the week's subjects — plus the program, semester
 * result and placement offers for a college student.
 */
export default function AcademicsTab({ s, o }) {
  const { t } = useTranslation('students')
  const ex = o.exams
  const hw = o.homework
  const week = o.timetable && !broken(o.timetable) && o.timetable.published && list(o.timetable.perWeek).length > 0
  const scored = list(ex?.results).filter((r) => r.pct != null)
  // nothing published yet (and no year figure): one quiet card rather than three empty ones
  const noResults = ex && !broken(ex) && !list(ex.results).length && ex.year?.pct == null
  return (
    <div className="flex flex-col gap-6">
      {o.programs && <ProgramCard p={o.programs} placements={o.placements} />}
      {ex && (broken(ex) ? <SectionCard icon={Trophy} title={t('students.profile.academics.results')}><SectionError /></SectionCard> : noResults ? (
        <div className={clsx('grid grid-cols-1 items-start gap-6', ex.upcoming && 'xl:grid-cols-2')}>
          <SectionCard icon={Trophy} title={t('students.profile.academics.results')}><Quiet icon={Trophy} title={t('students.profile.academics.noResults')} hint={t('students.profile.academics.noResultsHint')} /></SectionCard>
          {ex.upcoming && <NextExam up={ex.upcoming} />}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            {ex.year ? <YearCard y={ex.year} studentId={s.id} /> : <ResultsChart ex={ex} />}
            <LatestExam latest={ex.latest} />
          </div>
          {ex.year && scored.length > 1 ? (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <ResultsChart ex={ex} />
              <ResultsTable ex={ex} />
            </div>
          ) : <ResultsTable ex={ex} />}
          {ex.upcoming && <NextExam up={ex.upcoming} />}
        </>
      ))}
      {(hw || week) && (
        <div className={clsx('grid grid-cols-1 items-start gap-6', hw && week && 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}>
          {hw && <Homework hw={hw} />}
          {week && <WeekSubjects tt={o.timetable} />}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ the year-end result */

function YearCard({ y, studentId }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const canPrint = hasPermission('exams.year-results.print') && y.status === 'PUBLISHED'
  return (
    <SectionCard icon={Award} title={t('students.profile.academics.yearResult', { year: y.year })}
      actions={<>
        <StatusPill tone={YEAR_STATUS[y.status]?.tone}>{t(`exams:exams.yearResults.status.${y.status}`, YEAR_STATUS[y.status]?.label)}</StatusPill>
        {canPrint && <Button size="sm" variant="ghost" className="-my-1" icon={Printer} onClick={() => printDocument('YEAR_REPORT_CARD', studentId)}>{t('students.profile.academics.print')}</Button>}
      </>}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure value={y.pct != null ? `${y.pct}%` : '—'} label={t('students.profile.academics.overall')} tone={pctTone(y.pct, 33, 60) === 'danger' ? 'danger' : undefined} />
        {y.grade && <Figure value={y.grade} label={t('students.profile.academics.grade')} />}
        {y.rank != null && <Figure value={`#${y.rank}`} label={t('students.profile.academics.rankOf', { count: y.of })} />}
        {y.result && <StatusPill tone={L.yearResultTone(y.result)}>{L.yearResult(y.result)}</StatusPill>}
      </div>
      {y.subjects.length > 0 && (
        <BarList className="mt-5" rows={y.subjects.map((x) => ({ key: x.subject, label: x.subject, pct: x.pct, value: x.pct != null ? `${x.pct}%${x.grade ? ` · ${x.grade}` : ''}` : '—', tone: x.pass === false ? 'danger' : undefined }))} />
      )}
      {y.weights.length > 0 && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-ink-faint">
          <span className="font-medium text-ink-muted">{t('students.profile.academics.weights')}</span> {y.weights.map((w) => `${w.name} ${w.share}%`).join(' · ')}
        </p>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ exams of the year */

function ResultsChart({ ex }) {
  const { t } = useTranslation('students')
  const rows = list(ex.results).filter((r) => r.pct != null)
  if (!rows.length) {
    return <SectionCard icon={Trophy} title={t('students.profile.academics.results')}><Quiet icon={Trophy} title={t('students.profile.academics.noResults')} hint={t('students.profile.academics.noResultsHint')} /></SectionCard>
  }
  return (
    <ColumnBars title={t('students.profile.academics.results')} subtitle={t('students.profile.glance.resultsHint')} height={120}
      items={rows.map((r) => ({ id: r.examId, label: r.exam, short: shortExam(r.exam), value: Math.round(r.pct), tone: pctTone(r.pct, 33, 60) }))} />
  )
}

function ResultsTable({ ex }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const canPrint = hasPermission('exams.report-cards.print') || hasPermission('exams.report-cards.view')
  const rows = list(ex.results)
  return (
    <SectionCard icon={Trophy} title={t('students.profile.academics.results')} count={rows.length || null} flush>
      {rows.length === 0 ? <Quiet icon={Trophy} title={t('students.profile.academics.noResults')} hint={t('students.profile.academics.noResultsHint')} /> : (
        <DataTable className={FLAT} rows={[...rows].reverse()} rowKey="candidateId" columns={[
          { key: 'exam', header: t('students.profile.academics.exam'), mobileTitle: true, render: (v, r) => <span className="block leading-tight"><span className="block font-medium text-ink">{v}</span>{r.term && <span className="block text-[11px] text-ink-faint">{r.term}</span>}</span> },
          { key: 'startDate', header: t('students.profile.academics.held'), nowrap: true, render: (v) => <DateCell value={v} relative={false} /> },
          { key: 'total', header: t('students.profile.academics.marks'), align: 'right', render: (v, r) => (v != null ? `${v} / ${r.max}` : '—') },
          { key: 'pct', header: '%', mobileLabel: t('students.profile.academics.score'), align: 'right', mobilePrimary: true, render: (v) => (v != null ? <span className={clsx('font-semibold', pctTone(v, 33, 60) === 'danger' && 'text-danger-600')}>{v}%</span> : '—') },
          { key: 'grade', header: t('students.profile.academics.grade'), render: (v) => (v ? <ColorChip label={v} seed={`grade-${v}`} /> : '—') },
          ...(ex.showRank ? [{ key: 'rank', header: t('students.profile.academics.rank'), align: 'right', render: (v) => (v != null ? `#${v}` : '—') }] : []),
          { key: 'result', header: t('students.profile.academics.result'), render: (v) => (v ? <StatusPill tone={L.resultTone(v)}>{L.result(v)}</StatusPill> : '—') },
          ...(canPrint ? [{ key: 'print', header: '', align: 'right', render: (_, r) => <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.profile.academics.reportCard')} title={t('students.profile.academics.reportCard')} onClick={() => printDocument('REPORT_CARD', r.candidateId)} /> }] : []),
        ]} />
      )}
    </SectionCard>
  )
}

function LatestExam({ latest }) {
  const { t } = useTranslation('students')
  if (!latest) {
    return <SectionCard icon={BookOpenCheck} title={t('students.profile.academics.subjects')}><Quiet icon={BookOpenCheck} title={t('students.profile.academics.noResults')} hint={t('students.profile.academics.noResultsHint')} /></SectionCard>
  }
  const marked = latest.subjects.filter((x) => !x.gradeOnly)
  const graded = latest.subjects.filter((x) => x.gradeOnly && x.grade)
  return (
    <SectionCard icon={BookOpenCheck} title={t('students.profile.academics.subjectsOf', { exam: latest.exam })}
      actions={latest.pct != null && <span className="text-sm font-semibold tabular-nums text-ink">{latest.pct}%{latest.grade ? ` · ${latest.grade}` : ''}</span>}>
      <BarList rows={marked.map((x) => ({
        key: x.subject, label: x.subject, pct: x.pct,
        value: x.absent ? t('students.profile.academics.absent') : x.marks != null ? `${x.marks} / ${x.maxMarks}` : '—',
        tone: x.absent ? 'neutral' : x.pass === false ? 'danger' : undefined,
      }))} />
      {graded.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-ink-faint">{t('students.profile.academics.graded')}</span>
          {graded.map((x) => <ColorChip key={x.subject} label={`${x.subject} · ${x.grade}`} seed={x.subject} />)}
        </div>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ homework */

function Homework({ hw }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  if (broken(hw)) return <SectionCard icon={NotebookPen} title={t('students.profile.homework.title')}><SectionError /></SectionCard>
  const c = hw.counts
  const parts = [
    { key: 'checked', label: t('students.profile.homework.checked'), n: c.checked, fill: 'bg-emerald-500' },
    { key: 'submitted', label: t('students.profile.homework.submitted'), n: c.submitted, fill: 'bg-sky-500' },
    { key: 'pending', label: t('students.profile.homework.pending'), n: c.pending, fill: 'bg-slate-300' },
    { key: 'overdue', label: t('students.profile.homework.overdue'), n: c.overdue, fill: 'bg-rose-500' },
    { key: 'missing', label: t('students.profile.homework.missing'), n: c.missing, fill: 'bg-rose-300' },
  ]
  const sum = parts.reduce((n, p) => n + p.n, 0)
  return (
    <SectionCard icon={NotebookPen} title={t('students.profile.homework.title')} hint={hw.term ? t('students.profile.homework.term', { term: hw.term, count: c.total }) : t('students.profile.homework.year', { count: c.total })} flush>
      {c.total === 0 ? <Quiet icon={NotebookPen} title={t('students.profile.homework.none')} /> : (
        <>
          <div className="px-4 pt-4">
            {sum > 0 && (
              <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.05]">
                {parts.filter((p) => p.n > 0).map((p) => <span key={p.key} className={clsx('h-full first:rounded-s-full last:rounded-e-full', p.fill)} style={{ width: `${(p.n / sum) * 100}%` }} />)}
              </div>
            )}
            <Legend className="mt-2" items={parts.filter((p) => p.n > 0).map((p) => ({ label: p.label, count: p.n, fill: p.fill }))} />
          </div>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {hw.items.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="hidden w-36 shrink-0 sm:block"><ColorChip label={h.subject} seed={h.subject} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{h.title}</span>
                  <span className={clsx('block truncate text-[11px]', h.overdue ? 'text-danger-600' : 'text-ink-faint')}>
                    <span className="sm:hidden">{h.subject} · </span>{t('students.profile.homework.due', { date: date(h.dueDate) })}{h.teacher ? ` · ${h.teacher}` : ''}
                  </span>
                </span>
                {h.needsSubmission
                  ? <StatusPill tone={h.overdue ? 'danger' : L.homeworkTone(h.status)}>{h.overdue ? t('students.profile.homework.overdueOne') : L.homework(h.status)}</StatusPill>
                  : <StatusPill tone="neutral" dot={false}>{t('students.profile.homework.noHandIn')}</StatusPill>}
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ the week's subjects */

function WeekSubjects({ tt }) {
  const { t } = useTranslation('students')
  const total = tt.perWeek.reduce((n, x) => n + x.periods, 0)
  return (
    <SectionCard icon={CalendarRange} title={t('students.profile.timetable.week')} hint={t('students.profile.timetable.periods', { count: total })}
      actions={hasPermission('timetable.timetable.view') && <Button size="sm" variant="ghost" className="-my-1" to="/timetable/timetable">{t('students.profile.timetable.open')}</Button>}>
      {tt.perWeek.length === 0 ? <p className="text-sm text-ink-faint">{t('students.profile.timetable.empty')}</p> : (
        <BarList floor={-1} good={-1} rows={tt.perWeek.map((x) => ({ key: x.subject, label: x.subject, pct: total ? (x.periods / Math.max(...tt.perWeek.map((y) => y.periods))) * 100 : 0, value: x.periods, tone: 'brand' }))} />
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ college: program, semester result, placements */

function ProgramCard({ p, placements }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  if (broken(p)) return <SectionCard icon={GraduationCap} title={t('students.profile.college.program')}><SectionError /></SectionCard>
  const offers = !broken(placements) ? list(placements?.offers) : []
  return (
    <div className={clsx('grid grid-cols-1 items-start gap-6', offers.length > 0 && 'xl:grid-cols-2')}>
      <SectionCard icon={GraduationCap} title={p.program} hint={[p.code, t('students.profile.college.batch', { batch: p.batch })].filter(Boolean).join(' · ')}
        actions={<StatusPill tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>{L.enrolment(p.status)}</StatusPill>}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <Figure value={t('students.profile.college.semN', { n: p.semester })} label={p.semesters ? t('students.profile.college.ofSem', { count: p.semesters }) : t('students.profile.college.semester')} />
          {p.result?.cgpa != null && <Figure value={p.result.cgpa} label={t('students.profile.college.cgpa')} />}
          {p.result?.sgpa != null && <Figure value={p.result.sgpa} label={t('students.profile.college.sgpa', { n: p.result.semester })} />}
          {p.result && <Figure value={p.result.arrears} label={t('students.profile.college.arrears')} tone={p.result.arrears > 0 ? 'danger' : undefined} />}
        </div>
        {p.registerNo && <p className="mt-4 text-xs text-ink-muted">{t('students.profile.college.registerNo')} <span className="font-mono-num text-ink">{p.registerNo}</span></p>}
      </SectionCard>
      {offers.length > 0 && (
        <SectionCard icon={Briefcase} title={t('students.profile.college.offers')} count={offers.length} flush>
          <ul className="divide-y divide-border">
            {offers.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                <ColorChip label={x.company} seed={x.company} className="max-w-[45%]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{x.role || '—'}</span>
                  <span className="block truncate text-[11px] text-ink-faint">{[date(x.offeredOn), x.location, x.offCampus && t('students.profile.college.offCampus')].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-end"><Money value={x.ctc} paise compact /><StatusPill tone={L.offerTone(x.status)} className="ms-2">{L.offer(x.status)}</StatusPill></span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  )
}
