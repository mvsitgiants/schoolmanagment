import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import clsx from 'clsx'

/**
 * A week of a timetable: days across, the bell schedule's slots down (breaks as a band).
 * `cells[day][period]` = { subject, subjectCode, teacher, section, room, locked }. `show` picks the second line:
 * the teacher (a section's week), the section (a teacher's or a room's week).
 */
export default function WeekGrid({ days = [], slots = [], cells = {}, show = 'teacher', onCell, highlight }) {
  const { t } = useTranslation('timetable')
  const cols = { gridTemplateColumns: `minmax(64px, 84px) repeat(${days.length}, minmax(92px, 1fr))` }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-[640px]" style={cols} role="grid">
        <div className="sticky left-0 bg-bg border-b border-border" />
        {days.map((d) => <div key={d} className="px-2 py-2 text-xs font-semibold text-ink-muted text-center bg-bg border-b border-l border-border">{t(`timetable.days.${d}`)}</div>)}
        {slots.map((s, i) => {
          const time = <span className="block text-[10px] text-ink-faint font-mono-num">{s.start}–{s.end}</span>
          if (s.kind !== 'PERIOD') {
            return (
              <div key={`b${i}`} className="contents">
                <div className="sticky left-0 px-2 py-1 bg-bg/70 border-b border-border">{time}</div>
                <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-ink-faint bg-bg/70 border-b border-l border-border text-center" style={{ gridColumn: `span ${days.length}` }}>
                  {s.label || t(`timetable.slotKinds.${s.kind}`)}
                </div>
              </div>
            )
          }
          return (
            <div key={`p${s.no}`} className="contents">
              <div className="sticky left-0 px-2 py-2 bg-surface border-b border-border">
                <span className="text-xs font-semibold text-ink">{t('timetable.grid.period', { no: s.no })}</span>
                {time}
              </div>
              {days.map((d) => {
                const c = cells[d]?.[s.no]
                const hot = highlight?.(d, s.no, c)
                const body = c ? (
                  <>
                    <span className="flex items-center gap-1 text-xs font-medium text-ink truncate">{c.subject || '—'}{c.locked && <Lock className="h-3 w-3 text-ink-faint shrink-0" aria-label={t('timetable.grid.locked')} />}</span>
                    <span className="block text-[11px] text-ink-muted truncate">{show === 'section' ? c.section : c.teacher || t('timetable.grid.noTeacher')}</span>
                    {c.room && <span className="block text-[10px] text-ink-faint truncate">{c.room}</span>}
                  </>
                ) : <span className="text-[11px] text-ink-faint">{onCell ? t('timetable.grid.free') : ''}</span>
                const cls = clsx('min-h-[56px] px-2 py-1.5 border-b border-l border-border text-left', c && 'bg-brand-50/40', hot && 'ring-2 ring-inset ring-amber-400', onCell && 'hover:bg-bg cursor-pointer')
                return onCell
                  ? <button key={d} type="button" className={cls} onClick={() => onCell(d, s.no, c)}>{body}</button>
                  : <div key={d} className={cls}>{body}</div>
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
