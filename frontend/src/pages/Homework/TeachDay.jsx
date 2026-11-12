import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, History, Paperclip, Presentation, RotateCcw } from 'lucide-react'
import { addDaysYmd } from '@schoolgiant/shared'
import { DateInput, EmptyState, Note, PageContainer, PageHeader, Select, SideNav, SideNavLayout, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchHomeworkLookup, fetchTeachDay } from '../../api/homework'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useWeekdayLabel } from '../../components/homework/HomeworkKit'
import { ProgressStrip, TopicActions, TopicMaterial, TopicStatusPill, TopicStudentContent, bookLine } from '../../components/homework/TopicKit'
import { HomeworkForm } from './Homework'

/** The homework a topic suggests: the suggestion, then its homework questions. */
function homeworkFrom(topic) {
  const qs = topic.questions.filter((q) => q.use === 'HOMEWORK')
  const lines = [topic.homeworkHint, ...qs.map((q, i) => `${i + 1}. ${q.question}${q.kind === 'MCQ' && q.options.length ? `\n${q.options.map((o, k) => `   ${String.fromCharCode(97 + k)}) ${o}`).join('\n')}` : ''}`)]
  return lines.filter(Boolean).join('\n')
}

/** One topic as a card: tap to open its material and the buttons. */
function TopicCard({ topic, subject, sectionId, date, tone, onHomework, onChanged }) {
  const { t } = useTranslation('homework')
  const { date: fmt } = useFormat()
  const [open, setOpen] = useState(false)
  const book = bookLine(topic.book)
  const late = topic.status !== 'TAUGHT' && topic.end && topic.end < date
  return (
    <div className={`rounded-xl border ${tone === 'danger' ? 'border-danger-200' : 'border-border'} bg-surface`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-start px-3 py-3 flex items-start gap-3 min-h-12">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{topic.name}</p>
          <p className="text-xs text-ink-muted mt-0.5">{[topic.unit, book].filter(Boolean).join(' · ')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {topic.status !== 'NOT_STARTED' && <TopicStatusPill status={topic.status} />}
            {late && <StatusPill tone="danger">{t('homework.teach.plannedWas', { date: fmt(topic.start) })}</StatusPill>}
            {topic.carried > 0 && <StatusPill tone="neutral" dot={false}>{t('homework.teach.carriedN', { count: topic.carried })}</StatusPill>}
            {topic.needsRevision && <StatusPill tone="warning">{t('homework.topic.needsRevision')}</StatusPill>}
            {topic.questions.length > 0 && <span className="text-xs text-ink-faint">{t('homework.teach.questionsN', { count: topic.questions.length })}</span>}
          </div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-ink-faint shrink-0 mt-0.5" /> : <ChevronDown className="w-5 h-5 text-ink-faint shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3 space-y-4">
          <TopicMaterial topic={topic} />
          <TopicStudentContent topicId={topic.id} />
          <TopicActions sectionId={sectionId} subjectId={subject.subjectId} row={topic} date={date} canMark={subject.canMark}
            onHomework={() => onHomework(subject, topic)} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

function Group({ icon: Icon, title, tone, items, ...rest }) {
  if (!items.length) return null
  return (
    <div className="space-y-2">
      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone === 'danger' ? 'text-danger-600' : 'text-ink-muted'}`}><Icon className="w-3.5 h-3.5" aria-hidden />{title} · {items.length}</p>
      {items.map((x) => <TopicCard key={x.id} topic={x} tone={tone} {...rest} />)}
    </div>
  )
}

/**
 * The teacher's day: pick a class and a date; for each subject they teach there, the topics planned
 * for the day, the ones carried over, extra classes and revisions — each opens to its material and
 * the buttons to mark it.
 */
export default function TeachDay() {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { showSuccess } = useSnackbar()
  const { date: fmt } = useFormat()
  const weekday = useWeekdayLabel()
  const [params, setParams] = useSearchParams()
  const sectionParam = params.get('section') || undefined
  const dateParam = params.get('date') || undefined
  const key = ['teach-day', sectionParam ?? '', dateParam ?? '']
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => fetchTeachDay({ sectionId: sectionParam, date: dateParam }), placeholderData: keepPreviousData })
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup })
  const [setting, setSetting] = useState(null)
  // large screens show one subject at a time beside the list: the one picked, else the first with something to do today
  const [picked, setPicked] = useState(null)
  const subjects = data?.subjects ?? []
  const shownSubject = subjects.some((x) => x.subjectId === picked) ? picked
    : (subjects.find((x) => x.today.length || x.overdue.length) ?? subjects[0])?.subjectId ?? null
  const go = (patch) => setParams((p) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v); else n.delete(k)
    return n
  }, { replace: true })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['teach-day'] }); qc.invalidateQueries({ queryKey: ['syllabus'] }); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }); qc.invalidateQueries({ queryKey: ['my-teaching'] }) }
  const onHomework = (subject, topic) => setSetting({ sectionIds: [data.sectionId], subjectId: subject.subjectId, title: topic.name, details: homeworkFrom(topic) })

  const day = data?.date
  const mine = data?.sections.filter((s) => s.mine) ?? []
  const others = data?.sections.filter((s) => !s.mine) ?? []
  return (
    <PageContainer>
      <PageHeader icon={Presentation} title={t('homework.teach.title')} subtitle={t('homework.teach.subtitle')} />
      {isLoading && <p className="text-sm text-ink-faint">{t('homework.loading')}</p>}
      {error && <EmptyState error={error} onRetry={refetch} />}
      {data && !data.year && <Note tone="warning">{t('homework.mine.noYear')}</Note>}
      {data?.year && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-center">
            <Select value={data.sectionId ?? ''} onChange={(e) => go({ section: e.target.value })} aria-label={t('homework.teach.pickClass')}>
              {mine.length > 0 && others.length > 0 ? <>
                <optgroup label={t('homework.teach.myClasses')}>{mine.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>
                <optgroup label={t('homework.teach.otherClasses')}>{others.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>
              </> : data.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" icon={ChevronLeft} className="min-h-10 sm:min-h-0" aria-label={t('homework.teach.prevDay')} title={t('homework.teach.prevDay')} onClick={() => go({ date: addDaysYmd(day, -1) })} />
              <DateInput className="w-40" value={day} onChange={(e) => go({ date: e.target.value })} aria-label={t('homework.teach.date')} />
              <Button size="sm" variant="secondary" icon={ChevronRight} className="min-h-10 sm:min-h-0" aria-label={t('homework.teach.nextDay')} title={t('homework.teach.nextDay')} onClick={() => go({ date: addDaysYmd(day, 1) })} />
              {day !== data.today && <Button size="sm" variant="ghost" onClick={() => go({ date: null })}>{t('homework.mine.today')}</Button>}
            </div>
          </div>
          <p className="text-sm text-ink-muted">{day === data.today ? t('homework.mine.today') : weekday(day)} · {fmt(day)}{data.section ? ` · ${data.section.label}` : ''}</p>

          {!data.sections.length && <Note>{t('homework.noSections')}</Note>}
          {data.sectionId && !data.subjects.length && <Note>{t('homework.teach.noSubjects')}</Note>}

          {data.subjects.length > 0 && (
          <SideNavLayout nav={
            // large screens: the subjects of the day as a side list (one shown at a time); phones keep every subject stacked
            <div className="hidden lg:block">
              <SideNav title={t('homework.teach.subjectsToday')} value={shownSubject} onChange={setPicked} items={data.subjects.map((s) => ({
                id: s.subjectId, label: s.subject, icon: BookOpen,
                hint: s.periods.length ? t('homework.teach.periods', { list: s.periods.join(', '), count: s.periods.length }) : t('homework.teach.noPeriod'),
                count: s.today.length + s.overdue.length + s.extra.length + s.revision.length || undefined,
                countTone: s.overdue.length ? 'danger' : undefined,
              }))} />
            </div>
          }>
          <div className="space-y-4 min-w-0">
          {data.subjects.map((s) => {
            const nothing = !s.today.length && !s.overdue.length && !s.extra.length && !s.revision.length
            const rest = { subject: s, sectionId: data.sectionId, date: day, onHomework, onChanged: refresh }
            return (
              <section key={s.subjectId} className={`rounded-xl border border-border bg-surface p-3 space-y-3 ${s.subjectId === shownSubject ? '' : 'lg:hidden'}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <BookOpen className="w-4 h-4 text-ink-muted" aria-hidden />
                  <h2 className="text-base font-semibold text-ink">{s.subject}</h2>
                  {s.periods.length > 0 && <span className="text-xs text-ink-muted">{t('homework.teach.periods', { list: s.periods.join(', '), count: s.periods.length })}</span>}
                </div>
                <ProgressStrip p={s.progress} />
                {!s.hasSyllabus && <p className="text-sm text-ink-faint">{t('homework.syllabus.notSet')}</p>}
                <Group icon={CalendarClock} title={t('homework.teach.today')} items={s.today} {...rest} />
                <Group icon={CircleAlert} tone="danger" title={t('homework.teach.overdue')} items={s.overdue} {...rest} />
                <Group icon={Paperclip} title={t('homework.teach.extra')} items={s.extra} {...rest} />
                <Group icon={RotateCcw} title={t('homework.teach.revision')} items={s.revision} {...rest} />
                {s.hasSyllabus && nothing && (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-faint">{t('homework.teach.nothing')}</p>
                    {s.next && <Group icon={History} title={t('homework.teach.next', { date: fmt(s.next.start) })} items={[s.next]} {...rest} />}
                  </div>
                )}
              </section>
            )
          })}
          </div>
          </SideNavLayout>
          )}
        </div>
      )}
      {setting && lookup && <HomeworkForm lookup={lookup} defaults={setting} onClose={() => setSetting(null)} onSaved={(r) => {
        setSetting(null); qc.invalidateQueries({ queryKey: ['homework-list'] }); qc.invalidateQueries({ queryKey: ['my-teaching'] })
        showSuccess(r.notified ? t('homework.form.setNotified', { count: r.created, families: r.notified }) : t('homework.form.setDone', { count: r.created }))
      }} />}
    </PageContainer>
  )
}
