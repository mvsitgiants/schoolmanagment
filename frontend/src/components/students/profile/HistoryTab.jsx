import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, ArrowUpCircle, FileText, GraduationCap, History, LogOut, MessagesSquare, RotateCcw, UserPlus } from 'lucide-react'
import { HISTORY_EVENTS } from '@schoolgiant/shared'
import { SectionCard, SegmentedControl, StatusPill, Timeline } from '../../system'
import { useFormat } from '../../../context/SettingsContext'
import { CHANNEL_ICON } from './OverviewTab'
import { Quiet, broken, list, useLabels } from './kit'

const EVENT_LOOK = {
  ADMITTED: { icon: UserPlus, tone: 'success' }, MOVED: { icon: ArrowRightLeft, tone: 'info' }, PROMOTE: { icon: ArrowUpCircle, tone: 'brand' },
  DETAIN: { icon: RotateCcw, tone: 'warning' }, PASS_OUT: { icon: GraduationCap, tone: 'violet' }, LEAVE: { icon: LogOut, tone: 'neutral' },
  TC_ISSUED: { icon: FileText, tone: 'danger' }, READMITTED: { icon: RotateCcw, tone: 'success' },
}

/** Student 360 › History: the record's own events (admitted, moved, promoted, TC …) and the messages sent to the family, newest first. */
export default function HistoryTab({ s, o }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { dateTime } = useFormat()
  const [show, setShow] = useState('ALL')
  const messages = o?.messages && !broken(o.messages) ? list(o.messages) : []
  const events = [
    ...list(s.history).map((h, i) => {
      const look = EVENT_LOOK[h.event] ?? { icon: History, tone: 'neutral' }
      return {
        kind: 'RECORD', at: h.at, id: `h-${i}`, icon: look.icon, tone: look.tone,
        title: t(`students.history.${h.event}`, HISTORY_EVENTS[h.event] ?? h.event), time: dateTime(h.at),
        meta: [h.classLabel, h.yearName, h.by].filter(Boolean).join(' · '), body: h.note,
      }
    }),
    ...messages.map((m) => ({
      kind: 'MESSAGE', at: m.at, id: `m-${m.id}`, icon: CHANNEL_ICON[m.channel] ?? MessagesSquare, tone: 'sky',
      title: L.msgEvent(m.event), time: dateTime(m.at), meta: [L.channel(m.channel), m.to].filter(Boolean).join(' · '),
      status: <StatusPill tone={L.msgTone(m.status)}>{L.msgStatus(m.status)}</StatusPill>,
    })),
  ].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
  const shown = show === 'ALL' ? events : events.filter((e) => e.kind === show)
  return (
    <SectionCard icon={History} title={t('students.profile.tabs.history')} count={shown.length || null}
      actions={messages.length > 0 && (
        <SegmentedControl size="sm" value={show} onChange={setShow} options={[
          { value: 'ALL', label: t('students.profile.history.all') },
          { value: 'RECORD', label: t('students.profile.history.record') },
          { value: 'MESSAGE', label: t('students.profile.history.messages') },
        ]} />
      )}>
      {shown.length === 0 ? <Quiet icon={History} title={t('students.profile.history.none')} /> : <Timeline items={shown} />}
      {messages.length >= 10 && show !== 'RECORD' && <p className="mt-3 text-xs text-ink-faint">{t('students.profile.history.lastMessages', { count: messages.length })}</p>}
    </SectionCard>
  )
}
