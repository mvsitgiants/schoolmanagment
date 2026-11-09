import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Award, BookCopy, ClipboardList, BookOpenCheck, Bus, CalendarCheck, CalendarDays, CalendarHeart, ChevronRight, ClipboardCheck, Compass, FileQuestion, GraduationCap,
  IndianRupee, Megaphone, MessageSquare, MonitorPlay, NotebookPen, Receipt, RefreshCw, Search, Send, Sparkles, UserCog, UserPlus, Users, Wallet,
} from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ENQUIRY_STAGES, deltaPct, formatINRCompact } from '@schoolgiant/shared'
import { DateRangeChip, Note, PageContainer, presetRange, useTimeAgo } from '../../components/system'
import Button from '../../components/ui/Button'
import { Card, DonutStat, HUE, KpiCard } from '../../components/dashboard/HomeKit'
import { fetchOverview } from '../../api/dashboard'
import { hasPermission } from '../../api/auth'
import useAuthUser from '../../hooks/useAuthUser'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'
import { useFormat } from '../../context/SettingsContext'
import { navFor } from '../../catalog/nav'
import { iconFor } from '../../catalog/icons'

const greetingKey = () => {
  const h = new Date().getHours()
  return h >= 5 && h < 12 ? 'home.goodMorning' : h >= 12 && h < 17 ? 'home.goodAfternoon' : 'home.goodEvening'
}
const money = (paise) => formatINRCompact(paise ?? 0)
/** Grid columns for n cards in a row, written out so Tailwind keeps the classes. */
const COLS = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3' }
const KPI_COLS = { 1: 'xl:grid-cols-4', 2: 'xl:grid-cols-4', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-4', 8: 'xl:grid-cols-4' }
const STAGE_TINT = ['#DCE7FE', '#E0F2FE', '#FDECC8', '#FDE0D3', '#D6F5E3', '#C8EED9', '#EEF0F4']

const QUICK = [
  { key: 'markAttendance', icon: CalendarCheck, path: '/attendance/mark', perm: 'attendance.mark.create', tone: 'success' },
  { key: 'collectFee', icon: IndianRupee, path: '/fees/collect', perm: 'fees.collect.create', tone: 'info' },
  { key: 'admitStudent', icon: UserPlus, path: '/students/admit', perm: 'students.admit.create', tone: 'brand' },
  { key: 'newEnquiry', icon: Users, path: '/admissions/enquiries', perm: 'admissions.enquiries.create', tone: 'violet' },
  { key: 'setHomework', icon: NotebookPen, path: '/homework/homework', perm: 'homework.homework.create', tone: 'pink' },
  { key: 'postNotice', icon: Megaphone, path: '/communication/notices', perm: 'communication.notices.create', tone: 'amber' },
  { key: 'addExpense', icon: Wallet, path: '/finance/expenses', perm: 'finance.expenses.create', tone: 'danger' },
  { key: 'issueBook', icon: BookCopy, path: '/library/circulation', perm: 'library.circulation.issue', tone: 'sky' },
  { key: 'issueCertificate', icon: Award, path: '/certificates/issue', perm: 'certificates.issue.create', tone: 'success' },
  { key: 'examSchedule', icon: ClipboardCheck, path: '/exams/schedule', perm: 'exams.schedule.view', tone: 'info' },
]

// shortcuts to the screen that answers a common question (the assistant does the open-ended ones)
const ASK = [
  { key: 'absentToday', path: '/attendance/reports', perm: 'attendance.reports.view' },
  { key: 'feesOverdue', path: '/fees/dues', perm: 'fees.dues.view' },
  { key: 'booksOverdue', path: '/library/circulation', perm: 'library.circulation.view' },
  { key: 'staffOnLeave', path: '/hrms/leave', perm: 'hrms.leave.view' },
  { key: 'followUps', path: '/admissions/enquiries', perm: 'admissions.enquiries.view' },
]

const PULSE_ICON = { homework: NotebookPen, exams: ClipboardCheck, certificates: Award, notices: Megaphone, messages: MessageSquare, events: CalendarDays, liveClasses: MonitorPlay, tests: FileQuestion }
const AGENDA = { EVENT: { icon: CalendarDays, tone: 'info' }, EXAM: { icon: ClipboardCheck, tone: 'violet' }, HOLIDAY: { icon: CalendarHeart, tone: 'pink' } }

/**
 * Home: the institution at a glance, as the ERP's command center — headline figures for the chosen
 * period against the one before, money in and out by month, the admissions funnel, today's state of
 * attendance, fees, staff, library and transport, every module's pulse, what's coming up, recent
 * activity and decisions waiting. Each part shows only for the modules and records the person may
 * see (GET /dashboard/overview). Then every module, to jump into.
 */
export default function Home() {
  const { t } = useTranslation(['dashboard', 'common'])
  const navigate = useNavigate()
  const me = useAuthUser()
  const { date, number } = useFormat()
  const [range, setRange] = useState(() => presetRange('thisMonth'))
  const { data: d, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['home-overview', range.from, range.to],
    queryFn: () => fetchOverview({ from: range.from, to: range.to }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  const firstName = (me?.user?.name || '').split(' ')[0]
  const greeting = t(`common:${greetingKey()}`)
  const k = d?.kpis ?? {}
  const vsPrev = (value, prev, { higherIsGood = true } = {}) => {
    const pct = deltaPct(value ?? 0, prev ?? 0)
    if (pct == null) return null
    return { text: t('home.vsPrev', { value: `${pct >= 0 ? '+' : ''}${pct}%` }), good: pct === 0 ? null : (pct > 0) === higherIsGood }
  }
  const vsPrevPts = (value, prev) => {
    if (value == null || prev == null) return null
    const diff = Math.round((value - prev) * 10) / 10
    return { text: t('home.vsPrevPts', { value: `${diff >= 0 ? '+' : ''}${diff}` }), good: diff === 0 ? null : diff > 0 }
  }

  const kpis = [
    k.students && { key: 'students', icon: GraduationCap, tone: 'brand', label: t('home.kpi.students'), value: number(k.students.value), sub: t('home.kpi.studentsSub', { joined: k.students.joined, boys: k.students.boys, girls: k.students.girls }), spark: k.students.spark, path: '/students/directory' },
    k.attendance && { key: 'attendance', icon: CalendarCheck, tone: 'success', label: t('home.kpi.attendance'), value: k.attendance.value == null ? '—' : `${k.attendance.value}%`, delta: vsPrevPts(k.attendance.value, k.attendance.prev), sub: t('home.kpi.noAttendance'), spark: k.attendance.spark, path: '/attendance/reports' },
    k.fees && { key: 'fees', icon: IndianRupee, tone: 'info', label: t('home.kpi.fees'), value: money(k.fees.value), delta: vsPrev(k.fees.value, k.fees.prev), sub: t('home.kpi.receipts', { count: k.fees.receipts }), spark: k.fees.spark, path: '/fees/day-end' },
    k.enquiries && { key: 'enquiries', icon: UserPlus, tone: 'violet', label: t('home.kpi.enquiries'), value: k.enquiries.value, delta: vsPrev(k.enquiries.value, k.enquiries.prev), sub: t('home.kpi.applications', { count: k.enquiries.applications }), spark: k.enquiries.spark, path: '/admissions/enquiries' },
    k.expenses && { key: 'expenses', icon: Receipt, tone: 'amber', label: t('home.kpi.expenses'), value: money(k.expenses.value), delta: vsPrev(k.expenses.value, k.expenses.prev, { higherIsGood: false }), sub: t('home.kpi.expensesWaiting', { count: k.expenses.waiting }), spark: k.expenses.spark, path: '/finance/expenses' },
    k.teaching && { key: 'lessons', icon: ClipboardList, tone: 'sky', label: t('home.kpi.lessons'), value: k.teaching.week, sub: t('home.kpi.lessonsSub', { taught: k.teaching.taught, today: k.teaching.today }), path: '/me?tab=teaching' },
    k.teaching && { key: 'toCheck', icon: BookOpenCheck, tone: k.teaching.toCheck ? 'amber' : 'success', label: t('home.kpi.toCheck'), value: k.teaching.toCheck, sub: t('home.kpi.behind', { count: k.teaching.behind }), path: '/me?tab=teaching' },
    k.staff && { key: 'staff', icon: UserCog, tone: 'pink', label: t('home.kpi.staff'), value: k.staff.value, sub: k.staff.attendance == null ? t('home.kpi.staffSubNone') : t('home.kpi.staffSub', { pct: k.staff.attendance }), spark: k.staff.spark, path: '/hrms/employees' },
  ].filter(Boolean)
  const analytics = useAnalyticsCards(d)
  const today = useTodayCards(d)
  // a lone analytics card joins the next row rather than stretching across the page
  const todayCards = analytics.length > 1 ? today : [...analytics, ...today]

  return (
    <PageContainer wide className="pb-16 space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">{firstName ? t('dashboard:homeHero.greetingName', { greeting, name: firstName }) : greeting}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {t('home.subtitle', { institution: me?.tenant?.name ?? '' })}
            {d?.year?.name && <span className="ms-2 inline-flex rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">{d.year.name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeChip value={range} onChange={setRange} />
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={isFetching} onClick={() => refetch()} aria-label={t('home.refresh')} title={t('home.refresh')} />
        </div>
      </div>

      {error && <Note tone="danger">{error.message}</Note>}
      {d && !d.year && <Note tone="warning">{t('dashboard.command.noYear')}</Note>}

      {isLoading && !d && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-36 rounded-xl bg-black/5 animate-pulse" />)}
        </div>
      )}

      {d && (
        <>
          {/* headline figures */}
          {kpis.length > 0 && (
            <div className={`grid grid-cols-2 md:grid-cols-3 ${KPI_COLS[kpis.length]} gap-4`}>
              {kpis.map(({ key, path, ...it }) => <KpiCard key={key} {...it} onClick={() => navigate(path)} />)}
            </div>
          )}

          {analytics.length > 1 && <div className={`grid grid-cols-1 ${COLS[analytics.length]} gap-5`}>{analytics}</div>}
          {todayCards.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">{todayCards}</div>}
          <Pulse items={d.pulse ?? []} />

          {/* coming up · activity · approvals */}
          <div className={`grid grid-cols-1 ${COLS[d.activity ? 3 : 2]} gap-5`}>
            <Card title={t('home.agenda.title')} note={t('home.agenda.note')}>
              {d.agenda?.length ? (
                <ul className="space-y-3">
                  {d.agenda.map((a) => {
                    const A = AGENDA[a.kind] ?? AGENDA.EVENT
                    return (
                      <li key={a.id}>
                        <Link to={a.link} className="flex items-center gap-3 group">
                          <span className="w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 leading-none" style={{ background: `${HUE[A.tone]}14`, color: HUE[A.tone] }}>
                            <span className="text-[15px] font-bold tabular-nums">{Number(a.from.slice(8, 10))}</span>
                            <A.icon className="w-2.5 h-2.5 mt-0.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-ink truncate group-hover:text-brand-700">{a.title}</span>
                            <span className="block text-xs text-ink-muted">{t(`home.agenda.kind.${a.kind}`)} · {date(a.from)}{a.to !== a.from ? ` – ${date(a.to)}` : ''}</span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="text-sm text-ink-muted py-8 text-center">{t('home.agenda.empty')}</p>}
            </Card>
            {d.activity && <Activity rows={d.activity} />}
            <Card title={t('home.approvals.title')}>
              {d.approvals?.length ? (
                <ul className="space-y-2">
                  {d.approvals.map((p) => (
                    <li key={p.key}>
                      <Link to={p.link} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:border-amber-400 hover:bg-amber-50/40 transition-colors group">
                        <span className="min-w-[28px] h-7 px-2 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center tabular-nums">{p.count}</span>
                        <span className="flex-1 min-w-0 text-sm text-ink truncate">{t(`home.approvals.kind.${p.key}`, { count: p.count })}</span>
                        <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-amber-700 rtl:rotate-180" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-muted py-8 text-center">{t('home.approvals.empty')}</p>}
            </Card>
          </div>
        </>
      )}

      <Launchpad />
    </PageContainer>
  )
}

/* ------------------------------------------------------------------ money · admissions · ask */

function useAnalyticsCards(d) {
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const monthLabel = (ym) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`))
  const SERIES = { fees: HUE.success, expenses: HUE.amber, payroll: HUE.violet }
  const e = d?.kpis.enquiries
  const ask = ASK.filter((a) => hasPermission(a.perm))
  if (!d) return []
  return [
    d.money && (
      <Card key="money" title={t('home.money.title')} note={t('home.money.note')}>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d.money.months.map((m) => ({ ...m, label: monthLabel(m.month) }))} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8A8F98' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#8A8F98' }} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={56} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {d.money.series.map((s) => <Line key={s} type="monotone" dataKey={s} name={t(`home.money.${s}`)} stroke={SERIES[s]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    ),
    e && (
      <Card key="admissions" title={t('home.admissions.title')} note={t('home.admissions.note')}
        action={<Link to="/admissions/enquiries" className="text-xs font-medium text-brand-600 hover:underline">{t('home.open')}</Link>}>
        <div className="grid grid-cols-4 gap-1.5">
          {Object.keys(ENQUIRY_STAGES).map((s, i) => (
            <div key={s} className="rounded-md px-2.5 py-2 min-w-0" style={{ background: STAGE_TINT[i % STAGE_TINT.length] }}>
              <p className="text-[11px] font-medium text-ink-muted leading-tight line-clamp-2 min-h-[2lh]">{t(`home.stage.${s}`)}</p>
              <p className="text-lg font-semibold text-ink mt-0.5 tabular-nums">{e.stages[s] ?? 0}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-border">
          <div><p className="text-xs text-ink-muted">{t('home.admissions.enquiries')}</p><p className="text-lg font-semibold text-ink tabular-nums">{e.value}</p></div>
          <div><p className="text-xs text-ink-muted">{t('home.admissions.applications')}</p><p className="text-lg font-semibold text-ink tabular-nums">{e.applications}</p></div>
          <div><p className="text-xs text-ink-muted">{t('home.admissions.conversion')}</p><p className="text-lg font-semibold text-ink tabular-nums">{e.conversion}%</p></div>
        </div>
      </Card>
    ),
    ask.length > 0 && (
      <Card key="ask" className="flex flex-col" bodyClassName="flex flex-col flex-1"
        title={<span className="inline-flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-500" />{t('home.ask.title')}</span>}>
        <p className="text-xs text-ink-muted mb-3">{t('home.ask.hint')}</p>
        <div className="space-y-2 flex-1">
          {ask.map((a) => (
            <button key={a.key} type="button" onClick={() => navigate(a.path)}
              className="w-full text-start text-xs px-3 py-2 rounded-md border border-border text-ink-muted hover:border-brand-300 hover:text-ink transition-colors">
              {t(`home.ask.q.${a.key}`)}
            </button>
          ))}
        </div>
        {hasPermission('ai.assistant.view') && (
          <button type="button" onClick={() => navigate('/ai/assistant')} className="mt-3 flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-start text-sm text-ink-faint hover:border-brand-300">
            <span className="flex-1">{t('home.ask.placeholder')}</span>
            <span className="w-7 h-7 rounded-md bg-brand-500 text-white flex items-center justify-center"><Send className="w-3.5 h-3.5" /></span>
          </button>
        )}
      </Card>
    ),
  ].filter(Boolean)
}

/* ------------------------------------------------------------------ today: donuts + quick actions */

function useTodayCards(d) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const quick = QUICK.filter((q) => hasPermission(q.perm))
  if (!d) return []
  const a = d.kpis.attendance?.today
  const f = d.kpis.fees?.position
  const s = d.kpis.staff?.today
  return [
    a && (
      <Card key="att" title={t('home.today.attendance')} note={t('home.today.today')}>
        <DonutStat centerValue={`${a.marked}/${a.sections}`} centerLabel={t('home.today.classesMarked')} segments={[
          { name: 'p', label: t('home.today.present'), value: a.present, color: HUE.success },
          { name: 'a', label: t('home.today.absent'), value: a.absent, color: HUE.danger },
          { name: 'l', label: t('home.today.onLeave'), value: a.onLeave, color: HUE.amber },
        ]} />
      </Card>
    ),
    f && (
      <Card key="fees" title={t('home.today.fees')} note={d.year?.name}>
        <DonutStat centerValue={money(f.collected)} centerLabel={t('home.today.collected')} format={money} segments={[
          { name: 'c', label: t('home.today.collected'), value: f.collected, color: HUE.success },
          { name: 'd', label: t('home.today.due'), value: f.due, color: HUE.info },
          { name: 'o', label: t('home.today.overdue'), value: f.overdue, color: HUE.danger },
        ]} />
        <p className="mt-3 pt-3 border-t border-border text-xs text-ink-muted">{t('home.today.studentsOwing', { count: f.studentsOwing })}</p>
      </Card>
    ),
    s && (
      <Card key="staff" title={t('home.today.staff')} note={t('home.today.today')}>
        <DonutStat centerValue={d.kpis.staff.value} centerLabel={t('home.today.totalStaff')} segments={[
          { name: 'p', label: t('home.today.present'), value: s.present, color: HUE.success },
          { name: 'a', label: t('home.today.absent'), value: s.absent, color: HUE.danger },
          { name: 'l', label: t('home.today.onLeave'), value: s.onLeave, color: HUE.amber },
          { name: 'n', label: t('home.today.notMarked'), value: s.notMarked, color: HUE.neutral },
        ]} />
      </Card>
    ),
    d.library && (
      <Card key="lib" title={t('home.today.library')}>
        <DonutStat centerValue={d.library.onShelf + d.library.issued + d.library.overdue} centerLabel={t('home.today.copies')} segments={[
          { name: 's', label: t('home.today.onShelf'), value: d.library.onShelf, color: HUE.success },
          { name: 'i', label: t('home.today.issued'), value: d.library.issued, color: HUE.info },
          { name: 'o', label: t('home.today.overdueBooks'), value: d.library.overdue, color: HUE.danger },
        ]} />
        <p className="mt-3 pt-3 border-t border-border text-xs text-ink-muted">{t('home.today.lent', { count: d.library.lent })}</p>
      </Card>
    ),
    d.transport && (
      <Card key="tr" title={t('home.today.transport')}>
        <DonutStat centerValue={d.transport.riders} centerLabel={t('home.today.riders')} segments={[
          { name: 'a', label: t('home.today.onRoad'), value: d.transport.active, color: HUE.success },
          { name: 'm', label: t('home.today.maintenance'), value: d.transport.maintenance, color: HUE.amber },
          { name: 'o', label: t('home.today.offRoad'), value: d.transport.offRoad, color: HUE.neutral },
        ]} />
        <p className="mt-3 pt-3 border-t border-border text-xs text-ink-muted flex items-center gap-1.5"><Bus className="w-3.5 h-3.5" />{t('home.today.vehicles', { count: d.transport.active + d.transport.maintenance + d.transport.offRoad })}</p>
      </Card>
    ),
    quick.length > 0 && (
      <Card key="quick" title={t('home.quick.title')}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {quick.slice(0, 9).map((q) => (
            <button key={q.key} type="button" onClick={() => navigate(q.path)}
              className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-lg border border-border hover:border-brand-300 hover:shadow-sm transition-all">
              <span className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: `${HUE[q.tone]}14`, color: HUE[q.tone] }}><q.icon className="w-4 h-4" /></span>
              <span className="text-[11px] font-medium text-ink-muted text-center leading-tight">{t(`home.quick.${q.key}`)}</span>
            </button>
          ))}
        </div>
      </Card>
    ),
  ].filter(Boolean)
}

/* ------------------------------------------------------------------ every module's pulse */

function Pulse({ items }) {
  const { t } = useTranslation('dashboard')
  if (!items.length) return null
  return (
    <Card title={t('home.pulse.title')} note={t('home.pulse.note')}>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {items.map((p) => {
          const Icon = PULSE_ICON[p.key] ?? BookOpenCheck
          return (
            <Link key={p.key} to={p.link} className="rounded-lg border border-border p-3 hover:border-brand-300 transition-colors min-w-0">
              <Icon className="w-4 h-4 text-ink-faint" />
              <p className="mt-2 text-xl font-semibold text-ink tabular-nums">{p.value}</p>
              <p className="text-xs text-ink-muted leading-tight line-clamp-2">{t(`home.pulse.${p.key}`)}</p>
              {p.more != null && <p className={`text-[11px] truncate ${p.key === 'messages' && p.more ? 'text-danger-600' : 'text-ink-faint'}`}>{t(`home.pulse.${p.key}More`, { count: p.more })}</p>}
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ recent activity */

function Activity({ rows }) {
  const { t } = useTranslation('dashboard')
  const ago = useTimeAgo()
  return (
    <Card title={t('home.activity.title')} action={<Link to="/core/audit" className="text-xs font-medium text-brand-600 hover:underline">{t('home.open')}</Link>}>
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-ink line-clamp-2"><span className="font-medium">{a.who ?? t('home.activity.system')}</span> <span className="text-ink-muted">{a.what}</span></p>
                <p className="text-xs text-ink-faint">{ago(a.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-muted py-8 text-center">{t('home.activity.empty')}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ every module, to jump into */

function Launchpad() {
  const { t } = useTranslation('dashboard')
  const cl = useCatalogLabel()
  const me = useAuthUser()
  const nav = useMemo(() => navFor(me), [me])
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return nav
    return nav.map((cat) => ({ ...cat, modules: cat.modules.filter((m) => cl.module(m).toLowerCase().includes(s) || m.pages.some((p) => cl.page(m.id, p).toLowerCase().includes(s))) }))
      .filter((cat) => cat.modules.length)
  }, [nav, q, cl])
  return (
    <div className="pt-6 border-t border-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink flex items-center gap-2"><Compass className="w-5 h-5 text-brand-600" />{t('dashboard.command.modulesTitle')}</h2>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">{t('dashboard.command.modulesSubtitle')}</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboard.command.searchModules')}
            className="w-full ps-9 pe-3 py-1.5 text-xs rounded-lg border border-border bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>
      <div className="space-y-6">
        {shown.map((cat) => (
          <section key={cat.id}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">{cl.category(cat)}</h3>
              <span className="text-[11px] font-medium text-ink-faint bg-black/5 px-2 py-0.5 rounded-full">{cat.modules.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {cat.modules.map((m) => {
                const Icon = iconFor(m.icon)
                return (
                  <Link key={m.id} to={m.pages[0].path} className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 hover:border-brand-300 transition-colors">
                    <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${cat.color}18`, color: cat.color }}><Icon className="w-5 h-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink text-sm truncate group-hover:text-brand-700">{cl.module(m)}</span>
                      <span className="block text-xs text-ink-muted truncate mt-0.5">{m.pages.slice(0, 3).map((p) => cl.page(m.id, p)).join(' · ')}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand-600 shrink-0 rtl:rotate-180" />
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
