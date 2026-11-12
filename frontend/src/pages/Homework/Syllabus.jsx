import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarRange, CheckCircle2, ChevronLeft, CircleAlert, CircleDashed, ClipboardPaste, ListChecks, Pencil, Plus, Save, X } from 'lucide-react'
import { parseSyllabusText, spreadUnits, topicMonth, yearPlan } from '@schoolgiant/shared'
import { ColorChip, DataTable, Input, Modal, Note, PageContainer, PageHeader, Panel, PillRow, ProgressBar, SegmentedControl, SideNav, SideNavLayout, StatusPill, Textarea, pillClass, useConfirm } from '../../components/system'
import { MonthSelect, useMonthLabel } from '../../components/homework/HomeworkKit'
import { TopicDrawer, TopicStatusPill } from '../../components/homework/TopicKit'
import HubBanner from '../../components/homework/HubBanner'
import Button from '../../components/ui/Button'
import { fetchSyllabus, fetchSyllabusOverview, markSyllabusTopics, saveSyllabus } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

function PasteModal({ onClose, onAdd }) {
  const { t } = useTranslation('homework')
  const [text, setText] = useState('')
  const units = parseSyllabusText(text)
  const topics = units.reduce((n, u) => n + u.topics.length, 0)
  return (
    <Modal open onClose={onClose} size="lg" title={t('homework.syllabus.paste.title')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button disabled={!units.length} onClick={() => onAdd(units)}>{t('homework.syllabus.paste.add', { units: units.length, topics })}</Button>
    </>}>
      <div className="space-y-3">
        <Note>{t('homework.syllabus.paste.hint')}</Note>
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('homework.syllabus.paste.placeholder')} />
      </div>
    </Modal>
  )
}

/** Edit the units and topics. Existing ones keep their ids, so sections’ ticks stay. */
function Editor({ syllabus, onDone }) {
  const { t } = useTranslation('homework')
  const { showSuccess, showError } = useSnackbar()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [units, setUnits] = useState(() => syllabus.units.map((u) => ({ ...u, topics: u.topics.map((x) => ({ ...x })) })))
  const [pasting, setPasting] = useState(false)
  const [errors, setErrors] = useState({})
  const setUnit = (i, v) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, name: v } : x)))
  const setTopic = (i, k, v, field = 'name') => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: x.topics.map((tp, m) => (m === k ? { ...tp, [field]: v } : tp)) } : x)))
  const setUnitMonth = (i, field, v) => setUnits((u) => u.map((x, j) => {
    if (j !== i) return x
    const next = { ...x, [field]: v }
    // keep the range the right way round
    if (field === 'fromMonth' && v && next.toMonth && next.toMonth < v) next.toMonth = v
    if (field === 'toMonth' && v && next.fromMonth && next.fromMonth > v) next.fromMonth = v
    return next
  }))
  const addTopic = (i) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: [...x.topics, { name: '' }] } : x)))
  const dropTopic = (i, k) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, topics: x.topics.filter((_, m) => m !== k) } : x)))
  const removedDone = syllabus.sections.some((s) => Object.keys(s.ticks).some((id) => !units.some((u) => u.topics.some((tp) => tp.id === id))))
  const save = useMutation({
    mutationFn: () => saveSyllabus({ classId: syllabus.classId, subjectId: syllabus.subjectId, units: units.map((u) => ({
      id: u.id, name: u.name, fromMonth: u.fromMonth || null, toMonth: u.toMonth || null,
      topics: u.topics.filter((x) => x.name.trim()).map((x) => ({ id: x.id, name: x.name, periods: x.periods || undefined, month: x.month || null })),
    })).filter((u) => u.name.trim()) }),
    onSuccess: (d) => { qc.setQueryData(['syllabus', syllabus.classId, syllabus.subjectId], d); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }); showSuccess(t('homework.syllabus.saved')); onDone() },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setUnits((u) => [...u, { name: '', topics: [{ name: '' }] }])}>{t('homework.syllabus.addUnit')}</Button>
          <Button size="sm" variant="secondary" icon={ClipboardPaste} onClick={() => setPasting(true)}>{t('homework.syllabus.paste.button')}</Button>
          <Button size="sm" variant="secondary" icon={CalendarRange} disabled={!units.length} title={t('homework.syllabus.plan.spreadHint')}
            onClick={async () => { if (!units.some((u) => u.fromMonth) || await confirm({ title: t('homework.syllabus.plan.spreadConfirm') })) setUnits((u) => spreadUnits(u, syllabus.months)) }}>{t('homework.syllabus.plan.spread')}</Button>
        </div>
        <div className="flex gap-2 ms-auto">
          <Button variant="ghost" onClick={onDone}>{t('actions.cancel')}</Button>
          <Button icon={Save} loading={save.isPending} onClick={() => save.mutate()}>{t('homework.syllabus.save')}</Button>
        </div>
      </div>
      {removedDone && <Note tone="warning">{t('homework.syllabus.removedDone')}</Note>}
      {units.length > 0 && <Note>{t('homework.syllabus.plan.editorHint')}</Note>}
      {!units.length && <Note>{t('homework.syllabus.emptyEditor')}</Note>}
      {units.map((u, i) => (
        <Panel key={u.id ?? `new-${i}`}>
          {/* phones: number · name · remove on one line, the month range under it */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-ink-faint w-12 sm:w-14 shrink-0">{t('homework.syllabus.unitN', { n: i + 1 })}</span>
            <Input className="min-w-0 flex-1" value={u.name} onChange={(e) => setUnit(i, e.target.value)} placeholder={t('homework.syllabus.unitName')} aria-label={t('homework.syllabus.unitName')} error={!!errors[`units.${i}.name`]} />
            <Button size="sm" variant="ghost" icon={X} className="sm:order-last" aria-label={t('homework.syllabus.removeUnit')} title={t('homework.syllabus.removeUnit')} onClick={() => setUnits((x) => x.filter((_, j) => j !== i))} />
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <div className="min-w-0 flex-1 sm:flex-none sm:w-32"><MonthSelect className="w-full" months={syllabus.months} value={u.fromMonth} onChange={(v) => setUnitMonth(i, 'fromMonth', v)} placeholder={t('homework.syllabus.plan.from')} aria-label={t('homework.syllabus.plan.from')} error={!!errors[`units.${i}.fromMonth`]} /></div>
              <span className="text-ink-faint text-xs">–</span>
              <div className="min-w-0 flex-1 sm:flex-none sm:w-32"><MonthSelect className="w-full" months={syllabus.months} value={u.toMonth} onChange={(v) => setUnitMonth(i, 'toMonth', v)} placeholder={t('homework.syllabus.plan.to')} aria-label={t('homework.syllabus.plan.to')} error={!!errors[`units.${i}.toMonth`]} /></div>
            </div>
          </div>
          <div className="space-y-2 sm:ps-16">
            {u.topics.map((tp, k) => (
              // phones: topic + remove on one line, periods and month under it; a row from `sm` up
              <div key={tp.id ?? `n-${k}`} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border p-2 sm:flex sm:rounded-none sm:border-0 sm:p-0">
                <Input className="col-span-2 min-w-0 sm:flex-1" value={tp.name} onChange={(e) => setTopic(i, k, e.target.value)} placeholder={t('homework.syllabus.topicName')} aria-label={t('homework.syllabus.topicName')} />
                <Input className="row-start-2 w-full sm:w-20" type="number" min="0" max="200" value={tp.periods ?? ''} onChange={(e) => setTopic(i, k, e.target.value ? Number(e.target.value) : null, 'periods')} placeholder={t('homework.syllabus.plan.periods')} aria-label={t('homework.syllabus.plan.periods')} title={t('homework.syllabus.plan.periodsHint')} />
                <div className="row-start-2 col-start-2 min-w-0 sm:w-36 sm:shrink-0"><MonthSelect className="w-full" months={syllabus.months} value={tp.month} onChange={(v) => setTopic(i, k, v, 'month')} placeholder={t('homework.syllabus.plan.unitMonth')} aria-label={t('homework.syllabus.plan.topicMonth')} error={!!errors[`units.${i}.topics.${k}.month`]} /></div>
                <Button size="sm" variant="ghost" icon={X} className="row-start-1 col-start-3" aria-label={t('homework.syllabus.removeTopic')} title={t('homework.syllabus.removeTopic')} onClick={() => dropTopic(i, k)} />
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => addTopic(i)}>{t('homework.syllabus.addTopic')}</Button>
          </div>
        </Panel>
      ))}
      {pasting && <PasteModal onClose={() => setPasting(false)} onAdd={(list) => { setUnits((u) => [...u, ...list]); setPasting(false) }} />}
    </div>
  )
}

/** The year month by month for one section: what is planned when, what is taught, what is behind. */
function YearPlanView({ syl, sec }) {
  const { t } = useTranslation('homework')
  const monthLabel = useMonthLabel()
  const plan = yearPlan(syl.units, Object.keys(sec.ticks), syl.month)
  const unplanned = syl.units.flatMap((u) => u.topics.filter((tp) => !topicMonth(u, tp)).map((tp) => ({ topicId: tp.id, name: tp.name, unit: u.name, done: !!sec.ticks[tp.id] })))
  const stateOf = (m, r) => (r.done ? 'done' : m < syl.month ? 'behind' : m === syl.month ? 'due' : 'later')
  const ICON = { done: CheckCircle2, behind: CircleAlert, due: CircleDashed, later: CircleDashed }
  const TONE = { done: 'text-success-600', behind: 'text-danger-600', due: 'text-brand-600', later: 'text-ink-faint' }
  if (!plan.planned) return <Note>{t('homework.syllabus.plan.none')}</Note>
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {syl.months.map((m) => {
          const rows = plan.byMonth[m] ?? []
          const done = rows.filter((r) => r.done).length
          const late = m < syl.month && done < rows.length
          return (
            <Panel key={m} title={monthLabel(m, { long: true })}
              subtitle={rows.length ? t('homework.syllabus.unitProgress', { done, topics: rows.length }) : t('homework.syllabus.plan.nothing')}
              actions={m === syl.month ? <StatusPill tone="info">{t('homework.syllabus.plan.thisMonth')}</StatusPill> : late ? <StatusPill tone="danger">{t('homework.syllabus.plan.behindN', { count: rows.length - done })}</StatusPill> : null}
              className={m === syl.month ? 'ring-1 ring-brand-200' : undefined}>
              <ul className="space-y-1.5">
                {rows.map((r) => {
                  const st = stateOf(m, r)
                  const Icon = ICON[st]
                  return (
                    <li key={r.topicId} className="flex items-start gap-2 text-sm">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${TONE[st]}`} aria-label={t(`homework.syllabus.plan.state.${st}`)} />
                      <span className="min-w-0"><span className={r.done ? 'text-ink-muted line-through' : 'text-ink'}>{r.name}</span><span className="block text-xs text-ink-faint truncate">{r.unit}</span></span>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          )
        })}
      </div>
      {unplanned.length > 0 && (
        <Panel title={t('homework.syllabus.plan.unplanned')} subtitle={t('homework.syllabus.plan.unplannedHint', { count: unplanned.length })}>
          <p className="text-sm text-ink-muted">{unplanned.map((r) => r.name).join(' · ')}</p>
        </Panel>
      )}
    </div>
  )
}

function Detail({ classId, subjectId, initialSection, onBack }) {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const { date } = useFormat()
  const { showError } = useSnackbar()
  const key = ['syllabus', classId, subjectId]
  const { data: syl, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchSyllabus(classId, subjectId) })
  const [sectionId, setSectionId] = useState(initialSection ?? '')
  const [editing, setEditing] = useState(false)
  const [view, setView] = useState('TOPICS')
  const [openTopic, setOpenTopic] = useState(null)
  const monthLabel = useMonthLabel()
  useEffect(() => { if (syl && !syl.sections.some((s) => s.id === sectionId)) setSectionId(syl.sections[0]?.id ?? '') }, [syl, sectionId])
  const tick = useMutation({
    mutationFn: ({ topicId, done }) => markSyllabusTopics({ sectionId, subjectId, topicIds: [topicId], done }),
    onSuccess: (d) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }) },
    onError: (e) => showError(e.message),
  })
  if (isLoading) return <p className="text-sm text-ink-faint">{t('homework.loading')}</p>
  if (error || !syl) return <Note tone="warning">{error?.message}</Note>
  const sec = syl.sections.find((s) => s.id === sectionId)
  const canTick = hasPermission('homework.syllabus.edit') || hasPermission('homework.lesson-plans.edit')
  const canEdit = hasPermission('homework.syllabus.edit') && syl.canEditStructure

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} className="shrink-0" onClick={onBack} aria-label={t('homework.syllabus.back')} title={t('homework.syllabus.back')} />
          <div className="min-w-0">
            <p className="font-semibold text-ink break-words">{syl.className} · {syl.subject}</p>
            <p className="text-xs text-ink-muted">{t('homework.syllabus.counts', { units: syl.units.length, topics: syl.units.reduce((n, u) => n + u.topics.length, 0) })}{syl.updatedBy ? ` · ${t('homework.syllabus.updatedBy', { name: syl.updatedBy })}` : ''}</p>
          </div>
        </div>
        {!editing && canEdit && <Button size="sm" variant="secondary" icon={Pencil} className="ms-12 sm:ms-0" onClick={() => setEditing(true)}>{syl.units.length ? t('homework.syllabus.edit') : t('homework.syllabus.create')}</Button>}
      </div>
      {editing ? <Editor syllabus={syl} onDone={() => setEditing(false)} /> : (
        <>
          {!syl.units.length && <Note>{canEdit ? t('homework.syllabus.noneYetEdit') : t('homework.syllabus.noneYet')}</Note>}
          {syl.sections.length > 1 && (
            <PillRow>
              {syl.sections.map((s) => (
                <button key={s.id} type="button" aria-pressed={sectionId === s.id} onClick={() => setSectionId(s.id)} className={pillClass(sectionId === s.id)}>
                  {s.short} <span className={`tabular-nums ${s.behind ? 'text-danger-600' : 'opacity-70'}`}>· {s.pct}%</span>
                </button>
              ))}
            </PillRow>
          )}
          {sec && syl.units.length > 0 && <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-ink-muted w-full sm:w-auto">{t('homework.syllabus.sectionProgress', { section: sec.label, done: sec.done, topics: sec.topics })}</span>
              <div className="flex-1 min-w-[8rem] sm:max-w-xs"><ProgressBar value={sec.pct} /></div>
              {sec.behind > 0 && <StatusPill tone="danger">{t('homework.syllabus.plan.behindN', { count: sec.behind })}</StatusPill>}
              {sec.due > 0 && <StatusPill tone="info">{t('homework.syllabus.plan.dueN', { count: sec.due })}</StatusPill>}
              {!sec.behind && sec.topics > 0 && sec.done < sec.topics && <StatusPill tone="neutral">{t('homework.teach.onTrack')}</StatusPill>}
              {sec.progress?.revision > 0 && <StatusPill tone="warning">{t('homework.teach.revisionN', { count: sec.progress.revision })}</StatusPill>}
              {sec.progress?.extraDone > 0 && <span className="text-xs text-ink-muted">{t('homework.teach.extraTaken', { count: sec.progress.extraDone })}</span>}
              <SegmentedControl className="w-full sm:w-auto sm:ms-auto" value={view} onChange={setView} options={[
                { value: 'TOPICS', label: t('homework.syllabus.plan.viewTopics'), icon: ListChecks },
                { value: 'PLAN', label: t('homework.syllabus.plan.viewPlan'), icon: CalendarRange },
              ]} />
            </div>
            {view === 'PLAN' ? <YearPlanView syl={syl} sec={sec} /> : syl.units.map((u, i) => {
              const pu = sec.perUnit.find((x) => x.id === u.id)
              return (
                <Panel key={u.id} title={u.name} subtitle={[t('homework.syllabus.unitProgress', { done: pu?.done ?? 0, topics: u.topics.length }), u.fromMonth && (u.fromMonth === u.toMonth ? monthLabel(u.fromMonth) : `${monthLabel(u.fromMonth)} – ${monthLabel(u.toMonth)}`)].filter(Boolean).join(' · ')}>
                  <div className="divide-y divide-border">
                    {u.topics.map((tp) => {
                      const d = sec.ticks[tp.id]
                      const pl = sec.topicPlan?.[tp.id]
                      return (
                        <div key={tp.id} className="flex items-start sm:items-center gap-3 py-2.5 sm:py-2 text-sm">
                          <input type="checkbox" checked={!!d} aria-label={tp.name} disabled={!canTick || tick.isPending} onChange={(e) => tick.mutate({ topicId: tp.id, done: e.target.checked })} className="mt-0.5 sm:mt-0 h-5 w-5 sm:h-4 sm:w-4 shrink-0 rounded border-border text-brand-500 focus:ring-brand-500" />
                          {/* tap the topic for its material and this section's record; phones: when / who sits under it */}
                          <button type="button" onClick={() => setOpenTopic(tp.id)} className="flex-1 min-w-0 text-start flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1">
                            <span className={`flex-1 ${d ? 'text-ink-muted line-through' : 'text-ink'} hover:text-brand-700`}>
                              {tp.name}{tp.hasContent && <BookOpen className="inline w-3.5 h-3.5 ms-1.5 text-ink-faint" aria-label={t('homework.topic.hasMaterial')} />}
                            </span>
                            {(pl?.status === 'PARTLY' || pl?.needsRevision || pl?.extraClasses?.length > 0) && (
                              <span className="flex flex-wrap items-center gap-1">
                                {!d && pl.status === 'PARTLY' && <TopicStatusPill status="PARTLY" />}
                                {pl.needsRevision && <StatusPill tone="warning">{t('homework.topic.needsRevision')}</StatusPill>}
                                {pl.extraClasses?.length > 0 && <span className="text-xs text-ink-faint">{t('homework.topic.extraN', { count: pl.extraClasses.length })}</span>}
                              </span>
                            )}
                            {!d && pl?.start && <span className={`text-xs ${pl.end < syl.today ? 'text-danger-600' : 'text-ink-faint'}`}>{date(pl.start)}</span>}
                            {!d && !pl?.start && tp.month && <span className={`text-xs ${tp.month < syl.month ? 'text-danger-600' : 'text-ink-faint'}`}>{monthLabel(tp.month)}</span>}
                            {d && <span className="text-xs text-ink-faint">{date(d.date)}{d.by ? ` · ${d.by}` : ''}{d.fromPlan ? ` · ${t('homework.syllabus.fromPlan')}` : ''}</span>}
                          </button>
                        </div>
                      )
                    })}
                    {!u.topics.length && <p className="py-2 text-sm text-ink-faint">{t('homework.syllabus.noTopics', { n: i + 1 })}</p>}
                  </div>
                </Panel>
              )
            })}
          </>}
          {!syl.sections.length && <Note tone="warning">{t('homework.syllabus.noSections')}</Note>}
        </>
      )}
      {openTopic && <TopicDrawer topicId={openTopic} subjectId={subjectId} onClose={() => setOpenTopic(null)}
        section={sec && { id: sec.id, label: sec.label, date: syl.today, row: { id: openTopic, ...sec.topicPlan?.[openTopic] } }}
        onChanged={() => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }); qc.invalidateQueries({ queryKey: ['teach-day'] }) }} />}
    </div>
  )
}

/** One row's progress over all its sections: topics taught / topics to teach. */
const overall = (r) => {
  const done = r.sections.reduce((n, s) => n + s.done, 0)
  const total = r.sections.reduce((n, s) => n + s.topics, 0)
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, behind: r.sections.reduce((n, s) => n + (s.behind || 0), 0) }
}

export default function Syllabus() {
  const { t } = useTranslation('homework')
  const [params, setParams] = useSearchParams()
  const classId = params.get('class')
  const subjectId = params.get('subject')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['syllabus-overview'], queryFn: fetchSyllabusOverview })
  const rows = data?.rows ?? []
  // the classes down the side: each with how far all its subjects have got
  const classes = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.classId)) m.set(r.classId, { id: r.classId, name: r.className, subjects: 0, done: 0, total: 0, behind: 0 })
      const c = m.get(r.classId); const o = overall(r)
      c.subjects += 1; c.done += o.done; c.total += o.total; c.behind += o.behind
    }
    return [...m.values()]
  }, [rows])
  const pctOf = (done, total) => (total ? Math.round((done / total) * 100) : 0)
  const shown = classId ? rows.filter((r) => r.classId === classId) : rows
  const subjectsHere = rows.filter((r) => r.classId === classId)
  const classNav = classes.length > 1 && (
    <SideNav title={t('homework.syllabus.classesNav')} value={classId ?? ''} onChange={(id) => setParams(id ? { class: id } : {})} items={[
      { id: '', label: t('homework.syllabus.allClasses'), icon: ListChecks, count: rows.length },
      ...classes.map((c) => ({
        id: c.id, label: c.name,
        hint: c.behind ? t('homework.syllabus.plan.behindN', { count: c.behind }) : t('homework.syllabus.subjectsN', { count: c.subjects }),
        count: c.total ? `${pctOf(c.done, c.total)}%` : undefined, countTone: c.behind ? 'warning' : undefined,
        progress: c.total ? { value: c.done, max: c.total, kind: 'done' } : undefined,
      })),
    ]} />
  )
  const subjectNav = subjectsHere.length > 1 && (
    <SideNav title={t('homework.syllabus.subjectsNav', { cls: subjectsHere[0].className })} value={subjectId} onChange={(id) => setParams({ class: classId, subject: id })} items={subjectsHere.map((r) => {
      const o = overall(r)
      return {
        id: r.subjectId, label: r.subject,
        hint: r.topics ? (o.behind ? t('homework.syllabus.plan.behindN', { count: o.behind }) : t('homework.syllabus.counts', { units: r.units, topics: r.topics })) : t('homework.syllabus.notSet'),
        count: r.topics ? `${o.pct}%` : undefined, countTone: o.behind ? 'warning' : undefined,
        progress: o.total ? { value: o.done, max: o.total, kind: 'done' } : undefined,
      }
    })} />
  )
  return (
    <PageContainer>
      <PageHeader icon={ListChecks} title={t('homework.syllabus.title')} subtitle={t('homework.syllabus.subtitle')} />
      <HubBanner classId={classId} subjectId={subjectId} className="mb-3" />
      {classId && subjectId ? (
        <SideNavLayout nav={subjectNav}>
          <Detail key={`${classId}:${subjectId}`} classId={classId} subjectId={subjectId} initialSection={params.get('section')} onBack={() => setParams({ class: classId })} />
        </SideNavLayout>
      ) : (
        <SideNavLayout nav={classNav}>
          <DataTable
            rows={shown}
            rowKey="key"
            loading={isLoading}
            error={error}
            onRetry={refetch}
            columns={[
              { key: 'className', header: t('homework.syllabus.class'), render: (v, r) => {
                const o = overall(r)
                return (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1"><ColorChip label={v} seed={r.classId} /><ColorChip label={r.subject} seed={r.subjectId} dot /></div>
                    <p className="text-xs font-normal text-ink-faint mt-1">{r.topics ? t('homework.syllabus.counts', { units: r.units, topics: r.topics }) : t('homework.syllabus.notSet')}{r.topics > 0 && !r.planned ? ` · ${t('homework.syllabus.plan.notPlanned')}` : ''}</p>
                    {/* phones: every section's progress in one line under the subject (the column is hidden there) */}
                    {r.topics > 0 && (
                      <div className="md:hidden mt-1.5 flex items-center gap-2">
                        <div className="w-24 shrink-0"><ProgressBar value={o.pct} showValue={false} /></div>
                        <p className="min-w-0 truncate text-xs font-normal text-ink-muted">
                          {r.sections.map((s) => `${s.short} ${s.done}/${s.topics}`).join(' · ')}
                          {o.behind > 0 && <span className="text-danger-600"> · {t('homework.syllabus.plan.behindN', { count: o.behind })}</span>}
                        </p>
                      </div>
                    )}
                  </div>
                )
              } },
              { key: 'sections', header: t('homework.syllabus.progress'), clamp: false, mobileHidden: true, render: (v, r) => (r.topics ? (
                <div className="flex flex-wrap gap-3">
                  {v.map((s) => <div key={s.id} className="w-28"><p className="text-xs text-ink-muted mb-0.5">{s.short} · {s.done}/{s.topics}</p><ProgressBar value={s.pct} showValue={false} />{s.behind > 0 && <p className="text-[11px] text-danger-600 mt-0.5">{t('homework.syllabus.plan.behindN', { count: s.behind })}</p>}{s.revision > 0 && <p className="text-[11px] text-amber-600 mt-0.5">{t('homework.teach.revisionN', { count: s.revision })}</p>}</div>)}
                </div>
              ) : <span className="text-xs text-ink-faint">—</span>) },
              { key: 'pct', header: t('homework.syllabus.overall'), align: 'right', mobileTrail: true, render: (_, r) => (r.topics ? <span className="text-sm font-semibold tabular-nums text-ink">{overall(r).pct}%</span> : <span className="text-ink-faint">—</span>) },
            ]}
            onRowClick={(r) => setParams({ class: r.classId, subject: r.subjectId })}
            emptyIcon={ListChecks} emptyTitle={t('homework.syllabus.empty')} emptyHint={t('homework.syllabus.emptyHint')}
          />
        </SideNavLayout>
      )}
    </PageContainer>
  )
}
