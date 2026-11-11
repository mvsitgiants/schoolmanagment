import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, MapPin, NotebookPen, UsersRound, X } from 'lucide-react'
import { Calendar } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCalendar, familyEventReply } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { EventPassButton } from '../../components/family/Passes'

// calm: school events in the teal accent; amber only where the family has to do something (a reply, a last date)
const toneOf = (i) => (i.reply && !i.reply.answer ? 'warning' : i.source === 'EVENT' && i.kind === 'DEADLINE' ? 'warning' : i.source === 'EVENT' ? 'accent' : 'neutral')
const ICON = { EXAM: NotebookPen, PTM: UsersRound }
const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }

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

/** One thing on the calendar, in full: when, where, what — and the reply buttons where the school asked. */
function ItemCard({ item: i }) {
  const { t } = useTranslation('family')
  const { date } = useFormat()
  return (
    <div className="rounded-lg px-2 py-2.5">
      <p className="text-[15px] font-medium leading-snug text-ink break-words">{i.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {i.endDate !== i.startDate ? `${date(i.startDate)} – ${date(i.endDate)}` : date(i.startDate)}{i.startTime ? ` · ${i.startTime}–${i.endTime}` : ''}
        {i.source !== 'EVENT' && ` · ${t(`family.calendar.sources.${i.source}`)}`}
      </p>
      {i.venue && <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-muted break-words"><MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{i.venue}</p>}
      {i.description && <p className="mt-1 text-xs text-ink-muted whitespace-pre-line line-clamp-3 break-words">{i.description}</p>}
      {i.reply && <Reply item={i} />}
    </div>
  )
}

/** The family app › Calendar: the next three months — events, holidays, exams, meetings; replies where asked. */
export default function FamilyCalendar() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { data, isLoading, error } = useFamilyQuery(['calendar'], () => familyCalendar(slug, studentId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.items.length) return <FCard><FEmpty icon={CalendarDays} title={t('family.calendar.empty')} /></FCard>
  const holidays = data.items.filter((i) => i.source === 'HOLIDAY').map((i) => ({ date: i.startDate, endDate: i.endDate, name: i.title }))
  const items = data.items.filter((i) => i.source !== 'HOLIDAY').map((i) => ({
    id: `${i.source}:${i.id}`, date: i.startDate, endDate: i.endDate, title: i.title, time: i.startTime || undefined, endTime: i.endTime || undefined,
    kind: i.source !== 'EVENT' ? t(`family.calendar.sources.${i.source}`) : undefined, icon: ICON[i.source], tone: toneOf(i), sub: i.venue || undefined, raw: i,
  }))
  const thisMonth = data.today.slice(0, 7)
  const lastMonth = data.items.reduce((m, i) => (i.startDate.slice(0, 7) > m ? i.startDate.slice(0, 7) : m), shiftYm(thisMonth, 2))
  return (
    <FCard>
      <Calendar views={['month', 'agenda']} items={items} holidays={holidays} minMonth={thisMonth} maxMonth={lastMonth} panelBelow
        renderItem={(it) => <ItemCard item={it.raw} />} emptyText={t('family.calendar.emptyMonth')}
        legend={[{ tone: 'accent', label: t('family.calendar.legendEvents') }, { tone: 'warning', label: t('family.calendar.legendAction') }, { tone: 'neutral', label: t('family.calendar.legendOther') }]} />
    </FCard>
  )
}
