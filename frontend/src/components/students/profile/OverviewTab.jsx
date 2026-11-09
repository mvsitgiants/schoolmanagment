import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  BookMarked, CalendarCheck2, CalendarClock, CheckCircle2, ClipboardList, Clock, DoorOpen, ListChecks, Mail, MessageCircle, MessagesSquare, NotebookPen,
  Smartphone, TrendingUp, TriangleAlert, Wallet, WalletCards,
} from 'lucide-react'
import { ColorChip, ColumnBars, ListRow, ListRows, Money, SectionCard, SkeletonRows, StatusPill, useTimeAgo } from '../../system'
import Button from '../../ui/Button'
import { useFormat } from '../../../context/SettingsContext'
import { Quiet, SectionError, broken, list, pctTone, useLabels, useMonthShort, useWeekdayShort } from './kit'
import { CompletenessBar } from './ProfileTab'

export const CHANNEL_ICON = { SMS: Smartphone, WHATSAPP: MessageCircle, EMAIL: Mail }

/**
 * Student 360 › Overview: today (the class's periods and today's attendance), what needs attention, the year at a
 * glance (attendance by month, results across exams), the next exam, and the latest messages to the family.
 */
export default function OverviewTab({ s, o, loading, completeness, onGoto }) {
  if (loading && !o) return <div className="rounded-xl border border-border bg-surface py-3"><SkeletonRows rows={5} /></div>
  const att = !broken(o?.attendance) ? o?.attendance : null
  const ex = !broken(o?.exams) ? o?.exams : null
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {(o?.timetable || att) && <TodayCard tt={o.timetable} att={att} />}
        {(att?.months?.length > 0 || ex?.results?.length > 0) && <YearCharts att={att} ex={ex} onGoto={onGoto} />}
        {ex?.upcoming && <NextExam up={ex.upcoming} />}
        <KeyFacts s={s} completeness={completeness} onGoto={onGoto} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Attention o={o} onGoto={onGoto} />
        {o?.messages && <Messages rows={list(o.messages).slice(0, 5)} error={broken(o.messages)} onAll={() => onGoto('history')} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ today */

function TodayCard({ tt, att }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const weekday = useWeekdayShort()
  const live = tt && !broken(tt) && tt.published
  const title = !live || tt.isToday ? t('students.profile.today.title') : t('students.profile.today.next', { day: weekday(tt.day), date: date(tt.day) })
  const nowIn = (p) => live && tt.isToday && p.start && p.end && tt.time >= p.start && tt.time < p.end
  return (
    <SectionCard icon={CalendarClock} title={title} flush
      actions={att && <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">{t('students.profile.today.attendance')}
        {att.today ? <StatusPill tone={L.markTone(att.today)}>{L.mark(att.today)}</StatusPill> : <StatusPill tone="neutral" dot={false}>{t('students.profile.today.notMarked')}</StatusPill>}</span>}>
      {broken(tt) ? <SectionError />
        : !tt ? <p className="px-4 py-4 text-sm text-ink-faint">{t('students.profile.today.noTimetableModule')}</p>
          : !tt.published ? <Quiet icon={CalendarClock} title={t('students.profile.today.noTimetable')} hint={t('students.profile.today.noTimetableHint')} />
            : (
              <ul className="divide-y divide-border">
                {tt.periods.map((p) => {
                  const isPeriod = p.kind === 'PERIOD'
                  const now = nowIn(p)
                  return (
                    <li key={`${p.kind}-${p.no}-${p.start}`} className={clsx('flex items-center gap-3 px-4', isPeriod ? 'py-2.5' : 'py-1.5 bg-bg/50', now && 'bg-brand-50/70')}>
                      <span className="w-[4.6rem] shrink-0 font-mono-num text-[11.5px] tabular-nums text-ink-faint">{p.start}{p.end ? `–${p.end}` : ''}</span>
                      {isPeriod ? (
                        <>
                          <span className="hidden w-7 shrink-0 text-center text-[11px] font-semibold text-ink-muted sm:block">{t('students.profile.today.periodShort', { n: p.no })}</span>
                          {p.subject ? <ColorChip label={p.subject} seed={p.subject} className="max-w-[45%]" /> : <span className="text-sm text-ink-faint">{t('students.profile.today.free')}</span>}
                          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                            {[p.teacher, p.room].filter(Boolean).join(' · ')}{p.substitute && <span className="ms-1 text-amber-600">· {t('students.profile.today.substitute')}</span>}
                          </span>
                          {now && <StatusPill tone="brand">{t('students.profile.today.now')}</StatusPill>}
                        </>
                      ) : <span className="text-xs text-ink-faint">{p.label || t('students.profile.today.break')}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ the year at a glance */

function YearCharts({ att, ex, onGoto }) {
  const { t } = useTranslation('students')
  const month = useMonthShort()
  const months = list(att?.months)
  const results = list(ex?.results).filter((r) => r.pct != null)
  return (
    <div className={clsx('grid grid-cols-1 gap-4', months.length > 0 && results.length > 0 && 'sm:grid-cols-2')}>
      {months.length > 0 && (
        <ColumnBars title={t('students.profile.glance.attendance')} subtitle={t('students.profile.glance.attendanceHint', { min: att.minimumPct })} height={72}
          items={months.map((m) => ({ id: m.month, label: month(m.month), value: Math.round(m.pct ?? 0), tone: pctTone(m.pct, att.minimumPct) }))}
          right={<Button size="sm" variant="ghost" className="-my-1" onClick={() => onGoto('attendance')}>{t('students.profile.open')}</Button>} />
      )}
      {results.length > 0 && (
        <ColumnBars title={t('students.profile.glance.results')} subtitle={t('students.profile.glance.resultsHint')} height={72}
          items={results.map((r) => ({ id: r.examId, label: r.exam, short: shortExam(r.exam), value: Math.round(r.pct), tone: pctTone(r.pct, 33, 60) }))}
          right={<Button size="sm" variant="ghost" className="-my-1" onClick={() => onGoto('academics')}>{t('students.profile.open')}</Button>} />
      )}
    </div>
  )
}

/** "Half-yearly examination" → "Half-yearly"; "Unit Test 1" → "UT 1" — short enough for a column label. */
export function shortExam(name = '') {
  const words = String(name).split(/\s+/).filter(Boolean)
  if (words.length <= 1) return name
  if (/\d/.test(words.at(-1))) return `${words.slice(0, -1).map((w) => w[0]).join('').toUpperCase()} ${words.at(-1)}`
  return words[0]
}

/* ------------------------------------------------------------------ next exam */

export function NextExam({ up }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const ago = useTimeAgo()
  return (
    <SectionCard icon={ClipboardList} title={up.exam} hint={up.startDate ? `${date(up.startDate)}${up.endDate && up.endDate !== up.startDate ? ` – ${date(up.endDate)}` : ''} · ${ago(up.startDate)}` : null} flush>
      {up.papers.length === 0 ? <p className="px-4 py-4 text-sm text-ink-faint">{t('students.profile.exam.noPapers')}</p> : (
        <ul className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          {up.papers.slice(0, 10).map((p, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 sm:border-b sm:border-border">
              <span className="w-12 shrink-0 text-center leading-tight">
                <span className="block text-[15px] font-bold tabular-nums text-ink">{p.date ? Number(p.date.slice(8, 10)) : '—'}</span>
                <span className="block text-[10px] uppercase text-ink-faint">{p.startTime ?? ''}</span>
              </span>
              <ColorChip label={p.subject} seed={p.subject} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ key facts */

function KeyFacts({ s, completeness, onGoto }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const address = [s.address?.line, s.address?.city, s.address?.state, s.address?.pincode].filter(Boolean).join(', ')
  const facts = [
    [t('students.form.dob'), s.dob ? date(s.dob) : null],
    [t('students.form.admissionDate'), s.admissionDate ? date(s.admissionDate) : null],
    [t('students.form.motherTongue'), s.motherTongue],
    [t('students.form.addressLine'), address || null],
  ]
  return (
    <SectionCard icon={ListChecks} title={t('students.profile.keyFacts')}
      actions={<Button size="sm" variant="ghost" className="-my-1" onClick={() => onGoto('profile')}>{t('students.profile.allDetails')}</Button>}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
            <dd className={clsx('mt-0.5 break-words text-sm', value ? 'font-medium text-ink' : 'text-ink-faint')}>{value || t('students.profile.notFilledShort')}</dd>
          </div>
        ))}
      </dl>
      {completeness && <CompletenessBar c={completeness} compact className="mt-4 border-t border-border pt-3" />}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ needs attention */

function Attention({ o, onGoto }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  if (!o) return null
  const ok = (v) => v && !broken(v)
  const items = []
  if (ok(o.attendance) && o.attendance.pct != null && o.attendance.pct < o.attendance.minimumPct) {
    items.push({ id: 'att', tab: 'attendance', icon: CalendarCheck2, tone: 'danger', title: t('students.profile.attention.lowAttendance', { pct: o.attendance.pct }), sub: t('students.profile.attention.minimum', { min: o.attendance.minimumPct }) })
  }
  if (ok(o.fees) && o.fees.totals.overdue > 0) {
    items.push({ id: 'fees', tab: 'fees', icon: Wallet, tone: 'danger', title: t('students.profile.attention.feesOverdue'), sub: o.fees.nextDue ? t('students.profile.attention.dueSince', { date: date(o.fees.nextDue.date) }) : null, trail: <Money value={o.fees.totals.overdue} paise tone="danger" /> })
  }
  if (ok(o.homework) && o.homework.counts.overdue > 0) {
    items.push({ id: 'hw', tab: 'academics', icon: NotebookPen, tone: 'warning', title: t('students.profile.attention.homeworkOverdue', { count: o.homework.counts.overdue }), sub: o.homework.term ? t('students.profile.attention.thisTerm', { term: o.homework.term }) : null })
  }
  if (ok(o.exams) && o.exams.results.at(-1)?.failedSubjects?.length) {
    const r = o.exams.results.at(-1)
    items.push({ id: 'exam', tab: 'academics', icon: TrendingUp, tone: 'danger', title: t('students.profile.attention.belowPass', { count: r.failedSubjects.length }), sub: `${r.exam} · ${r.failedSubjects.join(', ')}` })
  }
  if (ok(o.library) && o.library.overdue > 0) {
    items.push({ id: 'lib', tab: 'campus', icon: BookMarked, tone: 'warning', title: t('students.profile.attention.booksOverdue', { count: o.library.overdue }), sub: o.library.out.filter((b) => b.state === 'OVERDUE').map((b) => b.title).join(' · ') })
  }
  if (ok(o.library) && o.library.owed > 0) {
    items.push({ id: 'fine', tab: 'campus', icon: BookMarked, tone: 'warning', title: t('students.profile.attention.libraryFine'), trail: <Money value={o.library.owed} paise tone="warning" /> })
  }
  if (ok(o.attendance) && o.attendance.openLeave > 0) {
    items.push({ id: 'leave', tab: 'attendance', icon: Clock, tone: 'info', title: t('students.profile.attention.leaveWaiting', { count: o.attendance.openLeave }) })
  }
  if (ok(o.hostel) && o.hostel.open > 0) {
    items.push({ id: 'outpass', tab: 'campus', icon: DoorOpen, tone: 'info', title: t('students.profile.attention.outpassOpen', { count: o.hostel.open }) })
  }
  if (ok(o.canteen) && o.canteen.low) {
    items.push({ id: 'wallet', tab: 'campus', icon: WalletCards, tone: 'warning', title: t('students.profile.attention.walletLow'), trail: <Money value={o.canteen.balance} paise tone="warning" /> })
  }
  return (
    <SectionCard icon={TriangleAlert} title={t('students.profile.attention.title')} count={items.length || null} flush>
      {items.length === 0 ? <Quiet icon={CheckCircle2} title={t('students.profile.attention.clear')} hint={t('students.profile.attention.clearHint')} /> : (
        <div className="p-1.5">
          <ListRows>
            {items.map((it) => <ListRow key={it.id} icon={it.icon} tone={it.tone} title={it.title} subtitle={it.sub} trailing={it.trail} onClick={() => onGoto(it.tab)} />)}
          </ListRows>
        </div>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ messages to the family */

export function Messages({ rows, error, onAll }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const ago = useTimeAgo()
  return (
    <SectionCard icon={MessagesSquare} title={t('students.profile.messages.title')} flush
      actions={onAll && rows.length > 0 && <Button size="sm" variant="ghost" className="-my-1" onClick={onAll}>{t('students.profile.messages.all')}</Button>}>
      {error ? <SectionError /> : rows.length === 0 ? <Quiet icon={MessagesSquare} title={t('students.profile.messages.none')} hint={t('students.profile.messages.noneHint')} /> : (
        <ul className="divide-y divide-border">
          {rows.map((m) => {
            const Icon = CHANNEL_ICON[m.channel] ?? MessagesSquare
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-ink-muted" title={L.channel(m.channel)}><Icon className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{L.msgEvent(m.event)}</span>
                  <span className="block truncate text-[11px] text-ink-faint">{[L.channel(m.channel), ago(m.at)].join(' · ')}</span>
                </span>
                <StatusPill tone={L.msgTone(m.status)}>{L.msgStatus(m.status)}</StatusPill>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}
