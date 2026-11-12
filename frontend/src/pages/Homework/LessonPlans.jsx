import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, List, Plus, SkipForward, Undo2 } from 'lucide-react'
import { LESSON_STATUS, addDaysYmd, monthGrid, topicMonth, weekOf } from '@schoolgiant/shared'
import { Calendar, ControlChip, EmptyState, Pagination, Panel, DateInput, FormField, HeaderButton, Input, Modal, Note, PageContainer, PageHeader, SegmentedControl, Select, StatusPill, Textarea, localIso, useConfirm, usePrompt } from '../../components/system'
import { MaterialEditor } from '../../components/homework/LessonMaterial'
import { useMonthLabel, useWeekdayLabel } from '../../components/homework/HomeworkKit'
import Button from '../../components/ui/Button'
import { createLessonPlan, fetchHomeworkLookup, fetchLessonCalendar, fetchLessonPlans, fetchSyllabus, setLessonPlanStatus, updateLessonPlan } from '../../api/homework'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import LessonView from '../../components/homework/LessonView'

const PAGE = 50

/** New / edit lesson plan. Also used from My workspace › My teaching (`defaults` pre-fills class and subject). */
export function PlanForm({ lookup, plan, defaultDate, defaults, onClose, onSaved }) {
  const { t } = useTranslation('homework')
  const { showError } = useSnackbar()
  const sections = lookup?.sections ?? []
  const [form, setForm] = useState(() => ({
    sectionId: plan?.sectionId ?? defaults?.sectionId ?? sections[0]?.id ?? '', subjectId: plan?.subjectId ?? defaults?.subjectId ?? '', date: plan?.date ?? defaultDate, period: plan?.period ? String(plan.period) : '',
    title: plan?.title ?? '', topicIds: plan?.topicIds ?? defaults?.topicIds ?? [], objectives: plan?.objectives ?? '', method: plan?.method ?? '', resources: plan?.resources ?? '', homeworkNote: plan?.homeworkNote ?? '',
    links: (plan?.links ?? []).map((l) => ({ title: l.title ?? '', url: l.url ?? '' })), materialNotes: plan?.materialNotes ?? '',
  }))
  const [errors, setErrors] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const section = sections.find((s) => s.id === form.sectionId)
  const subjects = section?.subjects ?? []
  const { data: syllabus } = useQuery({ queryKey: ['syllabus', section?.classId, form.subjectId], queryFn: () => fetchSyllabus(section.classId, form.subjectId), enabled: !!section && !!form.subjectId })
  const doneHere = syllabus?.sections.find((s) => s.id === form.sectionId)?.ticks ?? {}
  const monthLabel = useMonthLabel()
  const planMonth = form.date?.slice(0, 7)
  const toggle = (id) => setForm((f) => ({ ...f, topicIds: f.topicIds.includes(id) ? f.topicIds.filter((x) => x !== id) : [...f.topicIds, id] }))
  const save = useMutation({
    mutationFn: () => {
      // blank link rows are dropped; a link without https:// gets it added
      const links = form.links.filter((l) => l.url.trim()).map((l) => ({ title: l.title.trim(), url: /^https?:\/\//i.test(l.url.trim()) ? l.url.trim() : `https://${l.url.trim()}` }))
      const body = { ...form, links }
      return plan ? updateLessonPlan(plan.id, body) : createLessonPlan(body)
    },
    onSuccess: onSaved,
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={plan ? t('homework.lessons.form.editTitle') : t('homework.lessons.form.newTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('actions.cancel')}</Button>
      <Button loading={save.isPending} disabled={!form.sectionId || !form.subjectId || !form.date || form.title.trim().length < 2} onClick={() => save.mutate()}>{t('homework.lessons.form.save')}</Button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('homework.lessons.form.class')} required>
          <Select value={form.sectionId} onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value, subjectId: '', topicIds: [] }))}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </FormField>
        <FormField label={t('homework.lessons.form.subject')} required error={errors.subjectId}>
          <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value, topicIds: [] }))}>
            <option value="">{t('homework.lessons.form.pickSubject')}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
        <FormField label={t('homework.lessons.form.date')} required error={errors.date}><DateInput value={form.date} onChange={set('date')} /></FormField>
        <FormField label={t('homework.lessons.form.period')}><Input type="number" min="1" max="15" value={form.period} onChange={set('period')} /></FormField>
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.title')} required error={errors.title}><Input value={form.title} onChange={set('title')} placeholder={t('homework.lessons.form.titlePlaceholder')} /></FormField></div>
        {form.subjectId && (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-ink-muted mb-1.5">{t('homework.lessons.form.topics')}</p>
            {syllabus?.units.length ? (
              <div className="space-y-2 max-h-56 overflow-y-auto rounded-lg border border-border p-3">
                {syllabus.units.map((u) => (
                  <div key={u.id}>
                    <p className="text-xs font-semibold text-ink-muted">{u.name}{u.fromMonth && <span className="font-normal text-ink-faint"> · {u.fromMonth === u.toMonth ? monthLabel(u.fromMonth) : `${monthLabel(u.fromMonth)} – ${monthLabel(u.toMonth)}`}</span>}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {u.topics.map((tp) => (
                        <label key={tp.id} className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={form.topicIds.includes(tp.id)} onChange={() => toggle(tp.id)} className="rounded border-border text-brand-500 focus:ring-brand-500" />
                          <span className={doneHere[tp.id] ? 'text-ink-faint' : topicMonth(u, tp) && topicMonth(u, tp) <= planMonth ? 'font-medium text-brand-700' : ''}>{tp.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-faint">{t('homework.lessons.form.noSyllabus')}</p>}
            {syllabus?.units.some((u) => u.fromMonth) && <p className="text-xs text-ink-faint mt-1">{t('homework.lessons.form.topicsHint')}</p>}
            {errors.topicIds && <p className="text-xs text-danger-600 mt-1">{errors.topicIds}</p>}
          </div>
        )}
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.objectives')}><Textarea rows={2} value={form.objectives} onChange={set('objectives')} placeholder={t('homework.lessons.form.objectivesPlaceholder')} /></FormField></div>
        <div className="sm:col-span-2"><FormField label={t('homework.lessons.form.method')}><Textarea rows={3} value={form.method} onChange={set('method')} placeholder={t('homework.lessons.form.methodPlaceholder')} /></FormField></div>
        <FormField label={t('homework.lessons.form.resources')}><Textarea rows={2} value={form.resources} onChange={set('resources')} /></FormField>
        <FormField label={t('homework.lessons.form.homeworkNote')}><Textarea rows={2} value={form.homeworkNote} onChange={set('homeworkNote')} /></FormField>
        <MaterialEditor planId={plan?.id} value={{ links: form.links, materialNotes: form.materialNotes }} errors={errors}
          onChange={(v) => setForm((f) => ({ ...f, links: v.links, materialNotes: v.materialNotes }))} />
      </div>
    </Modal>
  )
}

/** A month of lesson plans on the shared calendar: each day's first plans (the server sends three a day and the day's total); "+N more" opens the day. */
function MonthCalendar({ month, setMonth, days, canAdd, onAdd, onOpen, onMore, statusLabel }) {
  const { t } = useTranslation('homework')
  const items = useMemo(() => days.flatMap((d) => (d.plans ?? []).map((r) => ({
    id: r.id, date: d.date, title: `${r.section} · ${r.title}`, kind: r.subject, sub: statusLabel(r.status),
    tone: r.status === 'PLANNED' ? 'accent' : 'neutral', muted: r.status === 'SKIPPED', onClick: () => onOpen(r),
  }))), [days, onOpen, statusLabel])
  const totals = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d.total ?? 0])), [days])
  return (
    <Calendar month={month} onMonthChange={setMonth} items={items} dayTotals={totals}
      onAdd={canAdd ? onAdd : undefined} addLabel={t('homework.lessons.new')}
      legend={[{ tone: 'accent', label: statusLabel('PLANNED') }, { tone: 'neutral', label: statusLabel('DONE') }, { tone: 'neutral', label: statusLabel('SKIPPED'), muted: true }]}
      renderDayPanel={(day, its, list) => (
        <>
          {list}
          {(totals[day] ?? 0) > 0 && <Button size="sm" variant="ghost" className="mt-1" onClick={() => onMore(day)}>{t('homework.lessons.seeWeek')}</Button>}
        </>
      )} />
  )
}

/**
 * The week, day by day: a heading per day, then one line a lesson — period, the lesson with its class and subject under
 * it, the teacher, the status — and ✓ / skip on a lesson still planned. A lesson opens in place (renderLesson).
 */
function WeekList({ rows, loading, openId, onToggle, renderLesson, onDone, onSkip, onReopen, statusLabel }) {
  const { t } = useTranslation('homework')
  const { date } = useFormat()
  const weekday = useWeekdayLabel()
  const today = localIso(new Date())
  if (loading) return <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-black/5" />)}</div>
  const days = [...new Set(rows.map((r) => r.date))]
  return (
    <div>
      {days.map((d) => (
        <section key={d}>
          <p className={`sticky top-0 z-[1] border-b border-border bg-bg/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide backdrop-blur ${d === today ? 'text-brand-700' : 'text-ink-muted'}`}>
            {d === today ? t('homework.mine.today') : weekday(d)} · {date(d)}
          </p>
          <ul className="divide-y divide-border">
            {rows.filter((r) => r.date === d).map((r) => {
              const open = openId === r.id
              const act = r.canChange && hasPermission('homework.lesson-plans.edit')
              return (
                <li key={r.id} className={open ? 'bg-brand-50/30' : undefined}>
                  <div className="flex items-center gap-1 pe-3">
                    <button type="button" onClick={() => onToggle(r)} aria-expanded={open}
                      className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 ps-4 text-start hover:bg-black/[0.02]">
                      <span className="w-16 shrink-0 whitespace-nowrap text-xs text-ink-muted">{r.period ? t('homework.lessons.periodN', { n: r.period }) : '—'}</span>
                      <span className="min-w-0 flex-1 py-1.5">
                        <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                        <span className="block truncate text-xs text-ink-muted">{[r.section, r.subject].filter(Boolean).join(' · ')}<span className="md:hidden">{r.teacher ? ` · ${r.teacher}` : ''}</span></span>
                      </span>
                      <span className="hidden w-44 shrink-0 truncate text-sm text-ink-muted md:block">{r.teacher ?? '—'}</span>
                      <span className="w-24 shrink-0 text-end"><StatusPill tone={LESSON_STATUS[r.status]?.tone}>{statusLabel(r.status)}</StatusPill></span>
                    </button>
                    <span className="flex w-[4.5rem] shrink-0 justify-end gap-0.5">
                      {act && r.status === 'PLANNED' && <>
                        <Button size="sm" variant="ghost" icon={Check} title={t('homework.lessons.markDone')} aria-label={t('homework.lessons.markDone')} onClick={() => onDone(r)} />
                        <Button size="sm" variant="ghost" icon={SkipForward} title={t('homework.lessons.skip')} aria-label={t('homework.lessons.skip')} onClick={() => onSkip(r)} />
                      </>}
                      {act && r.status === 'SKIPPED' && <Button size="sm" variant="ghost" icon={Undo2} title={t('homework.lessons.reopen')} aria-label={t('homework.lessons.reopen')} onClick={() => onReopen(r)} />}
                    </span>
                  </div>
                  {open && <div className="border-t border-border px-4 py-3">{renderLesson(r)}</div>}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function LessonPlans() {
  const { t } = useTranslation('homework')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { date } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const [anchor, setAnchor] = useState(() => localIso(new Date()))
  const [sectionId, setSectionId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null) // a lesson opened read-only; Edit switches to the form
  const [newOn, setNewOn] = useState(null)
  const [view, setView] = useState('WEEK')
  const [mine, setMine] = useState(false)
  const monthLabel = useMonthLabel()
  const week = weekOf(anchor)
  const month = anchor.slice(0, 7)
  const grid = useMemo(() => { const [y, m] = month.split('-').map(Number); return monthGrid(y, m) }, [month])
  const range = view === 'MONTH' ? { from: grid[0][0], to: grid.at(-1)[6] } : week
  const rangeLabel = view === 'MONTH' ? monthLabel(month, { long: true }) : t('homework.lessons.week', { from: date(week.from), to: date(week.to) })
  const shift = (n) => setAnchor(addDaysYmd(week.from, 7 * n))
  const { data: lookup } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup })
  const sections = lookup?.sections ?? []
  const subjects = useMemo(() => {
    const m = new Map()
    for (const s of sections) for (const x of s.subjects) m.set(x.id, x)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sections])
  const params = { from: range.from, to: range.to, sectionId: sectionId || undefined, subjectId: subjectId || undefined, mine: mine ? '1' : undefined }
  // the week list comes a page at a time (date, then period); any change of week, view or filter starts again at page 1
  const filterKey = JSON.stringify([view, params])
  const [paged, setPaged] = useState({ key: '', page: 1 })
  const page = paged.key === filterKey ? paged.page : 1
  const listParams = { ...params, page, pageSize: PAGE }
  const list = useQuery({ queryKey: ['lesson-plans', 'list', listParams], queryFn: () => fetchLessonPlans(listParams), enabled: view === 'WEEK', placeholderData: keepPreviousData })
  // the month view: each day's tally and first three plans
  const cal = useQuery({ queryKey: ['lesson-plans', 'calendar', params], queryFn: () => fetchLessonCalendar(params), enabled: view === 'MONTH' })
  const { isLoading, error, refetch } = view === 'MONTH' ? cal : list
  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const refresh = () => { qc.invalidateQueries({ queryKey: ['lesson-plans'] }); qc.invalidateQueries({ queryKey: ['syllabus'] }); qc.invalidateQueries({ queryKey: ['syllabus-overview'] }) }
  const act = useMutation({ mutationFn: ({ fn }) => fn(), onSuccess: (_, v) => { refresh(); showSuccess(v.done) }, onError: (e) => showError(e.message) })
  const canEdit = hasPermission('homework.lesson-plans.edit')
  const statusLabel = (s) => t(`homework.lessons.status.${s}`, LESSON_STATUS[s]?.label ?? s)
  // the tiles cover the whole week (server counts), or the month itself — the grid has a few days either side
  const monthDays = (cal.data ?? []).filter((d) => d.date.startsWith(month))
  const inView = view === 'MONTH' ? monthDays.reduce((n, d) => n + d.total, 0) : total
  const countOf = (s) => (view === 'MONTH' ? monthDays.reduce((n, d) => n + (d.counts?.[s] ?? 0), 0) : list.data?.counts?.[s] ?? 0)
  const open = (r) => setViewing(r)
  // one line instead of the tiles: how many lessons in view, and how they stand
  const summary = inView > 0 && (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-ink-muted">
      <span><strong className="font-semibold text-ink">{inView}</strong> {t('homework.lessons.summary.lessons', { count: inView })}</span>
      <span aria-hidden>·</span>
      <span><strong className="font-semibold text-ink">{countOf('DONE')}</strong> {statusLabel('DONE').toLowerCase()}</span>
      <span aria-hidden>·</span>
      <span><strong className="font-semibold text-ink">{countOf('PLANNED')}</strong> {statusLabel('PLANNED').toLowerCase()}</span>
      {countOf('SKIPPED') > 0 && <><span aria-hidden>·</span><span className="text-amber-700"><strong className="font-semibold">{countOf('SKIPPED')}</strong> {statusLabel('SKIPPED').toLowerCase()}</span></>}
    </p>
  )
  // a lesson opened in place (no drawer): under its row in the list, under the calendar in the month view
  const lessonOf = (r) => <LessonView plan={r} onClose={() => setViewing(null)} onDeleted={() => { setViewing(null); refresh() }} onEdit={r.canChange && canEdit ? () => { setEditing(r); setViewing(null) } : undefined} />

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <SegmentedControl value={view} onChange={setView} className="me-2" options={[
          { value: 'WEEK', label: t('homework.lessons.viewWeek'), icon: List },
          { value: 'MONTH', label: t('homework.lessons.viewMonth'), icon: CalendarDays },
        ]} />
        {view === 'WEEK' && <>
          <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={t('homework.lessons.prevWeek')} onClick={() => shift(-1)} />
          <span className="text-sm font-medium text-ink px-1 min-w-[9rem] text-center">{rangeLabel}</span>
          <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={t('homework.lessons.nextWeek')} onClick={() => shift(1)} />
          <Button size="sm" variant="ghost" onClick={() => setAnchor(localIso(new Date()))}>{t('homework.lessons.thisWeek')}</Button>
        </>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ControlChip label={t('homework.class')} value={sections.find((s) => s.id === sectionId)?.short ?? t('homework.all')} active={!!sectionId}
          options={[t('homework.all'), ...sections.map((s) => s.short)]} onChange={(v) => setSectionId(sections.find((s) => s.short === v)?.id ?? '')} />
        <ControlChip label={t('homework.subject')} value={subjects.find((s) => s.id === subjectId)?.name ?? t('homework.all')} active={!!subjectId}
          options={[t('homework.all'), ...subjects.map((s) => s.name)]} onChange={(v) => setSubjectId(subjects.find((s) => s.name === v)?.id ?? '')} />
        <ControlChip label={t('homework.lessons.teacher')} value={mine ? t('homework.me') : t('homework.anyone')} active={mine}
          options={[t('homework.anyone'), t('homework.me')]} onChange={(v) => setMine(v === t('homework.me'))} />
      </div>
    </div>
  )

  return (
    <PageContainer>
      <PageHeader icon={ClipboardList} title={t('homework.lessons.title')} subtitle={t('homework.lessons.subtitle')}
        actions={<HeaderButton icon={Plus} variant="primary" requires="homework.lesson-plans.create" onClick={() => { setNewOn(null); setEditing('new') }}>{t('homework.lessons.new')}</HeaderButton>} />
      {lookup && !sections.length && <Note tone="warning" className="mb-4">{t('homework.noSections')}</Note>}
      {view === 'MONTH' && <div className="mb-3 space-y-2">{toolbar}{summary}</div>}
      {view === 'MONTH' ? (error ? <Note tone="warning">{error.message}</Note> : (
        <MonthCalendar month={month} setMonth={(ym) => setAnchor(`${ym}-01`)} days={cal.data ?? []} canAdd={hasPermission('homework.lesson-plans.create')} statusLabel={statusLabel}
          onAdd={(d) => { setNewOn(d); setEditing('new') }} onOpen={open} onMore={(d) => { setAnchor(d); setView('WEEK') }} />
      )) : (
        <Panel flush>
          <div className="space-y-2 border-b border-border p-3">
            {toolbar}
            {summary}
          </div>
          {error ? <EmptyState error={error} onRetry={refetch} /> : !isLoading && !rows.length ? (
            <EmptyState icon={ClipboardList} title={t('homework.lessons.empty')} hint={t('homework.lessons.emptyHint')} />
          ) : (
            <WeekList rows={rows} loading={isLoading} statusLabel={statusLabel} openId={viewing?.id} renderLesson={lessonOf}
              onToggle={(r) => setViewing((v) => (v?.id === r.id ? null : r))}
              onDone={async (r) => { const reflection = await prompt({ title: t('homework.lessons.doneConfirm.title', { title: r.title }), message: r.topics.length ? t('homework.lessons.doneConfirm.withTopics', { count: r.topics.length }) : t('homework.lessons.doneConfirm.message'), label: t('homework.lessons.reflection'), required: false }); if (reflection !== null) act.mutate({ fn: () => setLessonPlanStatus(r.id, { status: 'DONE', reflection: reflection || undefined }), done: t('homework.lessons.markedDone') }) }}
              onSkip={(r) => act.mutate({ fn: () => setLessonPlanStatus(r.id, { status: 'SKIPPED' }), done: t('homework.lessons.skipped') })}
              onReopen={(r) => act.mutate({ fn: () => setLessonPlanStatus(r.id, { status: 'PLANNED' }), done: t('homework.lessons.reopened') })} />
          )}
          {total > PAGE && <Pagination page={page - 1} size={PAGE} totalElements={total} totalPages={Math.ceil(total / PAGE)} onPageChange={(p) => setPaged({ key: filterKey, page: p + 1 })} />}
        </Panel>
      )}
      {/* the month view: the lesson picked on the calendar opens under it */}
      {view === 'MONTH' && viewing && (
        <Panel className="mt-3" title={viewing.title} subtitle={[date(viewing.date), viewing.period && t('homework.lessons.periodN', { n: viewing.period }), viewing.section, viewing.subject].filter(Boolean).join(' · ')}>{lessonOf(viewing)}</Panel>
      )}
      {editing && <PlanForm lookup={lookup} plan={editing === 'new' ? null : editing} defaultDate={newOn ?? (anchor < range.from || anchor > range.to ? range.from : anchor)}
        onClose={() => { setEditing(null); setNewOn(null) }} onSaved={() => { refresh(); setEditing(null); showSuccess(t('homework.lessons.saved')) }} />}
    </PageContainer>
  )
}
