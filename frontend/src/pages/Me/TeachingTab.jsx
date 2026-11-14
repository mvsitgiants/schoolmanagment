import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpenCheck, CalendarClock, CalendarDays, Check, ChevronRight, CircleAlert, ClipboardList, LayoutPanelTop, ListChecks, NotebookPen, Plus, Presentation, SkipForward } from 'lucide-react'
import { LESSON_STATUS, addDaysYmd } from '@schoolgiant/shared'
import { ColorChip, EmptyState, ListRow, ListRows, Note, ProgressBar, SectionCard, StatusPill } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchHomeworkLookup, fetchMyTeaching, setLessonPlanStatus } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useWeekdayLabel } from '../../components/homework/HomeworkKit'
import { PlanForm } from '../Homework/LessonPlans'
import LessonView from '../../components/homework/LessonView'
import { useMarkLessonDone } from '../../components/homework/TopicKit'
import { HomeworkDrawer, HomeworkForm } from '../Homework/Homework'
import { QuietEmpty, Tile } from './shared'

export const MY_TEACHING = ['my-teaching']

/** Lesson plans of the week, one block per day; today's open. */
function WeekPlans({ data, onPlan, onAct, onOpen, openId, renderLesson }) {
  const { t } = useTranslation('homework')
  const weekday = useWeekdayLabel()
  const { date } = useFormat()
  const canEdit = hasPermission('homework.lesson-plans.edit')
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(data.week.from, i))
  const shown = days.filter((d) => d === data.today || data.plans.some((p) => p.date === d))
  const statusLabel = (s) => t(`homework.lessons.status.${s}`, LESSON_STATUS[s]?.label ?? s)
  const [askDone, doneDialog] = useMarkLessonDone()
  const markDone = async (p) => {
    const a = await askDone(p)
    if (a) onAct(() => setLessonPlanStatus(p.id, { status: 'DONE', partly: a.partly, reflection: a.reflection || undefined }), t(a.partly ? 'homework.lessons.markedPartly' : 'homework.lessons.markedDone'))
  }
  return (
    <div className="space-y-4">
      {doneDialog}
      {shown.map((d) => {
        const plans = data.plans.filter((p) => p.date === d)
        return (
          <div key={d}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${d === data.today ? 'text-brand-600' : 'text-ink-muted'}`}>
              {d === data.today ? t('homework.mine.today') : weekday(d)} · {date(d)}
            </p>
            {plans.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {plans.map((p) => (
                  <li key={p.id}>
                    <div className="flex items-center gap-1 pe-1.5">
                    {/* a lesson: period, its name with the class and subject under it, status — the row opens it */}
                    <button type="button" onClick={() => onOpen(p)} aria-expanded={openId === p.id} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-2.5 py-1.5 text-start hover:bg-black/[0.02] [@media(pointer:coarse)]:min-h-[52px]">
                      <span className="w-16 shrink-0 whitespace-nowrap text-xs text-ink-muted">{p.period ? t('homework.lessons.periodN', { n: p.period }) : '—'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                        <span className="block truncate text-xs text-ink-muted">{[p.section, p.subject].filter(Boolean).join(' · ')}</span>
                      </span>
                      <StatusPill tone={p.partly && p.status === 'DONE' ? 'warning' : LESSON_STATUS[p.status]?.tone}>{p.partly && p.status === 'DONE' ? t('homework.lessons.status.PARTLY') : statusLabel(p.status)}</StatusPill>
                    </button>
                    {p.status === 'PLANNED' && p.canChange && canEdit && <>
                      <Button size="sm" variant="ghost" icon={Check} title={t('homework.lessons.markDone')} aria-label={t('homework.lessons.markDone')} onClick={() => markDone(p)} />
                      <Button size="sm" variant="ghost" icon={SkipForward} title={t('homework.lessons.skip')} aria-label={t('homework.lessons.skip')} onClick={() => onAct(() => setLessonPlanStatus(p.id, { status: 'SKIPPED' }), t('homework.lessons.skipped'))} />
                    </>}
                    </div>
                    {/* opened in place, under its row */}
                    {openId === p.id && <div className="border-t border-border bg-bg/40 px-3 py-3">{renderLesson(p)}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
                <p className="text-sm text-ink-faint flex-1">{t('homework.mine.nothingToday')}</p>
                {hasPermission('homework.lesson-plans.create') && <Button size="sm" variant="ghost" icon={Plus} onClick={() => onPlan({ date: d })}>{t('homework.mine.planLesson')}</Button>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * My workspace › My teaching. One screen for a teacher's day: the week's lesson plans (mark them
 * taught), homework waiting to be checked, and every class × subject they teach against the year
 * plan — what is planned this month and what is behind.
 */
/** `action`: 'plan' | 'homework' opens that form straight away (Overview's quick buttons); `onActionDone` after. */
export default function TeachingTab({ action, onActionDone }) {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: MY_TEACHING, queryFn: fetchMyTeaching })
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup })
  const [planning, setPlanning] = useState(null) // { date, sectionId, subjectId, topicIds }
  const [viewing, setViewing] = useState(null) // a lesson opened read-only
  const [editingPlan, setEditingPlan] = useState(null)
  const [setting, setSetting] = useState(null) // { sectionIds, subjectId }
  const [openId, setOpenId] = useState(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: MY_TEACHING }); qc.invalidateQueries({ queryKey: ['lesson-plans'] }); qc.invalidateQueries({ queryKey: ['syllabus'] }); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const onAct = (fn, done) => act.mutate({ fn, done })
  useEffect(() => {
    if (!action || !data?.year || !lookup) return
    if (action === 'plan') setPlanning({ date: data.today })
    if (action === 'homework') setSetting({})
    onActionDone?.()
  }, [action, data, lookup, onActionDone])

  if (isLoading) return <p className="text-sm text-ink-faint">{t('homework.loading')}</p>
  if (error) return <EmptyState error={error} onRetry={refetch} />
  if (!data.year) return <Note tone="warning">{t('homework.mine.noYear')}</Note>

  const todays = data.plans.filter((p) => p.date === data.today)
  const weekDone = data.plans.filter((p) => p.status === 'DONE').length
  const behind = data.classes.reduce((n, c) => n + c.behind, 0)
  const canPlan = hasPermission('homework.lesson-plans.create')
  const canSet = hasPermission('homework.homework.create')
  const syllabusLink = (c) => `/homework/syllabus?class=${c.classId}&subject=${c.subjectId}&section=${c.sectionId}`

  return (
    <div className="flex flex-col gap-6">
      {/* the day screen (what to teach in each class today) and the Subject hub (build each topic's lesson) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/homework/teach" className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-3 min-h-14 hover:bg-brand-50">
          <Presentation className="w-5 h-5 text-brand-600 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{t('homework.mine.teachToday')}</span>
            <span className="block text-xs text-ink-muted">{t('homework.mine.teachTodayHint')}</span>
          </span>
          <ChevronRight className="w-5 h-5 text-ink-faint shrink-0 rtl:rotate-180" aria-hidden />
        </Link>
        {hasPermission('homework.hub.view') && (
          <Link to="/teaching/hub" className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-3 min-h-14 hover:bg-brand-50">
            <LayoutPanelTop className="w-5 h-5 text-brand-600 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{t('homework.mine.hub')}</span>
              <span className="block text-xs text-ink-muted">{t('homework.mine.hubHint')}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-ink-faint shrink-0 rtl:rotate-180" aria-hidden />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile icon={CalendarClock} label={t('homework.mine.stats.today')} value={todays.length} sub={t('homework.mine.stats.todaySub', { done: todays.filter((p) => p.status === 'DONE').length })} />
        <Tile icon={ClipboardList} label={t('homework.mine.stats.week')} value={data.plans.length} sub={t('homework.mine.stats.weekSub', { done: weekDone })} />
        <Tile icon={BookOpenCheck} tone={data.toCheck.length ? 'warning' : undefined} label={t('homework.mine.stats.toCheck')} value={data.toCheck.length} sub={t('homework.mine.stats.openSub', { count: data.openHomework })} />
        <Tile icon={CircleAlert} tone={behind ? 'danger' : undefined} label={t('homework.mine.stats.behind')} value={behind} sub={t('homework.mine.stats.behindSub', { count: data.classes.length })} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr] items-start">
        <SectionCard icon={CalendarDays} title={t('homework.mine.week')} hint={`${date(data.week.from)} – ${date(data.week.to)}`}
          actions={<>
            {canPlan && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setPlanning({ date: data.today })}>{t('homework.mine.planLesson')}</Button>}
            <Link to="/homework/lesson-plans" className="text-xs font-medium text-brand-600 hover:underline px-1">{t('homework.mine.allPlans')}</Link>
          </>}>
          <WeekPlans data={data} onPlan={setPlanning} onAct={onAct} onOpen={(p) => setViewing((v) => (v?.id === p.id ? null : p))} openId={viewing?.id}
            renderLesson={(p) => <LessonView plan={p} onClose={() => setViewing(null)} onDeleted={() => { setViewing(null); refresh() }}
              onEdit={p.canChange && hasPermission('homework.lesson-plans.edit') ? () => { setEditingPlan(p); setViewing(null) } : undefined} />} />
        </SectionCard>

        <SectionCard icon={BookOpenCheck} title={t('homework.mine.toCheck')} count={data.toCheck.length || null} hint={t('homework.mine.toCheckHint')} flush
          actions={canSet && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setSetting({})}>{t('homework.new')}</Button>}>
          {data.toCheck.length ? (
            <ListRows className="p-1.5">
              {data.toCheck.map((h) => (
                <ListRow key={h.id} title={h.title} onClick={() => setOpenId(h.id)}
                  subtitle={t('homework.mine.dueOn', { date: date(h.dueDate) })}
                  meta={<><ColorChip label={h.section} seed={h.classId ?? h.section} /><ColorChip label={h.subject} seed={h.subjectId} dot /></>}
                  trailing={<span className="text-amber-600">{t('homework.mine.notRecorded', { count: h.counts.PENDING })}</span>} />
              ))}
            </ListRows>
          ) : <QuietEmpty icon={BookOpenCheck} title={t('homework.mine.allChecked')} />}
        </SectionCard>
      </div>

      <SectionCard icon={ListChecks} title={t('homework.mine.classes')} count={data.classes.length || null} hint={t('homework.mine.classesHint')}>
        {data.classes.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {data.classes.map((c) => (
              <div key={c.key} className={`rounded-xl border p-3 ${c.behind ? 'border-danger-200 bg-danger-50/30' : 'border-border'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ColorChip label={c.section} seed={c.classId} /><ColorChip label={c.subject} seed={c.subjectId} dot />
                  {c.classTeacher && <StatusPill tone="neutral">{t('homework.mine.classTeacher')}</StatusPill>}
                  {c.behind > 0 && <StatusPill tone="danger">{t('homework.syllabus.plan.behindN', { count: c.behind })}</StatusPill>}
                  {c.revision > 0 && <StatusPill tone="warning">{t('homework.mine.revisionN', { count: c.revision })}</StatusPill>}
                </div>
                {c.topics ? (
                  <>
                    <div className="mt-2.5 flex items-center gap-2"><div className="flex-1"><ProgressBar value={c.pct} showValue={false} /></div><span className="text-xs text-ink-muted tabular-nums">{c.done}/{c.topics} · {c.pct}%</span></div>
                    {c.behindTopics.length > 0 && <p className="mt-2 text-xs text-danger-700"><span className="font-semibold">{t('homework.mine.behindLabel')}</span> {c.behindTopics.map((x) => x.name).join(' · ')}{c.behind > c.behindTopics.length ? ' …' : ''}</p>}
                    {c.dueTopics.length > 0 && <p className="mt-1 text-xs text-ink-muted"><span className="font-semibold">{t('homework.mine.thisMonth')}</span> {c.dueTopics.map((x) => x.name).join(' · ')}{c.due > c.dueTopics.length ? ' …' : ''}</p>}
                    {!c.planned && <p className="mt-2 text-xs text-ink-faint">{t('homework.syllabus.plan.notPlanned')}</p>}
                  </>
                ) : <p className="mt-2 text-xs text-ink-faint">{t('homework.syllabus.notSet')}</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {canPlan && <Button size="sm" variant="ghost" icon={NotebookPen}
                    onClick={() => setPlanning({ date: data.today, sectionId: c.sectionId, subjectId: c.subjectId, topicIds: [...c.behindTopics, ...c.dueTopics].slice(0, 3).map((x) => x.id) })}>{t('homework.mine.planLesson')}</Button>}
                  {canSet && <Button size="sm" variant="ghost" icon={BookOpenCheck} onClick={() => setSetting({ sectionIds: [c.sectionId], subjectId: c.subjectId })}>{t('homework.new')}</Button>}
                  <Link to={`/homework/teach?section=${c.sectionId}`} className="inline-flex items-center px-2 text-xs font-medium text-brand-600 hover:underline">{t('homework.mine.openDay')}</Link>
                  {hasPermission('homework.syllabus.view') && <Link to={syllabusLink(c)} className="inline-flex items-center px-2 text-xs font-medium text-brand-600 hover:underline">{t('homework.mine.openSyllabus')}</Link>}
                </div>
              </div>
            ))}
          </div>
        ) : <QuietEmpty icon={ListChecks} title={t('homework.mine.noClassesTitle')} hint={t('homework.mine.noClasses')} />}
      </SectionCard>

      {editingPlan && lookup && <PlanForm lookup={lookup} plan={editingPlan} defaultDate={editingPlan.date}
        onClose={() => setEditingPlan(null)} onSaved={() => { setEditingPlan(null); refresh(); showSuccess(t('homework.lessons.saved')) }} />}
      {planning && lookup && <PlanForm lookup={lookup} plan={null} defaultDate={planning.date} defaults={planning}
        onClose={() => setPlanning(null)} onSaved={() => { setPlanning(null); refresh(); showSuccess(t('homework.lessons.saved')) }} />}
      {setting && lookup && <HomeworkForm lookup={lookup} defaults={setting} onClose={() => setSetting(null)} onSaved={(r) => {
        setSetting(null); refresh(); qc.invalidateQueries({ queryKey: ['homework-list'] })
        showSuccess(r.notified ? t('homework.form.setNotified', { count: r.created, families: r.notified }) : t('homework.form.setDone', { count: r.created }))
      }} />}
      {openId && <HomeworkDrawer id={openId} lookup={lookup} onClose={() => { setOpenId(null); refresh() }} />}
    </div>
  )
}
