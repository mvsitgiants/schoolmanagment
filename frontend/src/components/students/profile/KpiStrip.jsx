import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { BookMarked, CalendarCheck2, GraduationCap, NotebookPen, Trophy, Wallet, WalletCards } from 'lucide-react'
import { Money } from '../../system'
import { useFormat } from '../../../context/SettingsContext'
import { Kpi, broken, pctTone } from './kit'

const COLS = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7' }

/** The student's year in a line of calm figures — only the ones whose module is on and readable. Each opens its tab. */
export default function KpiStrip({ o, onGoto }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  if (!o) return null
  const a = !broken(o.attendance) && o.attendance
  const f = !broken(o.fees) && o.fees
  const ex = !broken(o.exams) && o.exams
  const hw = !broken(o.homework) && o.homework
  const lib = !broken(o.library) && o.library
  const can = !broken(o.canteen) && o.canteen
  const prog = !broken(o.programs) && o.programs
  const lastResult = ex?.results?.at(-1)

  const items = [
    a && {
      key: 'att', icon: CalendarCheck2, label: t('students.profile.kpi.attendance'), tab: 'attendance',
      value: a.pct != null ? `${a.pct}%` : '—', tone: a.pct != null && a.pct < a.minimumPct ? 'danger' : undefined,
      sub: a.counts.total ? t('students.profile.kpi.daysPresent', { present: a.counts.P + a.counts.L, total: a.counts.total }) : t('students.profile.kpi.noMarks'),
      bar: a.pct ?? 0, barTone: pctTone(a.pct, a.minimumPct),
    },
    f && {
      key: 'fees', icon: Wallet, label: t('students.profile.kpi.feesDue'), tab: 'fees',
      value: <Money value={f.totals.due} paise tone={f.totals.overdue > 0 ? 'danger' : undefined} />, tone: f.totals.overdue > 0 ? 'danger' : undefined,
      sub: f.totals.overdue > 0 ? <span className="text-danger-600"><Money value={f.totals.overdue} paise tone="danger" /> {t('students.profile.kpi.overdue')}</span>
        : f.totals.due > 0 && f.nextDue ? t('students.profile.kpi.nextDue', { date: date(f.nextDue.date) }) : t('students.profile.kpi.allPaid'),
      bar: f.totals.billed ? (f.totals.paid / f.totals.billed) * 100 : null, barTone: 'success',
    },
    prog?.result && {
      key: 'cgpa', icon: GraduationCap, label: t('students.profile.kpi.cgpa'), tab: 'academics',
      value: prog.result.cgpa ?? '—', sub: t('students.profile.kpi.semester', { n: prog.result.semester }),
    },
    ex && {
      key: 'result', icon: Trophy, label: t('students.profile.kpi.latestResult'), tab: 'academics',
      value: lastResult?.pct != null ? `${lastResult.pct}%` : '—', tone: lastResult?.result === 'FAIL' ? 'danger' : undefined,
      sub: lastResult ? [lastResult.grade, lastResult.exam].filter(Boolean).join(' · ') : t('students.profile.kpi.noResults'),
      bar: lastResult?.pct ?? null, barTone: pctTone(lastResult?.pct, 33, 60),
    },
    hw && {
      key: 'hw', icon: NotebookPen, label: t('students.profile.kpi.homework'), tab: 'academics',
      value: hw.counts.pending + hw.counts.overdue, tone: hw.counts.overdue > 0 ? 'danger' : undefined,
      sub: hw.counts.overdue > 0 ? t('students.profile.kpi.hwOverdue', { count: hw.counts.overdue }) : t('students.profile.kpi.hwDone', { count: hw.counts.submitted + hw.counts.checked }),
    },
    lib && {
      key: 'lib', icon: BookMarked, label: t('students.profile.kpi.books'), tab: 'campus',
      value: lib.out.length, tone: lib.overdue > 0 ? 'danger' : undefined,
      sub: lib.overdue > 0 ? t('students.profile.kpi.booksOverdue', { count: lib.overdue }) : t('students.profile.kpi.booksRead', { count: lib.read }),
    },
    can && {
      key: 'canteen', icon: WalletCards, label: t('students.profile.kpi.wallet'), tab: 'campus',
      value: <Money value={can.balance} paise tone={can.low ? 'warning' : undefined} />, tone: can.low ? 'warning' : undefined,
      sub: <span>{t('students.profile.kpi.spentToday')} <Money value={can.spentToday} paise /></span>,
    },
  ].filter(Boolean)

  if (!items.length) return null
  return (
    <div className={clsx('grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3', COLS[items.length], items.length % 2 === 1 && 'max-sm:[&>*:last-child]:col-span-2')}>
      {items.map(({ key, tab, ...it }) => <Kpi key={key} {...it} onClick={() => onGoto(tab)} />)}
    </div>
  )
}
