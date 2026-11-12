import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, Check, ChevronRight, LayoutPanelTop, ListTree, Pencil, Plus, Save, Send, UserRound } from 'lucide-react'
import { Note, PageContainer, PageHeader, Panel, Skeleton, StatusPill, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { TopicCard } from '../../components/homework/HubTopic'
import HubTree, { ContentDot } from '../../components/homework/HubTree'
import TopicPanel from '../../components/homework/TopicPanel'
import HubSubjectView from '../../components/homework/HubSubjectView'
import { AddClassModal, AddSubjectModal, TeacherModal } from '../../components/homework/HubSetup'
import { fetchSyllabus } from '../../api/homework'
import { UnitModal } from '../../components/homework/HubTools'
import HubReview, { publishDefaults } from '../../components/homework/HubReview'
import { addHubTopic, addHubUnit, deleteHubTopic, deleteHubUnit, ensureHubItem, fetchHub, fetchHubOutline, orderHubTopics, publishHubUnit, saveHubTopic, saveHubUnit } from '../../api/teaching'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// Homework & lessons › Subject hub: one place where a teacher builds a class + subject, unit by unit.
//   (left)            the outline: class → subject → unit → topic, with what each topic holds (components/homework/HubTree)
//   1 Select details  the chosen subject's units (a unit is added or renamed here, with its months); on phones, the outline
//   2 Add content     the unit's topics: what students read (with sub-topics, files, photos of book pages, library
//                     material), the teacher's notes and the questions
//   3 Review & publish  the unit as a student sees it, a checklist, and publishing (now or later, all or chosen students)
// Deep link: /teaching/hub?classId=&subjectId=&unitId=. Student content is an LMS item per topic / sub-topic.

const PUBLISHED = ['PUBLISHED', 'SCHEDULED', 'MIXED']

const formOf = (tp, alias) => ({
  contentHtml: tp.content?.html ?? '',
  subOn: tp.subTopics.length > 0,
  subTopics: tp.subTopics.map((s) => ({ key: alias.get(s.id) ?? s.id, id: s.id, name: s.name, contentHtml: s.content?.html ?? '' })),
  book: { ...tp.book }, periods: tp.periods, howTo: tp.howTo, keyPoints: [...tp.keyPoints], homeworkHint: tp.homeworkHint,
  questions: tp.questions.map((q) => ({ ...q, options: q.options.length ? [...q.options] : ['', ''] })),
})

const bodyOf = (f, place) => ({
  ...place, contentHtml: f.contentHtml, periods: f.periods ?? null, book: f.book, howTo: f.howTo, homeworkHint: f.homeworkHint,
  keyPoints: f.keyPoints.map((k) => k.trim()).filter(Boolean),
  questions: f.questions.filter((q) => q.question.trim()).map((q) => ({ id: q.id, question: q.question, answer: q.answer, kind: q.kind, use: q.use, options: q.kind === 'MCQ' ? q.options.filter((o) => o.trim()) : undefined })),
  subTopics: f.subOn ? f.subTopics.filter((s) => s.name.trim()).map((s) => ({ id: s.id, name: s.name, contentHtml: s.contentHtml })) : [],
})

/** Where you are: Class › Subject › Unit (› Review & publish); earlier parts take you back there. */
function Path({ items }) {
  const { t } = useTranslation('hub')
  return (
    <nav aria-label={t('hub.path.label')}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {items.map((x, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden />}
            {x.onClick
              ? <button type="button" onClick={x.onClick} className="min-h-[32px] truncate rounded px-1 text-ink-muted hover:bg-black/[0.04] hover:text-ink [@media(pointer:coarse)]:min-h-[44px]">{x.label}</button>
              : <span aria-current={i === items.length - 1 ? 'page' : undefined} className={clsx('truncate px-1', i === items.length - 1 ? 'font-semibold text-ink' : 'text-ink-muted')}>{x.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export default function Hub() {
  const { t } = useTranslation('hub')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { dateTime } = useFormat()
  const { showError, showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const classId = params.get('classId') ?? ''
  const subjectId = params.get('subjectId') ?? ''
  const unitId = params.get('unitId') ?? ''
  // Edit off (the default): a clean, read-only view of the subject; on: every add / change button and the step editor.
  // A link at a topic ("Edit in Teaching hub") or ?edit=1 opens with it on.
  const [editMode, setEditMode] = useState(() => !!params.get('topicId') || params.get('edit') === '1')
  const [focus, setFocus] = useState(null) // read-only: the unit / topic picked in the tree ({ unitId, topicId, n })
  const [step, setStep] = useState(() => (classId && subjectId && params.get('topicId') ? 2 : 1))
  const [drafts, setDrafts] = useState({}) // topic id → the topic as being edited (unsaved)
  const [openId, setOpenId] = useState(() => params.get('topicId')) // a link from another screen opens its topic
  const [busy, setBusy] = useState('')
  const [editingIds, setEditingIds] = useState(() => new Set()) // topics opened for editing (others show as they are)
  const [setup, setSetup] = useState(null) // { kind: 'class' } | { kind: 'subject', classId, className } | { kind: 'teacher', section }
  const [unitDialog, setUnitDialog] = useState(null) // { unit } | { unit: null }
  const [options, setOptions] = useState(() => publishDefaults(null))
  const [errors, setErrors] = useState({})
  const [armed, setArmed] = useState(null)
  const dragId = useRef(null)
  const alias = useRef(new Map()) // a new sub-topic's saved id → its first key, so its editor stays put

  const place = { classId, subjectId }
  const hubKey = ['teaching-hub', classId, subjectId, unitId]
  const editable = hasPermission('homework.hub.edit')
  const { data: outline, isLoading: outlineLoading } = useQuery({ queryKey: ['teaching-hub-outline'], queryFn: fetchHubOutline, staleTime: 30_000 })
  // each class's record of the subject (taught, revision, extra classes, teachers) and the lookup for planning lessons
  const { data: syllabus } = useQuery({ queryKey: ['syllabus', classId, subjectId], queryFn: () => fetchSyllabus(classId, subjectId), enabled: !!(classId && subjectId) })
  const { data: hub, isLoading: hubLoading, error: hubError } = useQuery({ queryKey: hubKey, queryFn: () => fetchHub(classId, subjectId, unitId || undefined, (!unitId && params.get('topicId')) || undefined), enabled: !!(classId && subjectId) })
  const dirtyIds = Object.keys(drafts)
  const dirty = dirtyIds.length > 0
  const ctx = { classId, subjectId, lmsOn: !!hub?.lmsOn, editable: editable && !!hub?.canEdit }

  const setPlace = (patch) => setParams((p) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    return n
  }, { replace: true })

  // the unit the server settled on (the first one when none was named, or the named one was removed)
  useEffect(() => {
    if (hub && (hub.unit?.id ?? '') !== unitId) setPlace({ unitId: hub.unit?.id ?? '' })
  }, [hub]) // eslint-disable-line react-hooks/exhaustive-deps
  // opened from a link at a topic: bring it into view once its unit has loaded
  const linkedTopic = useRef(params.get('topicId'))
  useEffect(() => {
    const want = linkedTopic.current
    if (!want || !hub?.topics?.some((x) => x.id === want)) return
    linkedTopic.current = null
    requestAnimationFrame(() => document.getElementById(`hub-topic-${want}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [hub])
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const refresh = () => { qc.invalidateQueries({ queryKey: ['teaching-hub-outline'] }); qc.invalidateQueries({ queryKey: ['syllabus', classId, subjectId] }); return qc.invalidateQueries({ queryKey: ['teaching-hub', classId, subjectId] }) }
  const leaveOk = async () => !dirty || confirm({ title: t('hub.unsaved.title'), message: t('hub.unsaved.message'), confirmLabel: t('hub.unsaved.leave'), tone: 'danger' })

  /** From the outline: a subject (step 1, its units), a unit or a topic (step 2, the topic open and in view). */
  const pick = async ({ classId: c, subjectId: sb, unitId: u, topicId: tp }) => {
    if (!editMode) {
      if (c !== classId || sb !== subjectId) setPlace({ classId: c, subjectId: sb, unitId: '', topicId: '' })
      setStep(1)
      setFocus(u || tp ? { unitId: u, topicId: tp, n: Date.now() } : null)
      if (!u && !tp) window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const sameUnit = c === classId && sb === subjectId && !!u && u === unitId
    if (!sameUnit) {
      if (!await leaveOk()) return
      setDrafts({})
      setEditingIds(new Set())
      setPlace({ classId: c, subjectId: sb, unitId: u ?? '', topicId: '' })
    }
    setOpenId(tp ?? null)
    if (tp) { linkedTopic.current = tp; if (sameUnit) requestAnimationFrame(() => document.getElementById(`hub-topic-${tp}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
    setStep(u ? 2 : 1)
    if (!tp) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // a topic with nothing in it opens straight into editing; others show as they are until "Edit"
  const isEmpty = (tp) => !tp.content?.html && !tp.content?.files?.length && !tp.subTopics.length && !tp.questions.length && !tp.howTo && !tp.keyPoints.length && !tp.teacherFiles?.length
  const isEditing = (tp) => ctx.editable && (editingIds.has(tp.id) || !!drafts[tp.id] || isEmpty(tp))
  const setEditing = (id, on) => setEditingIds((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n })
  const cancelEdit = (tp) => async () => {
    if (drafts[tp.id] && !await confirm({ title: t('hub.view.discardTitle'), message: t('hub.view.discardMessage'), confirmLabel: t('hub.view.discard'), tone: 'danger' })) return
    setDrafts((d) => { const n = { ...d }; delete n[tp.id]; return n })
    setEditing(tp.id, false)
  }
  const afterSetup = async (pickNext) => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['teaching-hub-outline'] }), qc.invalidateQueries({ queryKey: ['homework-lookup'] }), qc.invalidateQueries({ queryKey: ['syllabus'] })])
    if (pickNext) pick(pickNext)
  }

  const formFor = (tp) => drafts[tp.id] ?? formOf(tp, alias.current)
  const onForm = (tp) => (patch) => setDrafts((d) => {
    const cur = d[tp.id] ?? formOf(tp, alias.current)
    if (Object.entries(patch).every(([k, v]) => cur[k] === v)) return d // e.g. the editor reporting on blur with nothing changed
    return { ...d, [tp.id]: { ...cur, ...patch } }
  })

  /** Save one topic; keep new sub-topics' keys so their editors stay where they are. */
  const saveOne = async (topicId) => {
    const form = drafts[topicId]
    if (!form) return
    await saveHubTopic(topicId, bodyOf(form, place))
    const named = form.subOn ? form.subTopics.filter((s) => s.name.trim()) : []
    await refresh()
    const fresh = qc.getQueryData(hubKey)?.topics.find((x) => x.id === topicId)
    named.forEach((s, i) => { const id = fresh?.subTopics[i]?.id; if (id && !s.id) alias.current.set(id, s.key) })
    setDrafts((d) => { const n = { ...d }; delete n[topicId]; return n })
  }
  const saveAll = async () => {
    let failed = null
    for (const id of dirtyIds) {
      try { await saveOne(id) } catch (e) { failed = e }
    }
    if (failed) throw failed
  }
  const run = async (what, fn) => {
    setBusy(what)
    try { return await fn() } catch (e) { showError(e.message); return undefined } finally { setBusy('') }
  }

  const getItemId = (tp) => async (subKey, copyFrom) => {
    const body = { ...place, ...(copyFrom && { copyFrom }) }
    if (subKey) {
      const form = formFor(tp)
      const named = form.subTopics.filter((s) => s.name.trim())
      const sub = named.find((s) => s.key === subKey)
      let subId = sub?.id
      if (!subId) { // a new sub-topic: save the topic first so it has an id
        const at = named.indexOf(sub)
        await saveOne(tp.id)
        subId = qc.getQueryData(hubKey)?.topics.find((x) => x.id === tp.id)?.subTopics[at]?.id
        if (!subId) throw new Error(t('hub.sub.nameFirst'))
      }
      body.subTopicId = subId
    }
    return (await ensureHubItem(tp.id, body)).id
  }

  const addTopic = async () => {
    const name = String(await prompt({ title: t('hub.topic.addTitle'), label: t('hub.topic.name'), required: true }) ?? '').trim()
    if (!name) return
    const r = await run('add', () => addHubTopic({ ...place, unitId, name }))
    if (r) { await refresh(); setOpenId(r.id) }
  }
  const rename = (tp) => async (name) => {
    if (await run('rename', () => saveHubTopic(tp.id, { ...place, name }))) refresh()
  }
  const removeTopic = (tp) => async () => {
    if (tp.taughtIn > 0) { showError(t('hub.topic.inUse', { count: tp.taughtIn })); return }
    if (!await confirm({ title: t('hub.topic.deleteTitle'), message: t('hub.topic.deleteMessage', { name: tp.name }), confirmLabel: t('hub.topic.deleteConfirm'), tone: 'danger' })) return
    if (await run('delete', () => deleteHubTopic(tp.id, classId, subjectId))) {
      setDrafts((d) => { const n = { ...d }; delete n[tp.id]; return n })
      refresh()
      showSuccess(t('hub.topic.deleted'))
    }
  }
  const reorder = async (ids) => {
    qc.setQueryData(hubKey, (d) => d && { ...d, topics: ids.map((id) => d.topics.find((x) => x.id === id)) })
    if (!await run('order', () => orderHubTopics(unitId, { ...place, topicIds: ids }))) refresh()
  }
  const move = (i, dir) => {
    const ids = hub.topics.map((x) => x.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder(ids)
  }
  const dropOn = (targetId) => {
    const from = dragId.current
    dragId.current = null
    setArmed(null)
    if (!from || from === targetId) return
    const ids = hub.topics.map((x) => x.id).filter((id) => id !== from)
    ids.splice(ids.indexOf(targetId) + (hub.topics.findIndex((x) => x.id === from) < hub.topics.findIndex((x) => x.id === targetId) ? 1 : 0), 0, from)
    reorder(ids)
  }

  const saveUnit = async (f) => {
    const unit = unitDialog?.unit
    setBusy('unit')
    try {
      const r = unit ? await saveHubUnit(unit.id, { ...place, ...f }) : await addHubUnit({ ...place, ...f })
      setUnitDialog(null)
      showSuccess(unit ? t('hub.unit.saved') : t('hub.unit.added'))
      if (!unit) { setDrafts({}); setOpenId(null); setPlace({ unitId: r.id }) }
      refresh()
    } catch (e) {
      showError(e.message)
      throw e
    } finally { setBusy('') }
  }
  const removeUnit = async () => {
    const unit = unitDialog?.unit
    if (!unit || !await confirm({ title: t('hub.unit.deleteTitle'), message: t('hub.unit.deleteMessage', { name: unit.name, count: unit.topics }), confirmLabel: t('hub.unit.deleteConfirm'), tone: 'danger' })) return
    if (await run('unit', () => deleteHubUnit(unit.id, classId, subjectId))) {
      setUnitDialog(null); setDrafts({}); setOpenId(null)
      setPlace({ unitId: '' })
      refresh()
      showSuccess(t('hub.unit.deleted'))
    }
  }

  const goto = async (n) => {
    if (n === step) return
    if (n === 3) {
      if (dirty && !await run('save', async () => { await saveAll(); return true })) return
      setOptions(publishDefaults(qc.getQueryData(hubKey)?.unit ?? hub?.unit))
      setErrors({})
    }
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const saveDraft = async () => {
    if (step === 3 && PUBLISHED.includes(hub?.unit?.status)) {
      if (!await confirm({ title: t('hub.draft.title'), message: t('hub.draft.message'), confirmLabel: t('hub.draft.confirm'), tone: 'danger' })) return
      if (await run('draft', () => publishHubUnit(unitId, { ...place, publish: false }))) { refresh(); showSuccess(t('hub.draft.done')) }
      return
    }
    if (!dirty) { showSuccess(t('hub.draft.nothing')); return }
    await run('draft', async () => { await saveAll(); showSuccess(t('hub.draft.saved')); return true })
  }
  const publish = async () => {
    setErrors({})
    setBusy('publish')
    try {
      const body = { ...place, publish: true, when: options.when, visibility: options.visibility, studentIds: options.visibility === 'STUDENTS' ? options.studentIds : [], ...(options.when === 'LATER' && { publishDate: options.publishDate, publishTime: options.publishTime }) }
      const r = await publishHubUnit(unitId, body)
      await refresh()
      const at = qc.getQueryData(hubKey)?.unit?.publishAt
      showSuccess(options.when === 'LATER' && at ? t('hub.publish.scheduled', { count: r.published, when: dateTime(at) }) : t('hub.publish.done', { count: r.published }))
    } catch (e) {
      setErrors(e.response?.data?.details?.fields ?? {})
      showError(e.message)
    } finally { setBusy('') }
  }

  // the step's own buttons, in its header row next to its other buttons (no floating bar)
  const backButton = step > 1 && <Button variant="ghost" icon={ArrowLeft} onClick={() => goto(step - 1)}>{t('hub.back')}</Button>
  const draftButton = ctx.editable && hub?.unit && <Button variant="secondary" icon={Save} loading={busy === 'draft'} onClick={saveDraft}>{t('hub.draft.button')}</Button>
  const nextButton = step < 3
    ? <Button iconRight={ArrowRight} disabled={!hub?.unit} loading={busy === 'save'} onClick={() => goto(step + 1)}>{step === 1 ? t('hub.nextContent') : t('hub.nextReview')}</Button>
    : ctx.editable && hub?.lmsOn && <Button icon={Send} loading={busy === 'publish'} onClick={publish}>{options.when === 'LATER' ? t('hub.publish.schedule') : t('hub.publish.button')}</Button>

  // the shared topic panel's inputs: what students see, and each class's record of the topic
  const canMark = hasPermission('homework.syllabus.edit') || hasPermission('homework.lesson-plans.edit')
  const partsOfHub = (tp) => [{ id: 'topic', name: null, html: tp.content?.html, files: tp.content?.files ?? [] }, ...tp.subTopics.map((x) => ({ id: x.id, name: x.name, html: x.content?.html, files: x.content?.files ?? [] }))]
  const classesOf = (tp) => (syllabus?.sections ?? []).map((sec) => ({ id: sec.id, label: sec.label, teachers: sec.teachers ?? [], row: sec.topicPlan?.[tp.id] ?? {}, tickDate: sec.ticks?.[tp.id]?.date }))
  // how far a topic is taught across the classes: every class taught, some (or partly), behind its planned dates, or not yet
  const teachingOf = (tp) => {
    const secs = syllabus?.sections ?? []
    if (!secs.length) return null
    const rows = secs.map((x) => x.topicPlan?.[tp.id] ?? {})
    const taught = rows.filter((r) => r.status === 'TAUGHT').length
    const partly = rows.filter((r) => r.status === 'PARTLY').length
    const behind = rows.some((r) => r.status !== 'TAUGHT' && r.end && r.end < syllabus.today)
    const [tone, label] = taught === secs.length ? ['success', t('hub.teach.taught')]
      : behind ? ['danger', taught || partly ? t('hub.teach.partlyBehind') : t('hub.teach.behind')]
        : taught || partly ? ['warning', secs.length > 1 ? t('hub.teach.taughtSome', { done: taught, all: secs.length }) : t('hub.teach.partly')]
          : ['neutral', t('hub.teach.notStarted')]
    return <StatusPill tone={tone}>{label}</StatusPill>
  }
  const canEditHub = hasPermission('homework.hub.edit') || hasPermission('homework.hub.create') || hasPermission('academics.classes.create')
  const toggleEdit = async () => {
    if (!editMode) { setEditMode(true); return }
    if (!await leaveOk()) return
    setDrafts({}); setEditingIds(new Set()); setOpenId(null); setStep(1); setEditMode(false)
    setPlace({ topicId: '', edit: '' })
  }
  const canAddClass = hasPermission('academics.classes.create')
  const canAddSubject = hasPermission('academics.classes.edit')
  const selected = editMode
    ? { classId, subjectId, unitId: step === 1 ? '' : unitId, topicId: step === 2 ? openId : null }
    : { classId, subjectId, unitId: focus?.unitId ?? '', topicId: focus?.topicId ?? null }
  const subjectOutline = outline?.classes.find((c) => c.id === classId)?.subjects.find((x) => x.id === subjectId)
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return `${t(`hub.months.${m}`)} ${y}` }
  const status = hub?.unit?.status

  return (
    <PageContainer>
      <PageHeader icon={LayoutPanelTop} title={t('hub.title')} subtitle={t('hub.subtitle')}
        actions={canEditHub && (editMode
          ? <Button icon={Check} onClick={toggleEdit}>{t('hub.mode.done')}</Button>
          : <Button variant="secondary" icon={Pencil} onClick={toggleEdit}>{t('hub.mode.edit')}</Button>)} />
      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-4">
      <aside className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-card lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col">
        <HubTree outline={outline} loading={outlineLoading} selected={selected} onPick={pick} onAddClass={editMode && canAddClass ? () => setSetup({ kind: 'class' }) : undefined} onAddSubject={editMode && canAddSubject ? (c) => setSetup({ kind: 'subject', classId: c.id, className: c.name }) : undefined} className="flex-1" />
      </aside>
      <div className="min-w-0">
      <div className="space-y-3">
        {classId && subjectId && (
          <Path items={[
            { label: hub?.className ?? outline?.classes.find((c) => c.id === classId)?.name ?? '' },
            { label: hub?.subject ?? subjectOutline?.name ?? '', onClick: step > 1 ? () => pick({ classId, subjectId }) : undefined },
            ...(step > 1 && hub?.unit ? [{ label: hub.unit.name, onClick: step > 2 ? () => goto(2) : undefined }] : []),
            ...(step > 2 ? [{ label: t('hub.steps.review') }] : []),
          ].filter((x) => x.label)} />
        )}

        {hubError && <Note tone="warning">{hubError.message}</Note>}
        {hub && !hub.lmsOn && <Note tone="warning">{t('hub.content.lmsOff')}</Note>}
        {hub && !ctx.editable && <Note tone="info">{t('hub.readOnly')}</Note>}

        {step === 1 && (
          <>
            {/* phones and tablets: the outline is the way in */}
            <Panel className="lg:hidden overflow-hidden" flush>
              <HubTree outline={outline} loading={outlineLoading} selected={selected} onPick={pick} onAddClass={editMode && canAddClass ? () => setSetup({ kind: 'class' }) : undefined} onAddSubject={editMode && canAddSubject ? (c) => setSetup({ kind: 'subject', classId: c.id, className: c.name }) : undefined} className="max-h-[70vh]" />
            </Panel>
            {!(classId && subjectId) ? (
              <Panel className="hidden lg:block">
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <ListTree className="h-8 w-8 text-ink-faint" aria-hidden />
                  <p className="text-sm font-medium text-ink">{t('hub.pick.title')}</p>
                  <p className="max-w-sm text-sm text-ink-muted">{t('hub.pick.hintTree')}</p>
                </div>
              </Panel>
            ) : hubLoading ? <Skeleton className="h-48" /> : hub && (
              <Panel title={[hub.className, hub.subject].join(' · ')} subtitle={editMode ? t('hub.subject.hint') : t('hub.subject.hintView')}
                actions={editMode && <div className="flex flex-wrap justify-end gap-2">{ctx.editable && hasPermission('homework.hub.create') && <Button variant="secondary" icon={Plus} onClick={() => setUnitDialog({ unit: null })}>{t('hub.unit.new')}</Button>}{nextButton}</div>}>
                {!hub.units.length ? <p className="py-6 text-center text-sm text-ink-muted">{t('hub.pick.noUnits')}</p> : (
                  <HubSubjectView units={hub.units} outlineUnits={subjectOutline?.units} subjectId={subjectId} today={syllabus?.today} classesOf={classesOf}
                    canMark={canMark} canEdit={ctx.editable} editMode={editMode} focus={focus} monthName={monthName}
                    onOpenUnit={(u) => pick({ classId, subjectId, unitId: u.id })} onEditUnit={(u) => setUnitDialog({ unit: u })}
                    onEditTopic={async (u, x) => { await pick({ classId, subjectId, unitId: u.id, topicId: x.id }); setEditing(x.id, true) }}
                    onChanged={() => { qc.invalidateQueries({ queryKey: ['syllabus', classId, subjectId] }); qc.invalidateQueries({ queryKey: ['teaching-hub-outline'] }) }} />
                )}
              </Panel>
            )}
            {classId && subjectId && syllabus?.sections?.length > 0 && (
              <Panel title={t('hub.classes.title')} subtitle={t('hub.classes.hint')}>
                <ul className="divide-y divide-border">
                  {syllabus.sections.map((sec) => {
                    const names = (sec.teachers ?? []).map((x) => x.name).filter(Boolean).join(', ')
                    return (
                      <li key={sec.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{sec.label}</span>
                          <span className="flex items-center gap-1 truncate text-xs text-ink-muted"><UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />{names || t('hub.view.noTeacher')}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-muted">{t('hub.classes.taught', { done: sec.done, all: sec.topics })}</span>
                        {sec.behind > 0 && <span className="shrink-0 text-xs font-medium text-amber-700">{t('hub.classes.behind', { count: sec.behind })}</span>}
                        {editMode && hasPermission('academics.allocation.edit') && (
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setSetup({ kind: 'teacher', section: sec })}>{names ? t('hub.classes.changeTeacher') : t('hub.classes.setTeacher')}</Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            )}
          </>
        )}

        {editMode && step === 2 && hub?.unit && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-ink">{t('hub.topics.title')}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {draftButton}
                {ctx.editable && hasPermission('homework.hub.create') && <Button variant="secondary" icon={Plus} loading={busy === 'add'} onClick={addTopic}>{t('hub.topics.add')}</Button>}
                {nextButton}
              </div>
            </div>
            {!hub.topics.length ? (
              <Panel><p className="py-6 text-center text-sm text-ink-muted">{t('hub.topics.none')}</p></Panel>
            ) : (
              <ol className="space-y-2">
                {hub.topics.map((tp, i) => (
                  <TopicCard key={tp.id} n={i + 1} topic={tp} form={formFor(tp)} onForm={onForm(tp)} dirty={!!drafts[tp.id]} ctx={ctx}
                    open={openId === tp.id} onToggle={() => setOpenId((o) => (o === tp.id ? null : tp.id))}
                    onRename={rename(tp)} onDelete={removeTopic(tp)} onMove={(dir) => move(i, dir)} canUp={i > 0} canDown={i < hub.topics.length - 1}
                    onSave={() => run(`save-${tp.id}`, async () => { await saveOne(tp.id); setEditing(tp.id, false); showSuccess(t('hub.topic.saved')); return true })} saving={busy === `save-${tp.id}`}
                    live={PUBLISHED.includes(status)} teaching={teachingOf(tp)} editing={isEditing(tp)} onEdit={() => setEditing(tp.id, true)} onCancel={isEmpty(tp) ? undefined : cancelEdit(tp)}
                    view={<TopicPanel topic={tp} parts={partsOfHub(tp)} classes={classesOf(tp)} subjectId={subjectId} today={syllabus?.today} canMark={canMark} canEdit={ctx.editable} onEdit={() => setEditing(tp.id, true)} onChanged={() => qc.invalidateQueries({ queryKey: ['syllabus', classId, subjectId] })} />}
                    getItemId={getItemId(tp)} onFilesChanged={refresh}
                    handleProps={{ onMouseDown: () => setArmed(tp.id), onMouseUp: () => setArmed(null) }}
                    dragProps={{
                      draggable: armed === tp.id,
                      onDragStart: (e) => { dragId.current = tp.id; e.dataTransfer.effectAllowed = 'move' },
                      onDragOver: (e) => { if (dragId.current) e.preventDefault() },
                      onDrop: (e) => { e.preventDefault(); dropOn(tp.id) },
                      onDragEnd: () => { dragId.current = null; setArmed(null) },
                    }} />
                ))}
              </ol>
            )}
          </div>
        )}

        {editMode && step === 3 && hub?.unit && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-ink">{t('hub.steps.review')}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">{backButton}{draftButton}{nextButton}</div>
            </div>
            <HubReview hub={hub} options={options} onOptions={setOptions} errors={errors} />
          </div>
        )}
      </div>

      </div>
      </div>

      {setup?.kind === 'class' && <AddClassModal onClose={() => setSetup(null)} onSaved={(cls) => { showSuccess(t('hub.setup.classAdded', { name: cls.name })); afterSetup(cls.subjectIds?.length ? { classId: cls.id, subjectId: String(cls.subjectIds[0]) } : null) }} />}
      {setup?.kind === 'subject' && <AddSubjectModal classId={setup.classId} className={setup.className} onClose={() => setSetup(null)} onSaved={(ids) => { showSuccess(t('hub.setup.subjectAdded')); afterSetup(ids[0] ? { classId: setup.classId, subjectId: ids[0] } : null) }} />}
      {setup?.kind === 'teacher' && hub && <TeacherModal section={setup.section} subjectId={subjectId} subject={hub.subject} onClose={() => setSetup(null)} onSaved={() => { showSuccess(t('hub.setup.teacherSaved')); afterSetup() }} />}
      {unitDialog && hub && <UnitModal unit={unitDialog.unit} months={hub.months} saving={busy === 'unit'} onSave={saveUnit} onDelete={hasPermission('homework.hub.delete') ? removeUnit : undefined} onClose={() => setUnitDialog(null)} />}
    </PageContainer>
  )
}
