import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Video, X } from 'lucide-react'
import { StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyBookMeeting, familyCancelMeeting, familyMeetings } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

/** The family app › Meetings: parent–teacher meetings — book a time with each teacher, see or cancel the booking. */
export default function FamilyMeetings() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const key = ['family', slug, studentId, 'meetings']
  const { data, isLoading, error } = useFamilyQuery(['meetings'], () => familyMeetings(slug, studentId))
  const book = useMutation({ mutationFn: ({ sessionId, hostId, time }) => familyBookMeeting(slug, studentId, sessionId, { hostId, time }), onSuccess: (d) => qc.setQueryData(key, d) })
  const cancel = useMutation({ mutationFn: (bookingId) => familyCancelMeeting(slug, studentId, bookingId), onSuccess: (d) => qc.setQueryData(key, d) })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!data.length) return <FCard><FEmpty icon={CalendarClock} title={t('family.meetings.none')} hint={t('family.meetings.noneHint')} /></FCard>
  const busy = book.isPending || cancel.isPending
  return (
    <>
      {(book.error || cancel.error) && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{(book.error ?? cancel.error).message}</p>}
      {data.map((m) => (
        <FCard key={m.id}>
          <p className="text-[15px] font-semibold text-ink">{m.title}</p>
          <p className="text-xs text-ink-muted">{date(m.date)} · {m.startTime}–{m.endTime}{m.mode === 'ONLINE' ? ` · ${t('family.meetings.online')}` : ''}</p>
          {m.instructions && <p className="mt-1 text-xs text-ink-muted whitespace-pre-line">{m.instructions}</p>}
          {m.canBook ? <p className="mt-1 text-xs text-brand-700">{t('family.meetings.bookBy', { date: date(m.bookBy) })}</p> : m.status !== 'DONE' && <p className="mt-1 text-xs text-ink-faint">{t('family.meetings.closed')}</p>}
          <div className="mt-3 space-y-3">
            {m.teachers.map((h) => (
              <div key={h.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium text-ink">{h.name}</p>
                {h.role && <p className="text-xs text-ink-muted">{h.role}</p>}
                {h.booking ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-ink">{t('family.meetings.yourTime', { time: h.booking.time })}</p>
                      {h.room && (m.mode === 'ONLINE'
                        ? <a href={h.room} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><Video className="w-4 h-4" />{t('family.meetings.join')}</a>
                        : <p className="text-xs text-ink-muted">{h.room}</p>)}
                    </div>
                    {h.booking.status === 'BOOKED' && m.canBook
                      ? <button type="button" disabled={busy} onClick={() => cancel.mutate(h.booking.id)} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-danger-600"><X className="w-4 h-4" />{t('family.meetings.cancel')}</button>
                      : <StatusPill tone={h.booking.status === 'ATTENDED' ? 'success' : 'info'}>{t(`family.meetings.status.${h.booking.status}`)}</StatusPill>}
                  </div>
                ) : h.free.length ? (
                  <>
                    <p className="mt-2 text-xs text-ink-muted">{t('family.meetings.pickTime')}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {h.free.map((time) => (
                        <button key={time} type="button" disabled={busy} onClick={() => book.mutate({ sessionId: m.id, hostId: h.id, time })}
                          className="min-h-[44px] min-w-[64px] rounded-lg border border-border px-3 text-sm text-ink hover:border-brand-400 disabled:opacity-50">{time}</button>
                      ))}
                    </div>
                  </>
                ) : <p className="mt-2 text-xs text-ink-faint">{m.canBook ? t('family.meetings.full') : t('family.meetings.notBooked')}</p>}
              </div>
            ))}
          </div>
        </FCard>
      ))}
    </>
  )
}
