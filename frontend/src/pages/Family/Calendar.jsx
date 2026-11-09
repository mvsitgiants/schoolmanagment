import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, MapPin, X } from 'lucide-react'
import { CALENDAR_SOURCES, EVENT_KIND_BY } from '@schoolgiant/shared'
import { TONE } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCalendar, familyEventReply } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { EventPassButton } from '../../components/family/Passes'

const tone = (i) => (i.source === 'EVENT' ? EVENT_KIND_BY[i.kind]?.tone : CALENDAR_SOURCES[i.source]?.tone) ?? 'neutral'

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** The day of the month on the item's colour, with the weekday — scannable down a month. */
function DateTile({ day, tone: k }) {
  const { t } = useTranslation('family')
  const c = TONE[k] ?? TONE.neutral
  const wd = WD[new Date(`${day}T00:00:00Z`).getUTCDay()]
  return (
    <span className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border ${c.bg} ${c.border} ${c.text}`}>
      <span className="text-[10px] font-semibold uppercase leading-none">{t(`family.timetable.day.${wd}`)}</span>
      <span className="mt-0.5 text-lg font-bold leading-none tabular-nums">{Number(day.slice(8, 10))}</span>
    </span>
  )
}

function Reply({ item }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const [note, setNote] = useState(item.reply.note ?? '')
  const send = useMutation({ mutationFn: (answer) => familyEventReply(slug, studentId, item.id, { answer, note: note || undefined }), onSuccess: () => qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'calendar'] }) })
  const r = item.reply
  const words = r.kind === 'CONSENT' ? { YES: t('family.calendar.consentYes'), NO: t('family.calendar.consentNo') } : { YES: t('family.calendar.going'), NO: t('family.calendar.notGoing') }
  return (
    <div className="mt-2 rounded-xl bg-black/[0.03] p-3">
      <p className="text-sm text-ink">{r.question || (r.kind === 'CONSENT' ? t('family.calendar.consentAsk') : t('family.calendar.rsvpAsk'))}</p>
      {r.answer && <p className="mt-1 text-xs font-medium text-success-600">{t('family.calendar.youReplied', { answer: words[r.answer] })}</p>}
      {r.answer === 'YES' && <EventPassButton eventId={item.id} />}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('family.calendar.notePlaceholder')} className="mt-2 min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-[15px]" aria-label={t('family.calendar.notePlaceholder')} />
      <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <Button icon={Check} variant={r.answer === 'YES' ? 'primary' : 'secondary'} loading={send.isPending && send.variables === 'YES'} onClick={() => send.mutate('YES')}>{words.YES}</Button>
        <Button icon={X} variant={r.answer === 'NO' ? 'primary' : 'secondary'} loading={send.isPending && send.variables === 'NO'} onClick={() => send.mutate('NO')}>{words.NO}</Button>
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">{t('family.calendar.replyBy', { date: date(r.by) })}</p>
      {send.error && <p className="mt-1 text-xs text-danger-600">{send.error.message}</p>}
    </div>
  )
}

/** The family app › Calendar: the next three months — events, holidays, exams, meetings; replies where asked. */
export default function FamilyCalendar() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data, isLoading, error } = useFamilyQuery(['calendar'], () => familyCalendar(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.items.length) return <FCard><FEmpty icon={CalendarDays} title={t('family.calendar.empty')} /></FCard>
  const months = [...new Set(data.items.map((i) => (i.startDate < data.today ? data.today : i.startDate).slice(0, 7)))]
  return months.map((m) => (
    <FCard key={m} title={`${t(`family.months.${Number(m.slice(5))}`)} ${m.slice(0, 4)}`}>
      <div className="divide-y divide-border">
        {data.items.filter((i) => (i.startDate < data.today ? data.today : i.startDate).slice(0, 7) === m).map((i) => (
          <div key={i.id} className="py-3">
            <div className="flex items-start gap-3">
              <DateTile day={i.startDate < data.today ? data.today : i.startDate} tone={tone(i)} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-snug text-ink break-words">{i.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {i.endDate !== i.startDate ? `${date(i.startDate)} – ${date(i.endDate)}` : date(i.startDate)}{i.startTime ? ` · ${i.startTime}–${i.endTime}` : ''}
                  {i.source !== 'EVENT' && ` · ${t(`family.calendar.sources.${i.source}`)}`}
                </p>
                {i.venue && <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-muted break-words"><MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{i.venue}</p>}
                {i.description && <p className="mt-1 text-xs text-ink-muted whitespace-pre-line line-clamp-3 break-words">{i.description}</p>}
              </div>
            </div>
            {i.reply && <Reply item={i} />}
          </div>
        ))}
      </div>
    </FCard>
  ))
}
