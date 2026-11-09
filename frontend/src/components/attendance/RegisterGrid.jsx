import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Download } from 'lucide-react'
import { MARK_BY } from '@schoolgiant/shared'
import { Avatar, EmptyState, TONE } from '../system'
import { PANEL } from '../system/tokens'

// each mark as a small coloured square in the day columns
export const MARK_TONE = { P: 'success', A: 'danger', L: 'warning', HD: 'info', LV: 'neutral' }

const presentOf = (c) => c.P + c.L + 0.5 * c.HD
const pctTone = (v, min) => (v < (min || 75) ? 'danger' : v < 90 ? 'warning' : 'success')
const narrowDay = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' })

/**
 * A section's month as a register: a row per student, a column per day. The student column stays
 * pinned on the left and the % on the right while the days scroll sideways inside the card, so
 * it reads the same on a phone (it opens scrolled to the latest days) as on a wide screen.
 */
export default function RegisterGrid({ title, days, students, minimumPct, exportName, emptyIcon, emptyTitle }) {
  const { t } = useTranslation('attendance')
  const scroller = useRef(null)
  // open on the latest days — on a phone the start of the month is the least useful part
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth }, [days.length, students.length])
  const short = (v) => (v ? t(`attendance.short.${v}`, MARK_BY[v]?.short ?? v) : '')

  const download = () => {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = [t('attendance.register.roll'), t('attendance.register.student'), ...days.map((d) => d.date), t('attendance.register.present'), t('attendance.register.absent'), '%']
    const body = students.map((r) => [r.rollNo, r.name, ...days.map((d) => short(r.marks[d.date])), presentOf(r.counts), r.counts.A, r.pct ?? ''])
    const blob = new Blob([[head, ...body].map((row) => row.map(esc).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${exportName}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const cellDay = 'w-8 shrink-0 flex items-center justify-center'
  const stickyL = 'sticky start-0 z-[1] w-[132px] sm:w-[220px] shrink-0 border-e border-border'
  const stickyR = 'sticky end-0 z-[1] w-16 shrink-0 border-s border-border flex items-center justify-end pe-3'

  return (
    <div className={clsx(PANEL, 'min-w-0 overflow-hidden')}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{title}</p>
        {students.length > 0 && (
          <button type="button" onClick={download} className="inline-flex min-h-[40px] sm:min-h-0 shrink-0 items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
            <Download className="h-3.5 w-3.5" aria-hidden />{t('attendance.register.export')}
          </button>
        )}
      </div>
      {!students.length ? <EmptyState icon={emptyIcon} title={emptyTitle} /> : (
        <div ref={scroller} className="overflow-x-auto scroll-thin" role="table" aria-label={title}>
          <div className="w-max min-w-full text-sm">
            <div role="row" className="flex items-stretch border-b border-border bg-bg text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              <div role="columnheader" className={clsx(stickyL, 'bg-bg px-3 py-2')}>{t('attendance.register.student')}</div>
              {days.map((d) => (
                <div key={d.date} role="columnheader" title={d.date} className={clsx(cellDay, 'flex-col py-1.5 normal-case tracking-normal', !d.taken && 'opacity-50')}>
                  <span className="text-[10px] font-medium">{narrowDay.format(new Date(`${d.date}T00:00:00Z`))}</span>
                  <span className="font-mono-num text-[11px] text-ink-muted">{Number(d.date.slice(8))}</span>
                </div>
              ))}
              <div role="columnheader" className="w-14 shrink-0 flex items-center justify-end pe-2">{t('attendance.register.presentShort')}</div>
              <div role="columnheader" className="w-12 shrink-0 flex items-center justify-end pe-2">{t('attendance.register.absentShort')}</div>
              <div role="columnheader" className={clsx(stickyR, 'bg-bg')}>%</div>
            </div>
            {students.map((r) => (
              <div key={r.id} role="row" className="flex items-stretch border-b border-border last:border-0">
                <div role="cell" className={clsx(stickyL, 'flex items-center gap-2 bg-surface px-3 py-2')}>
                  <span className="w-5 shrink-0 text-end font-mono-num text-xs text-ink-faint">{r.rollNo ?? '–'}</span>
                  <Avatar name={r.name} size={24} soft className="hidden sm:inline-flex" />
                  <span className={clsx('min-w-0 truncate font-medium', r.current ? 'text-ink' : 'text-ink-faint')} title={r.name}>{r.name}</span>
                </div>
                {days.map((d) => {
                  const m = r.marks[d.date]
                  const tone = m ? TONE[MARK_TONE[m] ?? 'neutral'] : null
                  return (
                    <div key={d.date} role="cell" className={cellDay}>
                      {m && <span className={clsx('inline-flex h-6 min-w-[22px] items-center justify-center rounded px-0.5 text-[10.5px] font-semibold font-mono-num', tone.bg, tone.text)}>{short(m)}</span>}
                    </div>
                  )
                })}
                <div role="cell" className={clsx('w-14 shrink-0 flex items-center justify-end pe-2 font-semibold tabular-nums', TONE.success.text)}>{presentOf(r.counts)}</div>
                <div role="cell" className={clsx('w-12 shrink-0 flex items-center justify-end pe-2 tabular-nums', r.counts.A ? clsx('font-semibold', TONE.danger.text) : 'text-ink-faint')}>{r.counts.A}</div>
                <div role="cell" className={clsx(stickyR, 'bg-surface')}>
                  {r.pct == null ? <span className="text-ink-faint">—</span> : <span className={clsx('text-[13px] font-semibold tabular-nums', TONE[pctTone(r.pct, minimumPct)].text)}>{r.pct}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
