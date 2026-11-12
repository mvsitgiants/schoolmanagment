import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpenCheck, CalendarCheck, IndianRupee, Megaphone, Repeat2, UserCheck } from 'lucide-react'
import { hasPermission } from '../../../api/auth'
import { useModules } from '../../../context/ModuleContext'
import { useTimeAgo } from '../../system/timeAgo'
import { Block, usePlain } from './liveKit'

// The principal's dashboard pieces, calm: grey and ink when things are fine, red only for "act now", amber for
// "look today". Number tiles that open the screen where it is dealt with, a ring for today's attendance with the last
// school days beside it, one-tap shortcuts, and the last changes people made.

const TONE_VALUE = { danger: 'text-rose-600', warning: 'text-ink', normal: 'text-ink' }
const TONE_CHIP = { danger: 'bg-rose-50 text-rose-600', warning: 'bg-amber-50 text-amber-600', normal: 'bg-black/[0.04] text-ink-muted' }
const TONE_BAR = { danger: 'bg-rose-500', warning: 'bg-amber-500', normal: 'bg-ink/70' }

/**
 * One figure: an icon, a plain label, the number (with "of N"), a grey line saying what it means, a thin bar when it
 * is a part of a whole. `link` makes the tile open the screen to deal with it; `help` is the hover explanation.
 */
function Tile({ it }) {
  const tone = it.tone ?? 'normal'
  const Icon = it.icon
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', TONE_CHIP[tone])}><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 text-[12.5px] leading-tight text-ink-muted">{it.label}</span>
      </span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span className={clsx('text-2xl font-semibold tabular-nums', TONE_VALUE[tone])}>{it.value}</span>
        {it.of != null && <span className="text-sm tabular-nums text-ink-faint">/ {it.of}</span>}
      </span>
      {it.bar && (
        <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]" aria-hidden>
          <span className={clsx('block h-full rounded-full', TONE_BAR[tone])} style={{ width: `${it.bar.max ? Math.min(100, (it.bar.value / it.bar.max) * 100) : 0}%` }} />
        </span>
      )}
      {it.sub && <span className={clsx('mt-1.5 block text-[11.5px] leading-snug', tone === 'normal' ? 'text-ink-faint' : tone === 'danger' ? 'text-rose-600' : 'text-amber-700')}>{it.sub}</span>}
    </>
  )
  const cls = 'flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 text-start'
  return it.link
    ? <Link to={it.link} title={it.help} className={clsx(cls, 'transition hover:border-brand-300 hover:shadow-sm')}>{body}</Link>
    : <div title={it.help} className={cls}>{body}</div>
}

export function Tiles({ items }) {
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-3 xl:grid-cols-5', 6: 'sm:grid-cols-3 xl:grid-cols-6' }[items.length] ?? 'sm:grid-cols-3'
  return <div className={clsx('grid grid-cols-2 gap-3', cols)}>{items.map((it) => <Tile key={it.key} it={it} />)}</div>
}

// ───────────────────────────────────────────────────────── quick actions

const ACTIONS = [
  { key: 'mark', to: '/attendance/mark', icon: CalendarCheck, module: 'attendance', perm: 'attendance.mark.view' },
  { key: 'cover', to: '/timetable/substitutions', icon: Repeat2, module: 'timetable', perm: 'timetable.substitutions.view' },
  { key: 'staff', to: '/hrms/attendance', icon: UserCheck, module: 'hrms', perm: 'hrms.attendance.view' },
  { key: 'notice', to: '/communication/notices', icon: Megaphone, module: 'communication', perm: 'communication.notices.create' },
  { key: 'dues', to: '/fees/dues', icon: IndianRupee, module: 'fees', perm: 'fees.dues.view' },
  { key: 'syllabus', to: '/homework/syllabus', icon: BookOpenCheck, module: 'homework', perm: 'homework.syllabus.view' },
]

/** One tap to the screens a principal uses most — only those this person may open. */
export function QuickActions({ className }) {
  const { t } = useTranslation('dashboard')
  const { isEnabled } = useModules()
  const list = ACTIONS.filter((a) => isEnabled(a.module) && hasPermission(a.perm))
  if (!list.length) return null
  return (
    <Block title={t('dashboard.live.quick.title')} className={className}>
      <div className="grid grid-cols-2 gap-2 p-3">
        {list.map((a) => (
          <Link key={a.key} to={a.to} className="flex min-h-[64px] flex-col items-start justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-[12.5px] font-medium text-ink transition hover:border-brand-300 hover:bg-brand-50/40">
            <a.icon className="h-4 w-4 text-brand-600" aria-hidden />
            <span className="leading-tight">{t(`dashboard.live.quick.${a.key}`)}</span>
          </Link>
        ))}
      </div>
    </Block>
  )
}

// ───────────────────────────────────────────────────────── a ring

/**
 * A donut: `parts` [{ key, value, className (a stroke colour), label }] around a grey track of `total`; whatever the
 * parts don't fill stays grey. The centre holds `children`. Hovering a part names it.
 */
export function Ring({ parts, total, size = 120, stroke = 12, children, label }) {
  const [hover, setHover] = useState(null)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const sum = parts.reduce((n, p) => n + (p.value || 0), 0)
  const base = Math.max(total ?? sum, sum, 1)
  const shown = parts.filter((p) => p.value > 0)
  const gap = shown.length > 1 || sum < base ? 2 : 0 // a 2px surface gap between the parts
  let at = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-black/[0.07]" />
        {shown.map((p) => {
          const len = (p.value / base) * c
          const dash = Math.max(0, len - gap)
          const el = (
            <circle key={p.key} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={hover === p.key ? stroke + 3 : stroke}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-at} className={clsx(p.className, 'transition-[stroke-width]')}
              onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
              <title>{p.label}</title>
            </circle>
          )
          at += len
          return el
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">{children}</div>
    </div>
  )
}

/** A legend line: a small swatch, the name, the number on the right. */
export function LegendRow({ swatch, label, value, strong }) {
  return (
    <li className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="flex min-w-0 items-center gap-2 text-ink-muted"><span className={clsx('h-2 w-2 shrink-0 rounded-full', swatch)} aria-hidden /><span className="truncate">{label}</span></span>
      <span className={clsx('shrink-0 tabular-nums', strong ?? 'text-ink')}>{value}</span>
    </li>
  )
}

// ───────────────────────────────────────────────────────── today's attendance

/**
 * Students today: a ring of present / absent / on leave over everyone (the grey rest is classes not marked yet), and
 * the last school days as columns of "% present" — one ink colour, a day under 90% in amber, today lighter while
 * classes are still to mark.
 */
export function AttendanceCard({ a, days = [], today, markBefore, className }) {
  const { t } = useTranslation('dashboard')
  const { clock, day } = usePlain()
  const counted = a.counted ?? 0
  const partial = a.marked < a.sections
  return (
    <Block title={t('dashboard.live.att.title')} className={className}
      actions={hasPermission('attendance.reports.view') && <Link to="/attendance/reports" className="text-xs font-medium text-brand-600 hover:underline">{t('dashboard.live.att.link')}</Link>}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-4">
          <Ring total={a.students || counted} label={t('dashboard.live.att.ringLabel', { present: a.present, total: a.students })} parts={[
            { key: 'P', value: a.present, className: 'stroke-brand-500', label: t('dashboard.live.att.presentN', { count: a.present }) },
            { key: 'LV', value: a.onLeave, className: 'stroke-amber-500', label: t('dashboard.live.att.leaveN', { count: a.onLeave }) },
            { key: 'A', value: a.absent, className: 'stroke-rose-500', label: t('dashboard.live.att.absentN', { count: a.absent }) },
          ]}>
            {counted ? (
              <>
                <span className="text-xl font-semibold tabular-nums text-ink">{Math.round(a.pct ?? 0)}%</span>
                <span className="text-[10.5px] leading-tight text-ink-muted">{t('dashboard.live.att.present')}</span>
              </>
            ) : <span className="text-[11px] leading-tight text-ink-muted">{t('dashboard.live.att.noneYet')}</span>}
          </Ring>
          <ul className="min-w-0 flex-1 space-y-1.5">
            <LegendRow swatch="bg-brand-500" label={t('dashboard.live.att.presentL')} value={a.present} />
            <LegendRow swatch="bg-rose-500" label={t('dashboard.live.att.absentL')} value={a.absent} strong={a.absent ? 'font-semibold text-rose-600' : undefined} />
            <LegendRow swatch="bg-amber-500" label={t('dashboard.live.att.leaveL')} value={a.onLeave} />
            {partial && <LegendRow swatch="bg-black/[0.12]" label={t('dashboard.live.att.notMarkedL', { count: a.sections - a.marked })} value={a.notCounted} strong="text-ink-faint" />}
          </ul>
        </div>
        {partial && <p className="text-[11.5px] text-ink-faint">{t('dashboard.live.att.partial', { marked: a.marked, total: a.sections, time: clock(markBefore) })}</p>}
        {days.length > 1 && (
          <div>
            <p className="mb-2 text-[11.5px] font-medium text-ink-muted">{t('dashboard.live.att.lastDays')}</p>
            <div className="flex h-[112px] items-end gap-2">
              {days.map((d) => {
                const isToday = d.date === today
                const low = d.pct != null && d.pct < 90
                return (
                  <div key={d.date} className="group flex min-w-0 flex-1 flex-col items-center gap-1"
                    title={t('dashboard.live.att.dayTitle', { date: day(d.date, { weekday: 'long', day: 'numeric', month: 'long' }), pct: d.pct ?? 0, present: d.present, counted: d.counted, absent: d.absent, classes: d.sections })}>
                    <span className={clsx('text-[11px] font-medium tabular-nums', low ? 'text-amber-700' : 'text-ink-muted')}>{d.pct != null ? `${Math.round(d.pct)}%` : '–'}</span>
                    <span className="flex h-16 w-full items-end justify-center">
                      <span className={clsx('w-full max-w-[30px] rounded-t transition group-hover:brightness-110', low ? 'bg-amber-500' : isToday && partial ? 'bg-ink/25' : 'bg-ink/60')}
                        style={{ height: `${Math.max(2, d.pct ?? 0)}%` }} />
                    </span>
                    <span className={clsx('text-[10.5px]', isToday ? 'font-semibold text-ink' : 'text-ink-faint')}>{isToday ? t('dashboard.live.att.todayShort') : day(d.date, { weekday: 'short' })}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Block>
  )
}

// ───────────────────────────────────────────────────────── recent activity

export function RecentActivity({ rows, className }) {
  const { t } = useTranslation('dashboard')
  const ago = useTimeAgo()
  return (
    <Block title={t('dashboard.live.activity.title')} className={className}
      actions={<Link to="/core/audit" className="text-xs font-medium text-brand-600 hover:underline">{t('dashboard.live.activity.link')}</Link>}>
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-[13px]">
              <p className="line-clamp-2 text-ink"><span className="font-medium">{a.who ?? t('dashboard.live.activity.system')}</span> <span className="text-ink-muted">{a.what}</span></p>
              <p className="text-[11.5px] text-ink-faint">{ago(a.at)}</p>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-6 text-sm text-ink-muted">{t('dashboard.live.activity.empty')}</p>}
    </Block>
  )
}
