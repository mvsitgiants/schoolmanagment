import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowRight, CheckCheck, ChevronDown, CircleDashed, ListChecks, Pencil } from 'lucide-react'
import { Skeleton } from '../system'
import Button from '../ui/Button'
import { ContentDot } from './HubTree'
import TopicPanel, { partsOf } from './TopicPanel'
import { fetchSyllabusTopic } from '../../api/homework'
import { hasPermission } from '../../api/auth'

// The Teaching hub's subject screen: every unit with its topics, each topic opening in place to the shared topic panel
// (how each class stands, what students see, the teacher's notes, the questions). "Edit topic" / "Open unit" go on to
// changing it (step 2 of the hub).

/** A topic opened in place: loaded, then the shared panel; "Edit topic" goes to editing it. */
function TopicPeek({ topicId, subjectId, today, classesOf, canMark, canEdit, onChanged, onEdit }) {
  const { t } = useTranslation('hub')
  const { data: topic, isLoading } = useQuery({ queryKey: ['syllabus-topic', topicId], queryFn: () => fetchSyllabusTopic(topicId), staleTime: 30_000 })
  if (isLoading || !topic) return <Skeleton className="h-24" />
  return (
    <div className="space-y-2">
      <TopicPanel topic={topic} parts={partsOf(topic)} classes={classesOf({ id: topicId })} subjectId={subjectId} today={today} canMark={canMark} onChanged={onChanged} />
      {canEdit && <div className="flex justify-end"><Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{t('hub.subject.editTopic')}</Button></div>}
    </div>
  )
}

/**
 * units         the hub's units of the subject ({ id, name, fromMonth, toMonth, topics })
 * outlineUnits  the same units from the outline, with each topic's state ({ id, topics: [{ id, name, content, questions, taughtIn, partlyIn }] })
 * editMode      the hub's Edit is on: Open unit, rename and Edit topic show (off: read only, marking still works)
 * focus         { unitId, topicId, n } picked in the tree: that topic opens (or that unit comes) into view
 */
export default function HubSubjectView({ units, outlineUnits = [], subjectId, today, classesOf, canMark, canEdit, editMode = false, focus, monthName, onOpenUnit, onEditUnit, onEditTopic, onChanged }) {
  const { t } = useTranslation('hub')
  const [closed, setClosed] = useState(() => new Set()) // units folded away (all open at first)
  const [openTopic, setOpenTopic] = useState(null)
  // picked in the tree: open that topic (and its unit) and bring it into view
  useEffect(() => {
    if (!focus?.unitId && !focus?.topicId) return
    const unitId = focus.unitId ?? units.find((u) => (outlineUnits.find((x) => x.id === u.id)?.topics ?? []).some((x) => x.id === focus.topicId))?.id
    if (unitId) setClosed((x) => { if (!x.has(unitId)) return x; const n = new Set(x); n.delete(unitId); return n })
    if (focus.topicId) setOpenTopic(focus.topicId)
    requestAnimationFrame(() => document.getElementById(focus.topicId ? `subject-topic-${focus.topicId}` : `subject-unit-${unitId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [focus?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleUnit = (id) => setClosed((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="divide-y divide-border">
      {units.map((u) => {
        const topics = outlineUnits.find((x) => x.id === u.id)?.topics ?? []
        const done = topics.filter((x) => x.content !== 'NONE').length
        const live = topics.filter((x) => x.content === 'PUBLISHED').length
        const open = !closed.has(u.id)
        return (
          <section key={u.id} id={`subject-unit-${u.id}`} className="scroll-mt-20 py-2 first:pt-0 last:pb-0">
            {/* the unit: name, months, how much is written; fold, open it, rename it */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => toggleUnit(u.id)} aria-expanded={open} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-start hover:bg-black/[0.03]">
                <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-faint transition', !open && '-rotate-90')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{u.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[t('hub.pick.topicCount', { count: u.topics }), u.fromMonth && t('hub.pick.months', { from: monthName(u.fromMonth), to: monthName(u.toMonth ?? u.fromMonth) })].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {topics.length > 0 && (
                  <span className="hidden shrink-0 items-center gap-3 text-xs text-ink-muted sm:flex">
                    <span className="inline-flex items-center gap-1"><ContentDot state={live === topics.length ? 'PUBLISHED' : done ? 'DRAFT' : 'NONE'} />{t('hub.pick.withContent', { done, all: topics.length })}</span>
                    {live > 0 && <span>{t('hub.pick.live', { count: live })}</span>}
                  </span>
                )}
              </button>
              {editMode && <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => onOpenUnit(u)}>{t('hub.subject.openUnit')}</Button>}
              {editMode && canEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('hub.unit.edit')} title={t('hub.unit.edit')} onClick={() => onEditUnit(u)} />}
            </div>
            {open && (
              topics.length ? (
                <ol className="ms-6 mt-1 divide-y divide-border rounded-lg border border-border">
                  {topics.map((x, i) => {
                    const peek = openTopic === x.id
                    return (
                      <li key={x.id} id={`subject-topic-${x.id}`} className="scroll-mt-20">
                        <button type="button" onClick={() => setOpenTopic(peek ? null : x.id)} aria-expanded={peek}
                          className={clsx('flex min-h-[44px] w-full items-center gap-2.5 px-3 text-start hover:bg-black/[0.02]', peek && 'bg-brand-50/50')}>
                          <span className="w-5 shrink-0 text-xs text-ink-faint">{i + 1}</span>
                          <ContentDot state={x.content} />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{x.name}</span>
                          {x.questions > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-faint" title={t('hub.tree.questions', { count: x.questions })}><ListChecks className="h-3.5 w-3.5" aria-hidden />{x.questions}</span>}
                          {x.taughtIn > 0 ? <CheckCheck className="h-4 w-4 shrink-0 text-success-600" aria-label={t('hub.tree.taught', { count: x.taughtIn })} />
                            : x.partlyIn > 0 ? <CircleDashed className="h-4 w-4 shrink-0 text-amber-600" aria-label={t('hub.tree.partly', { count: x.partlyIn })} /> : <span className="w-4 shrink-0" />}
                          <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-faint transition', peek && 'rotate-180')} aria-hidden />
                        </button>
                        {peek && (
                          <div className="border-t border-border bg-bg/40 p-3">
                            <TopicPeek topicId={x.id} subjectId={subjectId} today={today} classesOf={classesOf} canMark={canMark}
                              canEdit={editMode && canEdit && hasPermission('homework.hub.edit')} onChanged={onChanged} onEdit={() => onEditTopic(u, x)} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              ) : <p className="ms-7 py-2 text-xs text-ink-faint">{t('hub.topics.none')}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
