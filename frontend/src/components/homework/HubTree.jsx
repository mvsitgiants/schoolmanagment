import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, CheckCheck, ChevronRight, CircleDashed, GraduationCap, Layers, ListChecks, Plus } from 'lucide-react'
import { SearchInput, Skeleton } from '../system'

// The Subject hub's outline: class → subject → unit → topic, each topic marked with what it holds, and at each level how
// many of its topics have student content. Picking a subject, unit or topic opens it on the right (pages/Homework/Hub.jsx).

const has = (t) => t.content !== 'NONE'
const tally = (topics) => ({ done: topics.filter(has).length, all: topics.length })
const topicsOfSubject = (s) => s.units.flatMap((u) => u.topics)

/** How far along: "9/13" topics with content (muted; the brand colour once all have it). */
function Count({ done, all }) {
  const { t } = useTranslation('hub')
  if (!all) return null
  return <span title={t('hub.tree.countTitle', { done, all })} className={clsx('ms-auto shrink-0 ps-2 font-mono-num text-[11px] tabular-nums', done === all ? 'text-brand-700' : 'text-ink-faint')}>{done}/{all}</span>
}

/** A topic's student content: ● published · ◔ scheduled · ◐ draft · ○ nothing yet. */
export function ContentDot({ state, className }) {
  const { t } = useTranslation('hub')
  return (
    <span title={t(`hub.tree.state.${state}`)} aria-label={t(`hub.tree.state.${state}`)} role="img"
      className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', {
        'bg-brand-600': state === 'PUBLISHED',
        'border-2 border-brand-600 bg-brand-100': state === 'SCHEDULED',
        'border-2 border-ink-muted bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] text-ink-muted': state === 'DRAFT',
        'border border-ink-faint': state === 'NONE',
      }, className)} />
  )
}

function Row({ depth, open, selected, onClick, icon: Icon, lead, label, count, children, title }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-current={selected ? 'true' : undefined} title={title ?? label}
      style={{ paddingInlineStart: `${0.375 + depth * 0.875}rem` }}
      className={clsx('flex min-h-[36px] w-full items-center gap-1.5 rounded-md pe-2 text-start text-sm [@media(pointer:coarse)]:min-h-[44px]',
        selected ? 'bg-brand-50 font-medium text-brand-800' : 'text-ink hover:bg-black/[0.03]')}>
      {open === undefined ? <span className="w-3.5 shrink-0" /> : <ChevronRight className={clsx('h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} aria-hidden />}
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}
      {lead}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
      {count && <Count {...count} />}
    </button>
  )
}

/**
 * outline   GET /teaching/hub/outline
 * selected  { classId, subjectId, unitId, topicId } — its path opens by itself
 * onPick    ({ classId, subjectId, unitId?, topicId? }) when a subject, unit or topic is chosen
 * onAddClass / onAddSubject(class)  shown only when the person may set those up
 */
export default function HubTree({ outline, loading, selected, onPick, onAddClass, onAddSubject, className }) {
  const { t } = useTranslation('hub')
  const [open, setOpen] = useState(() => new Set())
  const [q, setQ] = useState('')
  const toggle = (key) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const openKeys = (...keys) => setOpen((s) => (keys.every((k) => s.has(k)) ? s : new Set([...s, ...keys])))

  // the chosen subject / unit / topic: open the way to it
  useEffect(() => {
    const { classId, subjectId, unitId, topicId } = selected
    if (!outline || !classId) return
    const keys = [`c:${classId}`]
    if (subjectId) keys.push(`s:${classId}:${subjectId}`)
    const subject = outline.classes.find((c) => c.id === classId)?.subjects.find((s) => s.id === subjectId)
    const unit = subject?.units.find((u) => u.id === unitId) ?? subject?.units.find((u) => u.topics.some((x) => x.id === topicId))
    if (unit) keys.push(`u:${unit.id}`)
    openKeys(...keys)
  }, [outline, selected.classId, selected.subjectId, selected.unitId, selected.topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  // searching: only topics whose name matches, with everything above them open
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!outline || !needle) return outline?.classes ?? []
    return outline.classes.map((c) => ({
      ...c,
      subjects: c.subjects.map((s) => ({
        ...s,
        units: s.units.map((u) => ({ ...u, topics: u.topics.filter((x) => x.name.toLowerCase().includes(needle)) })).filter((u) => u.topics.length || u.name.toLowerCase().includes(needle)),
      })).filter((s) => s.units.length || s.name.toLowerCase().includes(needle)),
    })).filter((c) => c.subjects.length || c.name.toLowerCase().includes(needle))
  }, [outline, needle])
  const isOpen = (key) => !!needle || open.has(key)

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{t('hub.tree.title')}</p>
          {onAddClass && (
            <button type="button" onClick={onAddClass} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-brand-700 hover:bg-brand-50 [@media(pointer:coarse)]:min-h-10">
              <Plus className="h-3.5 w-3.5" aria-hidden />{t('hub.tree.addClass')}
            </button>
          )}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder={t('hub.tree.search')} className="sm:w-full [&_input]:sm:w-full" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="tree" aria-label={t('hub.tree.title')}>
        {loading ? <div className="space-y-2 p-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7" />)}</div>
          : !shown.length ? <p className="px-3 py-6 text-center text-sm text-ink-muted">{needle ? t('hub.tree.noMatch') : t('hub.pick.noClasses')}</p>
            : shown.map((c) => {
              const ck = `c:${c.id}`
              const cTopics = c.subjects.flatMap(topicsOfSubject)
              return (
                <div key={c.id} role="treeitem" aria-expanded={isOpen(ck)}>
                  <Row depth={0} open={isOpen(ck)} onClick={() => toggle(ck)} icon={GraduationCap} label={c.name} count={tally(cTopics)} />
                  {isOpen(ck) && c.subjects.map((s) => {
                    const sk = `s:${c.id}:${s.id}`
                    const here = selected.classId === c.id && selected.subjectId === s.id
                    return (
                      <div key={s.id} role="treeitem" aria-expanded={isOpen(sk)}>
                        <Row depth={1} open={isOpen(sk)} selected={here && !selected.unitId && !selected.topicId} icon={BookOpen} label={s.name} count={tally(topicsOfSubject(s))}
                          onClick={() => { if (!here) onPick({ classId: c.id, subjectId: s.id }); toggle(sk) }} />
                        {isOpen(sk) && (s.units.length ? s.units.map((u) => {
                          const uk = `u:${u.id}`
                          return (
                            <div key={u.id} role="treeitem" aria-expanded={isOpen(uk)}>
                              <Row depth={2} open={isOpen(uk)} selected={here && selected.unitId === u.id && !selected.topicId} icon={Layers} label={u.name} count={tally(u.topics)}
                                onClick={() => { onPick({ classId: c.id, subjectId: s.id, unitId: u.id }); if (!open.has(uk) || selected.unitId !== u.id) openKeys(uk); else toggle(uk) }} />
                              {isOpen(uk) && u.topics.map((x) => (
                                <div key={x.id} role="treeitem">
                                  <Row depth={3} selected={here && selected.topicId === x.id} label={x.name} lead={<ContentDot state={x.content} />}
                                    title={[x.name, t(`hub.tree.state.${x.content}`), x.questions && t('hub.tree.questions', { count: x.questions }), x.taughtIn ? t('hub.tree.taught', { count: x.taughtIn }) : x.partlyIn && t('hub.tree.partly', { count: x.partlyIn })].filter(Boolean).join(' · ')}
                                    onClick={() => onPick({ classId: c.id, subjectId: s.id, unitId: u.id, topicId: x.id })}>
                                    {x.questions > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ink-faint"><ListChecks className="h-3 w-3" aria-hidden />{x.questions}</span>}
                                    {/* teaching: taught somewhere, or started (partly) — nothing while not started */}
                                    {x.taughtIn > 0 ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-success-600" aria-label={t('hub.tree.taught', { count: x.taughtIn })} />
                                      : x.partlyIn > 0 ? <CircleDashed className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label={t('hub.tree.partly', { count: x.partlyIn })} /> : <span className="w-3.5 shrink-0" />}
                                  </Row>
                                </div>
                              ))}
                            </div>
                          )
                        }) : <p className="py-1.5 text-xs text-ink-faint" style={{ paddingInlineStart: '2.75rem' }}>{t('hub.tree.noUnits')}</p>)}
                      </div>
                    )
                  })}
                  {isOpen(ck) && onAddSubject && !needle && (
                    <button type="button" onClick={() => onAddSubject(c)} style={{ paddingInlineStart: '1.625rem' }}
                      className="flex min-h-[32px] w-full items-center gap-1.5 rounded-md pe-2 text-start text-xs font-medium text-brand-700 hover:bg-brand-50 [@media(pointer:coarse)]:min-h-[44px]">
                      <Plus className="h-3.5 w-3.5" aria-hidden />{t('hub.tree.addSubject')}
                    </button>
                  )}
                </div>
              )
            })}
      </div>
      {/* the key: what students can see (the dot), how far it is taught (the mark), and what the numbers count */}
      <div className="space-y-1 border-t border-border px-3 py-2 text-[11px] text-ink-muted">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-semibold text-ink-muted">{t('hub.tree.keyStudents')}</span>
          {['PUBLISHED', 'SCHEDULED', 'DRAFT', 'NONE'].map((x) => <span key={x} className="inline-flex items-center gap-1"><ContentDot state={x} />{t(`hub.tree.short.${x}`)}</span>)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-semibold text-ink-muted">{t('hub.tree.keyTeaching')}</span>
          <span className="inline-flex items-center gap-1"><CheckCheck className="h-3 w-3 text-success-600" aria-hidden />{t('hub.tree.legendTaught')}</span>
          <span className="inline-flex items-center gap-1"><CircleDashed className="h-3 w-3 text-amber-600" aria-hidden />{t('hub.tree.legendPartly')}</span>
          <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" aria-hidden />{t('hub.tree.legendQuestions')}</span>
        </p>
        <p>{t('hub.tree.legendCount')}</p>
      </div>
    </div>
  )
}
