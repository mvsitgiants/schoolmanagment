import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Building2, CalendarDays, Users } from 'lucide-react'
import { EMPLOYEE_CATEGORIES } from '@schoolgiant/shared'
import { CalendarNav, ControlChip, EmptyState, FilterBar, SearchInput, SkeletonRows, ViewControls, localIso } from '../../system'
import { fetchLeaveCalendar } from '../../../api/hrms'
import useDebouncedValue from '../../../hooks/useDebouncedValue'
import { getFormatConfig } from '../../../utils/format'
import { useHrLabels } from '../HrKit'
import { useDow } from './LeaveBits'

// Leave › Team calendar: who is away which day of the month, by department — for the principal planning cover and
// checking a week before saying yes. Approved leave is a solid teal block, waiting leave an amber outline; holidays
// and weekly offs are shaded; no-leave days (exams, annual day) carry an amber mark over the day.

const shift = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function TeamCalendar({ departments = [], onOpen }) {
  const { t } = useTranslation('hrmsLeave')
  const L = useHrLabels()
  const dow = useDow()
  const today = localIso(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [dept, setDept] = useState('')
  const [cat, setCat] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const params = { month, departmentId: dept || undefined, category: cat || undefined, search: q || undefined }
  const { data, isLoading } = useQuery({ queryKey: ['leave-calendar', params], queryFn: () => fetchLeaveCalendar(params), placeholderData: (p) => p })
  const days = data?.days ?? []
  const groups = useMemo(() => {
    const out = []
    for (const r of data?.rows ?? []) {
      const key = r.department ?? ''
      if (!out.length || out.at(-1).key !== key) out.push({ key, rows: [] })
      out.at(-1).rows.push(r)
    }
    return out
  }, [data])
  const monthLabel = new Intl.DateTimeFormat(getFormatConfig().locale || 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
  const busiest = days.reduce((m, d) => Math.max(m, d.onLeave + d.waiting), 0)
  const shade = (d) => (d.off || d.vacation ? 'bg-black/[0.035]' : '')
  return (
    <div className="flex flex-col gap-4">
      <FilterBar search={<SearchInput value={search} onChange={setSearch} placeholder={t('hrmsLeave.calendar.search')} />}>
        <ViewControls>
          {/* the same ‹ Today › header as every calendar */}
          <CalendarNav title={monthLabel} onPrev={() => setMonth((m) => shift(m, -1))} onNext={() => setMonth((m) => shift(m, 1))} onToday={() => setMonth(today.slice(0, 7))}
            prevLabel={t('hrmsLeave.calendar.prev')} nextLabel={t('hrmsLeave.calendar.next')} />
          <ControlChip icon={Building2} label={t('hrmsLeave.filters.department')} value={departments.find((d) => d.id === dept)?.name ?? t('hrmsLeave.filters.all')} active={!!dept}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} onChange={setDept} />
          <ControlChip icon={Users} label={t('hrmsLeave.filters.staff')} value={cat ? L.category(cat) : t('hrmsLeave.filters.all')} active={!!cat}
            options={[{ value: '', label: t('hrmsLeave.filters.all') }, ...EMPLOYEE_CATEGORIES.map((c) => ({ value: c.value, label: L.category(c.value) }))]} onChange={setCat} />
        </ViewControls>
      </FilterBar>
      {data && (
        <p className="text-sm text-ink-muted">
          {data.rows.length ? t('hrmsLeave.calendar.summary', { count: data.rows.length, total: data.staffCount, month: monthLabel }) : t('hrmsLeave.calendar.nobody', { month: monthLabel })}
          {busiest > 1 && <> · {t('hrmsLeave.calendar.busiest', { count: busiest })}</>}
        </p>
      )}
      {isLoading && !data ? <SkeletonRows rows={6} /> : !data?.rows.length ? (
        <EmptyState icon={CalendarDays} title={t('hrmsLeave.calendar.emptyTitle')} hint={t('hrmsLeave.calendar.emptyHint')} />
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto scroll-thin">
          <div className="w-full min-w-max">
            {/* the day header */}
            <div className="flex border-b border-border sticky top-0 bg-surface z-[2]">
              <div className="sticky start-0 z-[3] w-40 sm:w-52 shrink-0 bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('hrmsLeave.calendar.person')}</div>
              {days.map((d) => (
                <div key={d.date} title={[d.holiday, d.vacation, ...d.noLeave].filter(Boolean).join(' · ') || undefined}
                  className={clsx('relative flex-1 basis-0 min-w-[28px] py-1.5 text-center', shade(d))}>
                  <p className="text-[10px] text-ink-faint leading-none">{dow(d.date).slice(0, 2)}</p>
                  <p className={clsx('mx-auto mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums', d.date === today ? 'font-semibold text-brand-700 ring-2 ring-brand-500' : 'text-ink')}
                    aria-current={d.date === today ? 'date' : undefined}>{Number(d.date.slice(8))}</p>
                  {d.noLeave.length > 0 && <span className="absolute top-0 inset-x-1 h-0.5 rounded-full bg-amber-400" aria-label={d.noLeave.join(', ')} />}
                </div>
              ))}
            </div>
            {groups.map((g) => (
              <div key={g.key || '_'}>
                <div className="flex border-b border-border bg-bg/70">
                  <div className="sticky start-0 z-[1] w-40 sm:w-52 shrink-0 bg-bg px-3 py-1 text-[11px] font-semibold text-ink-muted truncate">{g.key || t('hrmsLeave.calendar.noDepartment')}</div>
                  <div className="flex-1" />
                </div>
                {g.rows.map((r) => (
                  <div key={r.employeeId} className="flex border-b border-border last:border-0 hover:bg-black/[0.015]">
                    <div className="sticky start-0 z-[1] w-40 sm:w-52 shrink-0 bg-surface px-3 py-1.5 min-w-0">
                      <p className="text-sm text-ink truncate">{r.name}</p>
                      {r.designation && <p className="text-[11px] text-ink-faint truncate">{r.designation}</p>}
                    </div>
                    {days.map((d) => {
                      const c = r.cells[d.date]
                      return (
                        <div key={d.date} className={clsx('flex-1 basis-0 min-w-[28px] flex items-center justify-center', shade(d))}>
                          {c && (
                            <button type="button" onClick={() => onOpen?.(c.leaveId)} title={`${c.name}${c.status === 'PENDING' ? ` — ${t('hrmsLeave.calendar.waiting')}` : ''}`}
                              aria-label={`${r.name}: ${c.name}, ${d.date}`}
                              className={clsx('h-6 rounded-[5px]', c.portion < 1 ? 'w-3' : 'w-[calc(100%-6px)] max-w-[28px] min-w-[22px]',
                                c.status === 'APPROVED' ? 'bg-brand-500 hover:bg-brand-600' : 'border-2 border-dashed border-amber-400 bg-amber-50 hover:bg-amber-100')} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
            {/* how many are away each day */}
            <div className="flex border-t border-border bg-bg/70">
              <div className="sticky start-0 z-[1] w-40 sm:w-52 shrink-0 bg-bg px-3 py-1.5 text-[11px] font-semibold text-ink-muted">{t('hrmsLeave.calendar.away')}</div>
              {days.map((d) => (
                <div key={d.date} className={clsx('flex-1 basis-0 min-w-[28px] py-1.5 text-center text-[11px] tabular-nums text-ink-muted', shade(d))}>{d.onLeave + d.waiting || ''}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-[3px] bg-brand-500" />{t('hrmsLeave.calendar.legendApproved')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-[3px] border-2 border-dashed border-amber-400 bg-amber-50" />{t('hrmsLeave.calendar.legendWaiting')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-2 rounded-[3px] bg-brand-500" />{t('hrmsLeave.calendar.legendHalf')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-[3px] bg-black/[0.07]" />{t('hrmsLeave.calendar.legendOff')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-amber-400" />{t('hrmsLeave.calendar.legendNoLeave')}</span>
      </div>
    </div>
  )
}
