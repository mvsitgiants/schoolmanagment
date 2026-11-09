import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, CalendarClock, CalendarDays, CalendarHeart, CalendarPlus, CheckCircle2, CircleAlert, Hourglass, ListChecks, NotebookPen, QrCode, ReceiptIndianRupee, Wallet } from 'lucide-react'
import { LESSON_STATUS } from '@schoolgiant/shared'
import { ColorChip, ListRow, ListRows, Money, ProgressBar, SectionCard, SkeletonRows, StatusPill, useTimeAgo } from '../../components/system'
import Button from '../../components/ui/Button'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useWeekdayLabel } from '../../components/homework/HomeworkKit'
import { useMonthLabel } from '../../components/payroll/PayrollKit'
import { MoreToggle, QuietEmpty, TOUCH, Tile, daysNum, list } from './shared'
import PunchCodeModal from '../../components/scan/PunchCodeModal'
import SelfCheckIn from '../../components/geo/SelfCheckIn'
import { fetchSelfAttendance, selfPunch } from '../../api/scan'
import { useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * My workspace at a glance (as the hospital workspace's Overview): today's lessons, homework to
 * check and topics behind plan for a teacher; leave, approvals and pay for anyone with a staff
 * record — each tile and line a way into the tab that has the detail.
 *
 *   teaching   GET /homework/me (null when the person doesn't teach)
 *   record     the staff record (null when not linked); leave, payslips, approvals likewise
 */
export default function OverviewTab({ teaching, record, leave, payslips, approvals, loading, onGoto, onPlan, onSetHomework }) {
  const { t } = useTranslation('me')
  const { t: th } = useTranslation('homework')
  const monthLabel = useMonthLabel()

  const plans = list(teaching?.plans)
  const todays = plans.filter((p) => p.date === teaching?.today)
  const toCheck = list(teaching?.toCheck)
  const classes = list(teaching?.classes)
  const behind = classes.reduce((n, c) => n + c.behind, 0)

  const balances = list(leave?.balances)
  const available = balances.filter((b) => b.available !== null).reduce((n, b) => n + Number(b.available ?? 0), 0)
  const topBalances = balances.filter((b) => b.available !== null).slice(0, 3)
  const myPending = list(leave?.requests).filter((r) => r.status === 'PENDING')
  const latest = list(payslips)[0]

  const cards = [
    teaching && {
      key: 'today', icon: CalendarClock, label: t('me.overview.lessonsToday'), value: todays.length, onClick: () => onGoto('teaching'),
      sub: todays.length ? t('me.overview.taughtOf', { done: todays.filter((p) => p.status === 'DONE').length, count: todays.length }) : t('me.overview.noLessonsToday'),
    },
    teaching && {
      key: 'check', icon: BookOpenCheck, tone: toCheck.length ? 'warning' : undefined, label: t('me.overview.homeworkToCheck'), value: toCheck.length, onClick: () => onGoto('teaching'),
      sub: toCheck.length ? t('me.overview.studentsToRecord', { count: toCheck.reduce((n, h) => n + h.counts.PENDING, 0) }) : t('me.overview.allChecked'),
    },
    teaching && {
      key: 'behind', icon: CircleAlert, tone: behind ? 'danger' : undefined, label: t('me.overview.topicsBehind'), value: behind, onClick: () => onGoto('teaching'),
      sub: behind ? t('me.overview.inClasses', { count: classes.filter((c) => c.behind).length }) : t('me.overview.onTrack'),
    },
    leave && {
      key: 'leave', icon: CalendarDays, label: t('me.overview.leaveAvailable'), value: daysNum(available), onClick: () => onGoto('leave'),
      sub: balances.length ? t('me.overview.daysAcrossTypes', { count: balances.length }) : t('me.overview.noLeaveTypes'),
      children: topBalances.length > 1 && (
        <span className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {topBalances.map((b) => (
            <span key={b.leaveTypeId} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-muted">{b.name}</span>
              <span className={`font-mono-num tabular-nums ${Number(b.available) > 0 ? 'text-ink' : 'text-ink-faint'}`}>{daysNum(b.available)}</span>
            </span>
          ))}
        </span>
      ),
    },
    leave && {
      key: 'waiting', icon: Hourglass, tone: myPending.length ? 'warning' : undefined, label: t('me.overview.awaitingApproval'), value: myPending.length, onClick: () => onGoto('leave'),
      sub: myPending.length ? t('me.overview.requestsWithApprovers', { count: myPending.length }) : t('me.overview.nothingPendingSub'),
    },
    payslips && {
      key: 'pay', icon: Wallet, label: t('me.overview.lastNetPay'), value: latest ? <Money value={latest.net} paise /> : '—', onClick: () => onGoto('payslips'),
      sub: latest ? monthLabel(latest.month) : t('me.overview.noPayslip'),
    },
    list(approvals).length > 0 && {
      key: 'team', icon: ListChecks, tone: 'info', label: t('me.overview.waitingOnYou'), value: list(approvals).length, onClick: () => onGoto('approvals'),
      sub: t('me.overview.teamLeave', { count: list(approvals).length }),
    },
  ].filter(Boolean)

  // what is waiting on me: homework to check, classes behind plan, my team's leave
  const attention = [
    ...toCheck.map((h) => ({ id: `h-${h.id}`, tab: 'teaching', icon: BookOpenCheck, what: h.title, detail: `${h.section} · ${h.subject}`, tone: 'warning', pill: th('homework.mine.notRecorded', { count: h.counts.PENDING }) })),
    ...classes.filter((c) => c.behind).map((c) => ({ id: `c-${c.key}`, tab: 'teaching', icon: CircleAlert, what: `${c.section} · ${c.subject}`, detail: c.behindTopics.map((x) => x.name).join(' · '), tone: 'danger', pill: th('homework.syllabus.plan.behindN', { count: c.behind }) })),
    ...(list(approvals).length ? [{ id: 'team', tab: 'approvals', icon: Hourglass, what: t('me.overview.teamLeaveTitle'), detail: t('me.overview.teamLeave', { count: list(approvals).length }), tone: 'info', pill: t('me.overview.yourTurn') }] : []),
    ...myPending.map((r) => ({ id: `l-${r.id}`, tab: 'leave', icon: CalendarDays, what: r.leaveName || t('me.overview.leaveOf', { name: r.leaveCode }), detail: t('me.overview.dayCount', { count: Number(r.days ?? 0), days: daysNum(r.days) }), tone: 'warning', pill: t('me.overview.pending') })),
  ]

  const canPlan = teaching && hasPermission('homework.lesson-plans.create')
  const canSet = teaching && hasPermission('homework.homework.create')
  const [punch, setPunch] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <StaffCheckIn />
      {/* Calm tiles (no shadow) in a plain grid: beside the rail a flex row squeezes them too narrow. */}
      <div className="flex flex-col gap-3">
        {cards.length > 0 && (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {cards.map(({ key, ...it }) => <Tile key={key} {...it} />)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {canPlan && <Button size="sm" variant="secondary" icon={NotebookPen} className={TOUCH} onClick={onPlan}>{th('homework.mine.planLesson')}</Button>}
          {canSet && <Button size="sm" variant="secondary" icon={BookOpenCheck} className={TOUCH} onClick={onSetHomework}>{th('homework.new')}</Button>}
          {leave?.canApply && <Button size="sm" variant="secondary" icon={CalendarPlus} className={TOUCH} onClick={() => onGoto('leave', 'apply')}>{t('me.overview.applyLeave')}</Button>}
          {latest && <Button size="sm" variant="secondary" icon={ReceiptIndianRupee} className={TOUCH} onClick={() => onGoto('payslips')}>{t('me.overview.latestPayslip')}</Button>}
          {record && <Button size="sm" variant="secondary" icon={QrCode} className={TOUCH} onClick={() => setPunch(true)}>{t('scan:scan.punch.button')}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {teaching && <NextLessons teaching={teaching} onGoto={onGoto} />}
        <ItemList icon={ListChecks} title={t('me.overview.needsAttention')} items={attention} loading={loading} onGoto={onGoto}
          emptyIcon={CheckCircle2} emptyTitle={t('me.overview.caughtUp')} emptyHint={teaching ? t('me.overview.attentionHintTeacher') : t('me.overview.attentionHint')} />
        {classes.length > 0 && <MyClasses classes={classes} onGoto={onGoto} />}
        {record && <Holidays holidays={list(record.holidays)} />}
      </div>
      {punch && <PunchCodeModal onClose={() => setPunch(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ check in / out from the phone */

/** Staff mark themselves in and out (Settings › Staff & HR › self attendance) — only shown when it is switched on. */
function StaffCheckIn() {
  const { t } = useTranslation('geo')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['self-attendance'], queryFn: fetchSelfAttendance, retry: false, staleTime: 30_000 })
  if (!data?.enabled) return null
  return (
    <SectionCard icon={CalendarClock} title={t('geo.self.title')}>
      <SelfCheckIn status={data} punch={selfPunch} onDone={(r) => qc.setQueryData(['self-attendance'], (d) => ({ ...d, today: r.today, next: r.direction === 'IN' ? 'OUT' : 'IN' }))} />
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ the week's lessons from today */

function NextLessons({ teaching, onGoto }) {
  const { t } = useTranslation('me')
  const { t: th } = useTranslation('homework')
  const { date } = useFormat()
  const weekday = useWeekdayLabel()
  const next = list(teaching.plans).filter((p) => p.date >= teaching.today).slice(0, 7)
  return (
    <SectionCard icon={CalendarClock} title={t('me.overview.nextLessons')} flush
      actions={<Button size="sm" variant="ghost" className="-my-1" onClick={() => onGoto('teaching')}>{t('me.overview.myWeek')}</Button>}>
      {next.length === 0 ? (
        <QuietEmpty icon={CalendarClock} title={t('me.overview.noLessons')} hint={t('me.overview.noLessonsHint')} />
      ) : (
        <ul className="divide-y divide-border">
          {next.map((p) => {
            const isToday = p.date === teaching.today
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0">
                  <span className={`block text-xs font-semibold ${isToday ? 'text-brand-700' : 'text-ink-muted'}`}>{isToday ? t('me.overview.today') : weekday(p.date)}</span>
                  <span className="block text-[11px] text-ink-faint tabular-nums">{p.period ? th('homework.lessons.periodN', { n: p.period }) : date(p.date)}</span>
                </span>
                <ColorChip label={p.section} seed={p.classId ?? p.section} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink truncate">{p.title}</span>
                  <span className="block text-[11px] text-ink-faint truncate">{[p.subject, p.topics.join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
                {p.status !== 'PLANNED' && <StatusPill tone={LESSON_STATUS[p.status]?.tone}>{th(`homework.lessons.status.${p.status}`)}</StatusPill>}
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ my classes against the year plan */

function MyClasses({ classes, onGoto }) {
  const { t } = useTranslation('me')
  const [all, setAll] = useState(false)
  const shown = all ? classes : classes.slice(0, 5)
  return (
    <SectionCard icon={ListChecks} title={t('me.overview.myClasses')} count={classes.length} flush
      actions={<Button size="sm" variant="ghost" className="-my-1" onClick={() => onGoto('teaching')}>{t('me.overview.allClasses')}</Button>}>
      <ul className="divide-y divide-border">
        {shown.map((c) => (
          <li key={c.key}>
            <button type="button" onClick={() => onGoto('teaching')} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-black/[0.02]">
              <ColorChip label={c.section} seed={c.classId} />
              <span className="min-w-0 flex-1 text-sm text-ink truncate">{c.subject}</span>
              <span className="w-20 sm:w-28 shrink-0">{c.topics ? <ProgressBar value={c.pct} showValue={false} /> : <span className="block text-center text-xs text-ink-faint">—</span>}</span>
              <span className="w-16 shrink-0 text-end text-xs tabular-nums">{c.behind ? <span className="text-danger-600 font-medium">{t('me.overview.behindShort', { count: c.behind })}</span> : <span className="text-ink-muted">{c.done}/{c.topics}</span>}</span>
            </button>
          </li>
        ))}
      </ul>
      {classes.length > 5 && <div className="px-2 pb-2"><MoreToggle all={all} total={classes.length} onToggle={() => setAll((v) => !v)} className="ms-2" /></div>}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ holidays */

function Holidays({ holidays }) {
  const { t } = useTranslation('me')
  const { date } = useFormat()
  const ago = useTimeAgo()
  return (
    <SectionCard icon={CalendarHeart} title={t('me.overview.holidays')} flush>
      {holidays.length === 0 ? <QuietEmpty icon={CalendarHeart} title={t('me.overview.noHolidays')} /> : (
        <ul className="divide-y divide-border">
          {holidays.slice(0, 6).map((h) => (
            <li key={h.date + h.name} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`inline-flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border leading-none ${h.optional ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-pink-200 bg-pink-50 text-pink-700'}`}>
                <span className="text-[15px] font-bold tabular-nums">{Number(h.date.slice(8, 10))}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink truncate">{h.name}{h.optional && <span className="text-xs font-normal text-ink-faint"> · {t('me.overview.optional')}</span>}</span>
                <span className="block text-[11px] text-ink-faint">{date(h.date)} · {ago(h.date)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ lists that lead to a tab */

function ItemList({ icon, title, items, loading, onGoto, emptyIcon, emptyTitle, emptyHint }) {
  const [all, setAll] = useState(false)
  const shown = all ? items.slice(0, 25) : items.slice(0, 5)
  return (
    <SectionCard icon={icon} title={title} count={items.length || null} flush>
      {shown.length === 0 ? (
        loading ? <div className="py-2"><SkeletonRows rows={3} /></div> : <QuietEmpty icon={emptyIcon} title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="p-1.5">
          <ListRows>
            {shown.map((it) => (
              <ListRow key={it.id} icon={it.icon} tone={it.tone} title={it.what} subtitle={it.detail} trailing={<StatusPill tone={it.tone}>{it.pill}</StatusPill>} onClick={() => onGoto(it.tab)} className="min-h-[52px]" />
            ))}
          </ListRows>
          {items.length > 5 && <MoreToggle all={all} total={items.length} onToggle={() => setAll((v) => !v)} className="ms-2" />}
        </div>
      )}
    </SectionCard>
  )
}
