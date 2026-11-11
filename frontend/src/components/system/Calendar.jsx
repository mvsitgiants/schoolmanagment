import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { addDaysYmd } from '@schoolgiant/shared'
import { useFormat } from '../../context/SettingsContext'
import useMediaQuery from '../../hooks/useMediaQuery'
import Button from '../ui/Button'
import SegmentedControl from './SegmentedControl'
import { localIso } from './DateRangeChip'

/**
 * The one calendar every screen uses: Month (7-column grid), Week (7 columns, each day's items stacked) and Agenda
 * (a list grouped by day), with ‹ Today › and a view switch. Calm on purpose: white / grey cells, the teal accent for
 * today and the chosen day, amber / red only on items that need someone to act. An item's kind is a small grey icon
 * and a short word — never a colour of its own.
 *
 *   <Calendar items={[{ id, date: '2026-11-14', endDate, title, time: '09:30', endTime, kind: 'Exam', icon: NotebookPen,
 *                       tone: 'neutral' | 'accent' | 'warning' | 'danger', muted, sub, onClick }]}
 *     views={['month', 'week', 'agenda']} month={ym} onMonthChange={setYm} onRangeChange={({ from, to }) => …}
 *     holidays={[{ date, endDate?, name, onClick? }]} weekStartsOn="MONDAY" loading legend={[{ tone, label }]}
 *     dayTotals={{ '2026-11-14': 7 }} onAdd={(day) => …} renderItem={(item, day) => …} renderDayPanel={(day, items, list) => …} />
 *
 * On a phone (< 640px, or `compact`) the month grid shows dots and the chosen day's list sits below it.
 * `dayTotals` — when the server sends only the first few items of a day, its full count (for "+N more").
 */

const MAX_BARS = 3
const BAR = {
  neutral: 'bg-black/[0.05] text-ink hover:bg-black/[0.08]',
  accent: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  warning: 'bg-amber-50 text-amber-600 font-medium hover:brightness-95',
  danger: 'bg-danger-50 text-danger-700 font-medium hover:bg-danger-100',
}
const DOT = { neutral: 'bg-black/30', accent: 'bg-brand-500', warning: 'bg-amber-400', danger: 'bg-danger-500' }
const STRIPE = { neutral: 'bg-black/15', accent: 'bg-brand-500', warning: 'bg-amber-400', danger: 'bg-danger-500' }

const dowOf = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const startOfWeek = (d, sundayFirst) => addDaysYmd(d, -(sundayFirst ? dowOf(d) : (dowOf(d) + 6) % 7))
const lastOfMonth = (ym) => addDaysYmd(`${shiftMonth(ym, 1)}-01`, -1)
const daysBetween = (from, to) => { const out = []; for (let d = from; d <= to; d = addDaysYmd(d, 1)) out.push(d); return out }
function monthWeeks(ym, sundayFirst) {
  let d = startOfWeek(`${ym}-01`, sundayFirst)
  const weeks = []
  do {
    const w = []
    for (let i = 0; i < 7; i++) { w.push(d); d = addDaysYmd(d, 1) }
    weeks.push(w)
  } while (d.slice(0, 7) === ym)
  return weeks
}
const byTime = (a, b) => (b._end > b.date) - (a._end > a.date) || (a.time ?? '').localeCompare(b.time ?? '') || String(a.title).localeCompare(String(b.title))

/** Lay a week's items into lanes: multi-day items span their days; each lane holds items that don't overlap. */
function layoutWeek(week, items) {
  const s = week[0]
  const e = week[6]
  const segs = items.filter((i) => i.date <= e && i._end >= s).map((i) => ({ item: i, start: week.indexOf(i.date < s ? s : i.date), end: week.indexOf(i._end > e ? e : i._end) }))
  segs.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || byTime(a.item, b.item))
  const lanes = []
  for (const sg of segs) {
    let l = lanes.findIndex((last) => last < sg.start)
    if (l < 0) { l = lanes.length; lanes.push(-1) }
    lanes[l] = sg.end
    sg.lane = l
  }
  return segs
}

function useCalendarText() {
  const { t, i18n } = useTranslation('ui')
  const fmt = useFormat()
  const lang = i18n.language || 'en'
  return useMemo(() => {
    const at = (opts) => new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...opts })
    const wdShort = at({ weekday: 'short' })
    const wdNarrow = at({ weekday: 'narrow' })
    const wdLong = at({ weekday: 'long' })
    const monthYear = at({ month: 'long', year: 'numeric' })
    const clock = at({ hour: 'numeric', minute: '2-digit' })
    const day = (d) => new Date(`${d}T12:00:00Z`)
    const time = (v) => {
      if (!v) return ''
      if (/^\d{1,2}:\d{2}$/.test(v)) return clock.format(new Date(`1970-01-01T${v.padStart(5, '0')}:00Z`))
      return /T/.test(v) ? fmt.time(v) : v
    }
    return {
      t,
      weekday: (d, size = 'short') => (size === 'long' ? wdLong : size === 'narrow' ? wdNarrow : wdShort).format(day(d)),
      month: (ym) => monthYear.format(day(`${ym}-01`)),
      date: (d) => fmt.date(d),
      time,
      timeRange: (i) => (i.time ? (i.endTime ? `${time(i.time)} – ${time(i.endTime)}` : time(i.time)) : ''),
    }
  }, [t, lang, fmt])
}

/** ‹ Today › and a title — the calendar's header, also used by the people × days timelines (Team calendar). */
export function CalendarNav({ title, onPrev, onNext, onToday, prevLabel, nextLabel, prevDisabled, nextDisabled, todayDisabled, className }) {
  const { t } = useTranslation('ui')
  return (
    <div className={clsx('flex min-w-0 items-center gap-1', className)}>
      <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={prevLabel ?? t('ui.calendar.prev')} disabled={prevDisabled} onClick={onPrev} />
      <Button size="sm" variant="secondary" disabled={todayDisabled} onClick={onToday}>{t('ui.calendar.today')}</Button>
      <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={nextLabel ?? t('ui.calendar.next')} disabled={nextDisabled} onClick={onNext} />
      <h3 className="ms-2 min-w-0 truncate font-display text-base font-semibold text-ink first-letter:uppercase" aria-live="polite">{title}</h3>
    </div>
  )
}

/** One item in a list (day panel, agenda, phone week): time, tone stripe, title, kind (grey icon + word). */
function ItemRow({ item, text, timed }) {
  const Icon = item.icon
  const multi = item._end > item.date
  const Tag = item.onClick ? 'button' : 'div'
  return (
    <Tag {...(item.onClick ? { type: 'button', onClick: () => item.onClick(item) } : {})}
      className={clsx('flex w-full items-stretch gap-2.5 rounded-lg px-2 py-1.5 text-start', item.onClick && 'hover:bg-black/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40')}>
      <span className={clsx('w-1 shrink-0 rounded-full', STRIPE[item.tone] ?? STRIPE.neutral)} aria-hidden />
      {timed && <span className="w-[4.5rem] shrink-0 pt-px text-xs tabular-nums text-ink-muted">{item.time ? text.time(item.time) : text.t('ui.calendar.allDay')}</span>}
      <span className="min-w-0 flex-1">
        <span className={clsx('block break-words text-sm font-medium text-ink', item.muted && 'italic text-ink-muted')}>{item.title}</span>
        {(item.kind || Icon || item.sub || multi || item.endTime) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}
            {[item.kind, item.endTime && text.timeRange(item), multi && `${text.date(item.date)} – ${text.date(item._end)}`, item.sub].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </Tag>
  )
}

function DayList({ day, items, holiday, text, renderItem, emptyText, timed }) {
  return (
    <div className="space-y-0.5">
      {holiday && (
        holiday.onClick
          ? <button type="button" onClick={() => holiday.onClick(holiday)} className="block w-full rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-start text-sm text-ink-muted hover:bg-black/[0.07]">{holiday.name}</button>
          : <p className="rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-sm text-ink-muted">{holiday.name}</p>
      )}
      {items.map((i) => <div key={i.id}>{renderItem ? renderItem(i, day) : <ItemRow item={i} text={text} timed={timed} />}</div>)}
      {!items.length && !holiday && emptyText && <p className="px-2 py-1.5 text-sm text-ink-faint">{emptyText}</p>}
    </div>
  )
}

function DayPanel({ day, items, holiday, text, renderItem, renderDayPanel, onAdd, addLabel, extra, timed }) {
  if (!day) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-ink-faint">{text.t('ui.calendar.pickDay')}</div>
  const list = <DayList day={day} items={items} holiday={holiday} text={text} renderItem={renderItem} emptyText={text.t('ui.calendar.nothing')} timed={timed} />
  return (
    <section className="rounded-xl border border-border bg-surface p-3" aria-label={text.date(day)}>
      <div className="mb-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted first-letter:uppercase">{text.weekday(day, 'long')}</p>
          <h4 className="font-display text-base font-semibold text-ink">{text.date(day)}</h4>
        </div>
        {onAdd && <Button size="sm" variant="secondary" icon={Plus} onClick={() => onAdd(day)}>{addLabel ?? text.t('ui.calendar.add')}</Button>}
      </div>
      {renderDayPanel ? renderDayPanel(day, items, list) : list}
      {extra > 0 && <p className="mt-1 px-2 text-xs text-ink-faint">{text.t('ui.calendar.moreThanShown', { count: extra })}</p>}
    </section>
  )
}

function DayNumber({ day, today, other, text }) {
  return (
    <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums',
      day === today ? 'font-semibold text-brand-700 ring-2 ring-brand-500' : other ? 'text-ink-faint' : 'text-ink')}
      aria-current={day === today ? 'date' : undefined} title={day === today ? text.t('ui.calendar.today') : undefined}>{Number(day.slice(8))}</span>
  )
}

export default function Calendar({
  items = [], holidays = [], views = ['month'], view: viewProp, defaultView, onViewChange,
  month, onMonthChange, onRangeChange, minMonth, maxMonth, weekStartsOn = 'MONDAY', weekend = [0, 6],
  loading = false, legend = [], emptyText, dayTotals, onDayClick, onAdd, addLabel, renderItem, renderDayPanel,
  dayPanel = true, panelBelow = false, compact: compactProp, actions, className,
}) {
  const text = useCalendarText()
  const { t } = text
  const phone = useMediaQuery('(max-width: 639.98px)')
  const compact = compactProp ?? phone
  const today = localIso(new Date())
  const sundayFirst = weekStartsOn === 'SUNDAY' || weekStartsOn === true

  const [viewState, setViewState] = useState(defaultView ?? views[0])
  const view = views.includes(viewProp) ? viewProp : views.includes(viewState) ? viewState : views[0]
  const setView = (v) => { setViewState(v); onViewChange?.(v) }

  const [anchorState, setAnchorState] = useState(() => (month && !today.startsWith(month) ? `${month}-01` : today))
  const anchor = month && !anchorState.startsWith(month) ? `${month}-01` : anchorState
  const ym = anchor.slice(0, 7)
  const [picked, setPicked] = useState(null)
  const go = (d) => { setAnchorState(d); if (d.slice(0, 7) !== ym) onMonthChange?.(d.slice(0, 7)) }

  const weeks = useMemo(() => monthWeeks(ym, sundayFirst), [ym, sundayFirst])
  const weekFrom = startOfWeek(anchor, sundayFirst)
  const week = useMemo(() => daysBetween(weekFrom, addDaysYmd(weekFrom, 6)), [weekFrom])
  const range = view === 'week' ? { from: week[0], to: week[6] } : view === 'agenda' ? { from: `${ym}-01`, to: lastOfMonth(ym) } : { from: weeks[0][0], to: weeks.at(-1)[6] }
  const rangeCb = useRef(onRangeChange)
  rangeCb.current = onRangeChange
  useEffect(() => { rangeCb.current?.({ ...range, view }) }, [range.from, range.to, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => items.map((i) => ({ ...i, tone: BAR[i.tone] ? i.tone : 'neutral', _end: i.endDate && i.endDate > i.date ? i.endDate : i.date })).sort(byTime), [items])
  // the time column in lists only when something has a time (lesson plans and attendance marks don't)
  const timed = all.some((i) => i.time)
  const itemsOn = (d) => all.filter((i) => i.date <= d && i._end >= d)
  const holidayOn = (d) => holidays.find((h) => h.date <= d && (h.endDate && h.endDate > h.date ? h.endDate : h.date) >= d)
  const isWeekend = (d) => weekend.includes(dowOf(d))

  const selected = picked && (view !== 'month' || picked.slice(0, 7) === ym) ? picked : today.slice(0, 7) === ym ? today : null
  const pick = (d) => {
    const dm = d.slice(0, 7)
    if ((minMonth && dm < minMonth) || (maxMonth && dm > maxMonth)) return
    setPicked(d)
    if (dm !== ym) go(d)
    onDayClick?.(d)
  }

  // ‹ › move a month (a week in Week view)
  const step = (n) => (view === 'week' ? go(addDaysYmd(anchor, 7 * n)) : go(`${shiftMonth(ym, n)}-01`))
  const nextYm = view === 'week' ? addDaysYmd(weekFrom, 7).slice(0, 7) : shiftMonth(ym, 1)
  const prevYm = view === 'week' ? addDaysYmd(weekFrom, -1).slice(0, 7) : shiftMonth(ym, -1)
  const title = view === 'week' ? t('ui.calendar.weekTitle', { from: text.date(week[0]), to: text.date(week[6]) }) : text.month(ym)
  const viewLabel = { month: t('ui.calendar.views.month'), week: t('ui.calendar.views.week'), agenda: t('ui.calendar.views.agenda') }

  const extraOn = (d, shown) => (dayTotals && dayTotals[d] != null ? Math.max(0, dayTotals[d] - shown) : 0)

  // ── Month, desktop: lanes of bars per week, "+N more" opens the day
  const monthGrid = (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-black/[0.02] text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {weeks[0].map((d) => <div key={d} className="py-1.5">{text.weekday(d, compact ? 'narrow' : 'short')}</div>)}
      </div>
      {weeks.map((w, wi) => {
        if (compact) {
          return (
            <div key={w[0]} className={clsx('grid grid-cols-7', wi > 0 && 'border-t border-border')}>
              {w.map((d, ci) => {
                const its = itemsOn(d)
                const hol = holidayOn(d)
                const other = d.slice(0, 7) !== ym
                const n = Math.max(its.length, dayTotals?.[d] ?? 0)
                return (
                  <button key={d} type="button" onClick={() => pick(d)} aria-pressed={d === selected}
                    aria-label={[text.date(d), hol?.name, n ? t('ui.calendar.dayCount', { count: n }) : null].filter(Boolean).join(', ')}
                    className={clsx('flex min-h-[52px] flex-col items-center gap-1 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40',
                      ci > 0 && 'border-s border-border', d === selected ? 'bg-brand-50' : hol ? 'bg-black/[0.06]' : other ? 'bg-black/[0.015]' : isWeekend(d) ? 'bg-black/[0.025]' : '')}>
                    <DayNumber day={d} today={today} other={other} text={text} />
                    <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                      {its.slice(0, MAX_BARS).map((i) => <span key={i.id} className={clsx('h-1.5 w-1.5 rounded-full', DOT[i.tone], i.muted && 'opacity-50')} />)}
                      {n > MAX_BARS && <span className="text-[9px] leading-none text-ink-muted">+</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        }
        const segs = layoutWeek(w, all)
        // a week is only as tall as what it holds: the day number, the bar lanes it uses, a "+N more" line if needed
        const lanes = Math.min(MAX_BARS, segs.reduce((m, sg) => Math.max(m, sg.lane + 1), 0))
        const moreOf = (d, ci) => {
          const shown = segs.filter((sg) => sg.lane < MAX_BARS && sg.start <= ci && sg.end >= ci).length
          const hidden = segs.filter((sg) => sg.lane >= MAX_BARS && sg.start <= ci && sg.end >= ci).length
          return dayTotals && dayTotals[d] != null ? extraOn(d, shown) : hidden
        }
        const hasMore = w.some((d, ci) => moreOf(d, ci) > 0)
        const rows = ['26px', ...Array(lanes).fill('18px'), ...(hasMore ? ['14px'] : []), 'minmax(4px, 1fr)'].join(' ')
        return (
          <div key={w[0]} className={clsx('grid grid-cols-7 gap-y-0.5', wi > 0 && 'border-t border-border')} style={{ gridTemplateRows: rows, minHeight: 64 }}>
            {w.map((d, ci) => {
              const hol = holidayOn(d)
              const other = d.slice(0, 7) !== ym
              const n = Math.max(itemsOn(d).length, dayTotals?.[d] ?? 0)
              return (
                <button key={d} type="button" onClick={() => pick(d)} aria-pressed={d === selected}
                  aria-label={[text.date(d), hol?.name, n ? t('ui.calendar.dayCount', { count: n }) : null].filter(Boolean).join(', ')}
                  style={{ gridColumn: ci + 1, gridRow: '1 / -1' }}
                  className={clsx('flex min-w-0 items-start gap-1 px-1 pt-1 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40',
                    ci > 0 && 'border-s border-border', d === selected ? 'bg-brand-50/70' : hol ? 'bg-black/[0.05]' : other ? 'bg-black/[0.015]' : isWeekend(d) ? 'bg-black/[0.02]' : 'hover:bg-black/[0.015]')}>
                  <DayNumber day={d} today={today} other={other} text={text} />
                  {hol && <span className="min-w-0 truncate pt-1 text-[10px] text-ink-muted" title={hol.name}>{hol.name}</span>}
                </button>
              )
            })}
            {segs.filter((sg) => sg.lane < MAX_BARS).map((sg) => {
              const i = sg.item
              const fromBefore = i.date < w[0]
              const runsOn = i._end > w[6]
              return (
                <button key={`${i.id}-${w[0]}`} type="button" title={[i.time && text.timeRange(i), i.title, i.kind].filter(Boolean).join(' · ')}
                  onClick={() => (i.onClick ? i.onClick(i) : pick(i.date < w[0] ? w[0] : i.date))}
                  style={{ gridColumn: `${sg.start + 1} / ${sg.end + 2}`, gridRow: sg.lane + 2 }}
                  className={clsx('relative z-[1] mx-0.5 flex min-w-0 items-center gap-1 truncate rounded px-1.5 text-start text-[11px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    BAR[i.tone], i.muted && 'italic opacity-60', fromBefore && 'ms-0 rounded-s-none', runsOn && 'me-0 rounded-e-none')}>
                  {i.icon && <i.icon className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />}
                  {i.time && !fromBefore && <span className="shrink-0 tabular-nums opacity-80">{text.time(i.time)}</span>}
                  <span className="min-w-0 truncate">{i.title}</span>
                </button>
              )
            })}
            {w.map((d, ci) => {
              const more = moreOf(d, ci)
              return more > 0 && (
                <button key={`more-${d}`} type="button" onClick={() => pick(d)} style={{ gridColumn: ci + 1, gridRow: lanes + 2 }}
                  className="relative z-[1] mx-0.5 truncate rounded px-1.5 text-start text-[10px] leading-4 text-ink-muted hover:bg-black/[0.04] hover:text-ink">
                  {t('ui.calendar.more', { count: more })}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  // ── Week: 7 columns with each day's items (a list of the 7 days on a phone)
  const weekGrid = compact ? (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {week.map((d) => (
        <div key={d} className={clsx('p-2', isWeekend(d) && 'bg-black/[0.015]')}>
          <button type="button" onClick={() => pick(d)} className="mb-1 flex items-center gap-2 px-1 text-start">
            <DayNumber day={d} today={today} text={text} />
            <span className="text-xs font-medium text-ink-muted first-letter:uppercase">{text.weekday(d, 'long')}</span>
          </button>
          <DayList day={d} items={itemsOn(d)} holiday={holidayOn(d)} text={text} renderItem={renderItem} timed={timed} />
        </div>
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border bg-surface">
      {week.map((d, ci) => {
        const hol = holidayOn(d)
        const its = itemsOn(d)
        const more = extraOn(d, its.length)
        return (
          <div key={d} className={clsx('flex min-h-[140px] min-w-0 flex-col', ci > 0 && 'border-s border-border', hol ? 'bg-black/[0.05]' : isWeekend(d) ? 'bg-black/[0.02]' : '')}>
            <button type="button" onClick={() => pick(d)} className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-start hover:bg-black/[0.02]">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{text.weekday(d)}</span>
              <DayNumber day={d} today={today} text={text} />
            </button>
            <div className="flex-1 space-y-1 p-1">
              {hol && <p className="truncate px-1 text-[11px] text-ink-muted" title={hol.name}>{hol.name}</p>}
              {its.map((i) => (
                <button key={i.id} type="button" disabled={!i.onClick} onClick={() => i.onClick?.(i)} title={[i.title, i.kind].filter(Boolean).join(' · ')}
                  className={clsx('block w-full rounded px-1.5 py-1 text-start text-[11px] leading-snug disabled:cursor-default', BAR[i.tone], i.muted && 'italic opacity-60')}>
                  {i.time && <span className="block tabular-nums opacity-80">{text.timeRange(i)}</span>}
                  <span className="flex items-start gap-1">{i.icon && <i.icon className="mt-px h-3 w-3 shrink-0 text-ink-faint" aria-hidden />}<span className="min-w-0 break-words">{i.title}</span></span>
                </button>
              ))}
              {more > 0 && <p className="px-1.5 text-[10px] text-ink-muted">{t('ui.calendar.more', { count: more })}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── Agenda: the month's days that have something on, in order
  const agendaDays = view === 'agenda' ? daysBetween(range.from, range.to).filter((d) => holidayOn(d) || itemsOn(d).length) : []
  const agenda = agendaDays.length ? (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {agendaDays.map((d) => (
        <div key={d} className={clsx('flex flex-col gap-1 p-2 sm:flex-row sm:gap-3', d < today && 'opacity-70')}>
          <div className="flex shrink-0 items-center gap-2 px-1 sm:w-40 sm:items-start sm:pt-1.5">
            <DayNumber day={d} today={today} text={text} />
            <span className="leading-tight">
              <span className="block text-xs font-medium text-ink first-letter:uppercase">{text.weekday(d, 'long')}</span>
              <span className="block text-[11px] text-ink-muted">{d === today ? t('ui.calendar.today') : text.date(d)}</span>
            </span>
          </div>
          <div className="min-w-0 flex-1"><DayList day={d} items={itemsOn(d)} holiday={holidayOn(d)} text={text} renderItem={renderItem} timed={timed} /></div>
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-ink-faint">{emptyText ?? t('ui.calendar.empty')}</div>
  )

  const showPanel = dayPanel && view === 'month'
  const side = showPanel && !compact && !panelBelow
  const panel = showPanel && (
    <DayPanel day={selected} items={selected ? itemsOn(selected) : []} holiday={selected ? holidayOn(selected) : null} text={text}
      renderItem={renderItem} renderDayPanel={renderDayPanel} onAdd={onAdd} addLabel={addLabel} timed={timed}
      extra={selected ? extraOn(selected, itemsOn(selected).length) : 0} />
  )
  const legendRow = (legend.length > 0 || holidays.length > 0) && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
      {legend.map((l) => (
        <span key={l.label} className={clsx('inline-flex items-center gap-1.5', l.muted && 'italic')}>
          <span className={clsx('h-2.5 w-2.5 rounded-sm', DOT[l.tone] ?? DOT.neutral, l.muted && 'opacity-50')} aria-hidden />{l.label}
        </span>
      ))}
      {holidays.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-border bg-black/[0.08]" aria-hidden />{t('ui.calendar.holiday')}</span>}
    </div>
  )

  return (
    <div className={clsx('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CalendarNav title={title} onPrev={() => step(-1)} onNext={() => step(1)} onToday={() => { go(today); setPicked(today) }}
          prevLabel={view === 'week' ? t('ui.calendar.prevWeek') : t('ui.calendar.prev')} nextLabel={view === 'week' ? t('ui.calendar.nextWeek') : t('ui.calendar.next')}
          prevDisabled={!!minMonth && prevYm < minMonth} nextDisabled={!!maxMonth && nextYm > maxMonth}
          todayDisabled={(!!minMonth && today.slice(0, 7) < minMonth) || (!!maxMonth && today.slice(0, 7) > maxMonth)} />
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {views.length > 1 && <SegmentedControl value={view} onChange={setView} options={views.map((v) => ({ value: v, label: viewLabel[v] }))} />}
        </div>
      </div>
      <div className={clsx(side && 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start')}>
        <div className={clsx('flex min-w-0 flex-col gap-3 transition-opacity', loading && 'pointer-events-none opacity-60')} aria-busy={loading || undefined}>
          {view === 'week' ? weekGrid : view === 'agenda' ? agenda : monthGrid}
          {legendRow}
        </div>
        {side ? <div className="mt-3 lg:sticky lg:top-4 lg:mt-0">{panel}</div> : panel && <div>{panel}</div>}
      </div>
    </div>
  )
}
