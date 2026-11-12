import { Suspense, lazy, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookMarked, CalendarPlus, ChevronDown, Eye, HelpCircle, Paperclip, Pencil, School } from 'lucide-react'
import clsx from 'clsx'
import { LESSON_STATUS } from '@schoolgiant/shared'
import { Drawer, Note, StatusPill } from '../system'
import Button from '../ui/Button'
import { RichTextView } from '../lms/RichText'
import { OpenInHub, TopicActions, TopicMaterial, TopicQuestions, TopicStatusPill } from './TopicKit'
import { PlanForm } from '../../pages/Homework/LessonPlans'
import { fetchHomeworkLookup, fetchLessonPlans, fetchSyllabusTopic } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { apiUrl } from '../../api/client'
import { useFormat } from '../../context/SettingsContext'

// the lesson view shows this panel for its topics, so it is loaded only when a lesson is opened here (in place, no drawer)
const LessonView = lazy(() => import('./LessonView'))

// A syllabus topic, the same on every screen (Teaching hub, My teaching day, the syllabus tracker, a lesson plan):
//   In class            each class: who teaches it, taught or not, icon buttons to mark it, its lessons   (open)
//   What students see   the topic's student content and sub-topics                                         (closed)
//   For the teacher     how to teach it, key points, book, homework idea, the teacher's files            (closed)
//   Questions                                                                                             (closed)
// Content is written in one place only — the Teaching hub; elsewhere the panel ends with "Edit in Teaching hub".

/** The panel's sections: a plain heading line (no box) with a short note of what is inside; opens and closes. */
function Fold({ icon: Icon, title, note, defaultOpen = false, onOpen, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={() => { setOpen((x) => !x); if (!open) onOpen?.() }}
        className="flex min-h-[40px] w-full items-center gap-2.5 rounded-md px-1 text-start hover:bg-black/[0.02] [@media(pointer:coarse)]:min-h-[44px]">
        <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        <span className="text-sm font-semibold text-ink">{title}</span>
        {note && <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{note}</span>}
        <ChevronDown className={clsx('ms-auto h-4 w-4 shrink-0 text-ink-faint transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="pb-3 ps-[1.875rem] pe-1">{children}</div>}
    </section>
  )
}

function Files({ files }) {
  if (!files?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((f) => (
        <li key={f.id} className="max-w-full">
          <a href={apiUrl(`/v1/files/${f.id}/content`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-ink hover:bg-black/[0.03]">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /><span className="min-w-0 truncate">{f.name}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** One class on one line: who teaches it and how the topic stands there; the icon buttons; its lessons below. */
function ClassRow({ topicId, topicName, cls, today, subjectId, canMark, plans, onPlan, onOpenPlan, openPlanId, renderLesson, onHomework, onChanged }) {
  const { t } = useTranslation('hub')
  const th = useTranslation('homework').t
  const { date } = useFormat()
  const row = { id: topicId, status: 'NOT_STARTED', ...cls.row }
  const teachers = cls.teachers && ((cls.teachers.map((x) => x.name).filter(Boolean).join(', ')) || t('hub.view.noTeacher'))
  const when = cls.tickDate ? date(cls.tickDate) : row.start && t('hub.view.planned', { date: date(row.start) })
  return (
    <li className="space-y-1.5 py-2 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{cls.label}</span>
          {(teachers || when) && <span className="block truncate text-xs text-ink-muted">{[teachers, when].filter(Boolean).join(' · ')}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {row.needsRevision && <StatusPill tone="warning">{th('homework.topic.needsRevision')}</StatusPill>}
          <TopicStatusPill status={row.status} />
        </span>
        <TopicActions sectionId={cls.id} subjectId={subjectId} row={row} topicName={topicName} date={today} canMark={canMark} onChanged={onChanged} onHomework={onHomework} showDate compact
          after={onPlan && hasPermission('homework.lesson-plans.create') && (
            <button type="button" title={t('hub.view.planLesson')} aria-label={t('hub.view.planLesson')} onClick={() => onPlan(cls)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-black/[0.04] hover:text-brand-700 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10">
              <CalendarPlus className="h-4 w-4" aria-hidden />
            </button>
          )} />
      </div>
      {plans.length > 0 && (
        <ul className="divide-y divide-border/70 rounded-lg bg-bg/60" aria-label={t('hub.view.lessonPlans')}>
          {plans.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpenPlan(p)} aria-expanded={openPlanId === p.id} className="flex min-h-[34px] w-full items-center gap-3 px-2.5 text-start hover:bg-black/[0.02] [@media(pointer:coarse)]:min-h-[44px]">
                <span className="shrink-0 whitespace-nowrap text-xs text-ink-muted sm:w-40">{date(p.date)}{p.period ? ` · ${th('homework.lessons.periodN', { n: p.period })}` : ''}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.title}</span>
                <StatusPill tone={LESSON_STATUS[p.status]?.tone}>{th(`homework.lessons.status.${p.status}`, LESSON_STATUS[p.status]?.label ?? p.status)}</StatusPill>
              </button>
              {openPlanId === p.id && <div className="border-t border-border bg-bg/40 px-3 py-3">{renderLesson(p)}</div>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** A loaded topic's student content (api fetchSyllabusTopic → studentContent) as the panel's parts. */
export const partsOf = (topic) => (topic?.studentContent ?? []).map((x) => ({ id: x.id, name: x.subTopicId ? x.title : null, html: x.html, files: x.files ?? [] }))

/**
 * topic      the topic's material: id, book, howTo, keyPoints, homeworkHint, questions (and teacherFiles)
 * parts      what students see: [{ id, name (a sub-topic's; null for the topic), html, files }] — loaded when left out
 * classes    [{ id (section), label, teachers?, row (its record of the topic), tickDate? }] — the "In class" rows
 * lessons    list and plan lessons for the topic in each class
 * link       { classId, subjectId, unitId?, id } → "Edit in Teaching hub" (left out inside the hub)
 * onEdit     the hub's "Write it" when nothing is written for students yet
 */
export default function TopicPanel({ topic, parts: given, classes = [], subjectId, today, canMark, onHomework, onChanged, lessons = true, link, canEdit, onEdit }) {
  const { t } = useTranslation('hub')
  const [planning, setPlanning] = useState(null) // { defaults } | { plan }
  const [viewing, setViewing] = useState(null)
  const [wantParts, setWantParts] = useState(false)
  const showLessons = lessons && classes.length > 0 && hasPermission('homework.lesson-plans.view')
  const { data: planPage, refetch } = useQuery({ queryKey: ['lesson-plans', 'topic', topic.id], queryFn: () => fetchLessonPlans({ subjectId, topicId: topic.id, pageSize: 100 }), enabled: showLessons })
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup, staleTime: 60_000, enabled: !!planning })
  const { data: loaded } = useQuery({ queryKey: ['syllabus-topic', topic.id], queryFn: () => fetchSyllabusTopic(topic.id), staleTime: 60_000, enabled: !given && wantParts })
  const parts = given ?? (loaded ? partsOf(loaded) : null)
  const written = (parts ?? []).filter((p) => p.html || p.files?.length)
  const plans = planPage?.rows ?? []
  const notes = [topic.howTo && t('hub.panel.howTo'), topic.keyPoints?.length && t('hub.panel.keyPoints'), (topic.book?.name || topic.book?.pages) && t('hub.panel.book'), topic.homeworkHint && t('hub.panel.homework')].filter(Boolean)
  const changed = () => { if (showLessons) refetch(); onChanged?.() }

  return (
    <div className="divide-y divide-border/70">
      {classes.length > 0 && (
        <Fold icon={School} title={t('hub.view.inClass')} note={t('hub.view.inClassNote')} defaultOpen>
          <ul className="divide-y divide-border/70">
            {classes.map((c) => (
              <ClassRow key={c.id} topicId={topic.id} topicName={topic.name} cls={c} today={today} subjectId={subjectId} canMark={canMark}
                plans={plans.filter((p) => p.sectionId === c.id)} onChanged={changed}
                onHomework={onHomework} onPlan={showLessons ? (x) => setPlanning({ defaults: { sectionId: x.id, subjectId, topicIds: [topic.id] } }) : undefined}
                onOpenPlan={(p) => setViewing((v) => (v?.id === p.id ? null : p))} openPlanId={viewing?.id}
                renderLesson={(p) => (
                  <Suspense fallback={null}>
                    <LessonView plan={p} onClose={() => setViewing(null)} onDeleted={() => { setViewing(null); changed() }}
                      onEdit={p.canChange && hasPermission('homework.lesson-plans.edit') ? () => { setPlanning({ plan: p }); setViewing(null) } : undefined} />
                  </Suspense>
                )} />
            ))}
          </ul>
        </Fold>
      )}

      <Fold icon={Eye} title={t('hub.view.studentsSee')} note={parts ? (written.length ? t('hub.view.parts', { count: written.length }) : t('hub.view.nothingYet')) : null} onOpen={() => setWantParts(true)}>
        {!parts ? <p className="text-sm text-ink-faint">{t('hub.panel.loading')}</p> : written.length ? (
          <div className="space-y-4">
            {written.map((p) => (
              <div key={p.id} className="min-w-0 space-y-2">
                {p.name && <p className="text-sm font-semibold text-ink">{p.name}</p>}
                {p.html && <RichTextView html={p.html} />}
                <Files files={p.files} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{t('hub.view.nothingYet')}</p>
            {canEdit && onEdit && <Button size="sm" icon={Pencil} onClick={onEdit}>{t('hub.view.write')}</Button>}
          </div>
        )}
      </Fold>

      {(notes.length > 0 || topic.teacherFiles?.length > 0) && (
        <Fold icon={BookMarked} title={t('hub.teacher.title')} note={notes.join(' · ')}>
          <TopicMaterial topic={topic} questions={false} />
        </Fold>
      )}
      {topic.questions?.length > 0 && (
        <Fold icon={HelpCircle} title={t('hub.questions.title')} note={t('hub.questions.count', { count: topic.questions.length })}>
          <TopicQuestions topic={topic} />
        </Fold>
      )}

      {link && <div className="pt-1"><OpenInHub topic={link} label={t('hub.panel.editInHub')} /></div>}

      {planning && lookup && (
        <PlanForm lookup={lookup} plan={planning.plan} defaultDate={today} defaults={planning.defaults}
          onClose={() => setPlanning(null)} onSaved={() => { setPlanning(null); changed() }} />
      )}
    </div>
  )
}

/** A topic opened from the syllabus tracker: the same panel, in a drawer; `section` ({ id, label, row, date }) adds its class. */
export function TopicDrawer({ topicId, subjectId, section, onClose, onChanged }) {
  const th = useTranslation('homework').t
  const { data: topic, isLoading, error } = useQuery({ queryKey: ['syllabus-topic', topicId], queryFn: () => fetchSyllabusTopic(topicId) })
  const canMark = hasPermission('homework.syllabus.edit') || hasPermission('homework.lesson-plans.edit')
  return (
    <Drawer open onClose={onClose} size="xl" title={topic?.name ?? th('homework.loading')} subtitle={topic ? `${topic.className} · ${topic.subject} · ${topic.unit}` : undefined}>
      {isLoading && <p className="text-sm text-ink-faint">{th('homework.loading')}</p>}
      {error && <Note tone="warning">{error.message}</Note>}
      {topic && (
        <TopicPanel topic={topic} parts={partsOf(topic)} subjectId={subjectId} today={section?.date} canMark={canMark} onChanged={onChanged} link={topic}
          classes={section?.row ? [{ id: section.id, label: section.label, row: section.row }] : []} />
      )}
    </Drawer>
  )
}
