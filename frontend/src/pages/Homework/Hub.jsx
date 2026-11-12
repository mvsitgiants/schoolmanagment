import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, BookOpen, Check, GraduationCap, Layers, LayoutPanelTop, Pencil, Plus, Save, Send } from 'lucide-react'
import { FormField, Note, PageContainer, PageHeader, Panel, Select, Skeleton, useConfirm, usePrompt } from '../../components/system'
import Button from '../../components/ui/Button'
import { TopicCard } from '../../components/homework/HubTopic'
import { UnitModal } from '../../components/homework/HubTools'
import HubReview, { publishDefaults } from '../../components/homework/HubReview'
import { fetchHomeworkLookup } from '../../api/homework'
import { addHubTopic, addHubUnit, deleteHubTopic, deleteHubUnit, ensureHubItem, fetchHub, orderHubTopics, publishHubUnit, saveHubTopic, saveHubUnit } from '../../api/teaching'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'

// Homework & lessons › Subject hub: one place where a teacher builds a class + subject, unit by unit.
//   1 Select details  class, subject, unit (a unit is added or renamed here, with its months)
//   2 Add content     the unit's topics: what students read (with sub-topics, files, photos of book pages, library
//                     material), the teacher's notes and the questions
//   3 Review & publish  the unit as a student sees it, a checklist, and publishing (now or later, all or chosen students)
// Deep link: /teaching/hub?classId=&subjectId=&unitId=. Student content is an LMS item per topic / sub-topic.

const STEPS = ['details', 'content', 'review']
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

function Stepper({ step, max, onGo }) {
  const { t } = useTranslation('hub')
  return (
    <ol className="flex items-center gap-2" aria-label={t('hub.steps.label')}>
      {STEPS.map((s, i) => {
        const n = i + 1
        const on = n === step
        return (
          <li key={s} className={clsx('flex min-w-0 items-center gap-2', i > 0 && 'flex-1')}>
            {i > 0 && <span className={clsx('h-px min-w-[12px] flex-1', n <= step ? 'bg-brand-400' : 'bg-border')} aria-hidden />}
            <button type="button" disabled={n > max} onClick={() => onGo(n)} aria-current={on ? 'step' : undefined} className="flex min-h-[44px] shrink-0 items-center gap-2 disabled:cursor-not-allowed">
              <span className={clsx('grid h-7 w-7 place-items-center rounded-full text-xs font-semibold', on ? 'bg-brand-600 text-white' : n < step ? 'bg-brand-100 text-brand-700' : 'bg-bg text-ink-muted ring-1 ring-border')}>
                {n < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
              </span>
              <span className={clsx('text-sm', on ? 'font-semibold text-ink' : 'hidden text-ink-muted md:inline')}>{t(`hub.steps.${s}`)}</span>
            </button>
          </li>
        )
      })}
    </ol>
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
  const [step, setStep] = useState(() => (classId && subjectId && (unitId || params.get('topicId')) ? 2 : 1))
  const [drafts, setDrafts] = useState({}) // topic id → the topic as being edited (unsaved)
  const [openId, setOpenId] = useState(() => params.get('topicId')) // a link from another screen opens its topic
  const [busy, setBusy] = useState('')
  const [unitDialog, setUnitDialog] = useState(null) // { unit } | { unit: null }
  const [options, setOptions] = useState(() => publishDefaults(null))
  const [errors, setErrors] = useState({})
  const [armed, setArmed] = useState(null)
  const dragId = useRef(null)
  const alias = useRef(new Map()) // a new sub-topic's saved id → its first key, so its editor stays put

  const place = { classId, subjectId }
  const hubKey = ['teaching-hub', classId, subjectId, unitId]
  const editable = hasPermission('homework.hub.edit')
  const { data: look, isLoading: lookLoading } = useQuery({ queryKey: ['homework-lookup'], queryFn: fetchHomeworkLookup, staleTime: 60_000 })
  const { data: hub, isLoading: hubLoading, error: hubError } = useQuery({ queryKey: hubKey, queryFn: () => fetchHub(classId, subjectId, unitId || undefined, (!unitId && params.get('topicId')) || undefined), enabled: !!(classId && subjectId) })
  const classes = look?.classes ?? []
  const cls = classes.find((c) => c.id === classId)
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

  const refresh = () => qc.invalidateQueries({ queryKey: ['teaching-hub', classId, subjectId] })
  const leaveOk = async () => !dirty || confirm({ title: t('hub.unsaved.title'), message: t('hub.unsaved.message'), confirmLabel: t('hub.unsaved.leave'), tone: 'danger' })
  const switchTo = async (patch) => {
    if (!await leaveOk()) return
    setDrafts({}); setOpenId(null)
    setPlace(patch)
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

  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return `${t(`hub.months.${m}`)} ${y}` }
  const max = hub?.unit ? 3 : 1
  const status = hub?.unit?.status

  return (
    <PageContainer>
      <PageHeader icon={LayoutPanelTop} title={t('hub.title')} subtitle={t('hub.subtitle')} />
      <div className="space-y-3 pb-40 lg:pb-0">
        <Panel><Stepper step={step} max={max} onGo={goto} /></Panel>

        {hubError && <Note tone="warning">{hubError.message}</Note>}
        {hub && !hub.lmsOn && <Note tone="warning">{t('hub.content.lmsOff')}</Note>}
        {hub && !ctx.editable && <Note tone="info">{t('hub.readOnly')}</Note>}

        {step === 1 && (lookLoading ? <Skeleton className="h-48" /> : !classes.length ? <Note tone="warning">{t('hub.pick.noClasses')}</Note> : (
          <Panel title={t('hub.pick.title')} subtitle={t('hub.pick.hint')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label={<span className="inline-flex items-center gap-1.5"><GraduationCap className="h-4 w-4 text-ink-faint" aria-hidden />{t('hub.pick.class')}</span>} required>
                <Select value={classId} onChange={(e) => { const c = classes.find((x) => x.id === e.target.value); switchTo({ classId: e.target.value, subjectId: c?.subjects.length === 1 ? c.subjects[0].id : '', unitId: '' }) }}>
                  <option value="">{t('hub.pick.pickClass')}</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
              <FormField label={<span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-ink-faint" aria-hidden />{t('hub.pick.subject')}</span>} required>
                <Select value={subjectId} disabled={!cls} onChange={(e) => switchTo({ subjectId: e.target.value, unitId: '' })}>
                  <option value="">{t('hub.pick.pickSubject')}</option>
                  {(cls?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              <FormField label={<span className="inline-flex items-center gap-1.5"><Layers className="h-4 w-4 text-ink-faint" aria-hidden />{t('hub.pick.unit')}</span>} required
                hint={hub && !hub.units.length ? t('hub.pick.noUnits') : undefined}>
                <Select value={unitId} disabled={!hub?.units.length} onChange={(e) => switchTo({ unitId: e.target.value })}>
                  {!hub?.units.length && <option value="">{t('hub.pick.pickUnit')}</option>}
                  {(hub?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FormField>
            </div>
            {classId && subjectId && (hubLoading ? <Skeleton className="mt-3 h-16" /> : hub && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {ctx.editable && hasPermission('homework.hub.create') && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setUnitDialog({ unit: null })}>{t('hub.unit.new')}</Button>}
                {ctx.editable && hub.unit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setUnitDialog({ unit: hub.units.find((u) => u.id === hub.unit.id) })}>{t('hub.unit.edit')}</Button>}
                {hub.unit && (
                  <span className="text-xs text-ink-muted sm:ms-auto">
                    {[t('hub.pick.topicCount', { count: hub.topics.length }), hub.unit.fromMonth && t('hub.pick.months', { from: monthName(hub.unit.fromMonth), to: monthName(hub.unit.toMonth ?? hub.unit.fromMonth) }), status && t(`hub.status.${status}`)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            ))}
          </Panel>
        ))}

        {step === 2 && hub?.unit && (
          <div className="space-y-3">
            {PUBLISHED.includes(status) && <Note tone="info">{t('hub.livePublished')}</Note>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-ink">{t('hub.topics.title')}</h2>
                <p className="truncate text-xs text-ink-muted">{[hub.className, hub.subject, hub.unit.name].join(' · ')}</p>
              </div>
              {ctx.editable && hasPermission('homework.hub.create') && <Button size="sm" icon={Plus} loading={busy === 'add'} onClick={addTopic}>{t('hub.topics.add')}</Button>}
            </div>
            {!hub.topics.length ? (
              <Panel><p className="py-6 text-center text-sm text-ink-muted">{t('hub.topics.none')}</p></Panel>
            ) : (
              <ol className="space-y-2">
                {hub.topics.map((tp, i) => (
                  <TopicCard key={tp.id} n={i + 1} topic={tp} form={formFor(tp)} onForm={onForm(tp)} dirty={!!drafts[tp.id]} ctx={ctx}
                    open={openId === tp.id} onToggle={() => setOpenId((o) => (o === tp.id ? null : tp.id))}
                    onRename={rename(tp)} onDelete={removeTopic(tp)} onMove={(dir) => move(i, dir)} canUp={i > 0} canDown={i < hub.topics.length - 1}
                    onSave={() => run(`save-${tp.id}`, async () => { await saveOne(tp.id); showSuccess(t('hub.topic.saved')); return true })} saving={busy === `save-${tp.id}`}
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

        {step === 3 && hub?.unit && <HubReview hub={hub} options={options} onOptions={setOptions} errors={errors} />}
      </div>

      <div className="action-bar flex items-center gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur lg:mt-4 lg:rounded-xl lg:border lg:!px-3">
        {step > 1 && <Button variant="ghost" icon={ArrowLeft} onClick={() => goto(step - 1)} aria-label={t('hub.back')}><span className="hidden sm:inline">{t('hub.back')}</span></Button>}
        {ctx.editable && hub?.unit && (
          <Button variant="secondary" icon={Save} loading={busy === 'draft'} onClick={saveDraft}>{t('hub.draft.button')}</Button>
        )}
        <span className="flex-1" />
        {step < 3 ? (
          <Button iconRight={ArrowRight} disabled={!hub?.unit} loading={busy === 'save'} onClick={() => goto(step + 1)}>
            <span className="sm:hidden">{t('hub.next')}</span><span className="hidden sm:inline">{step === 1 ? t('hub.nextContent') : t('hub.nextReview')}</span>
          </Button>
        ) : ctx.editable && hub?.lmsOn && (
          <Button icon={Send} loading={busy === 'publish'} onClick={publish}>{options.when === 'LATER' ? t('hub.publish.schedule') : t('hub.publish.button')}</Button>
        )}
      </div>

      {unitDialog && hub && <UnitModal unit={unitDialog.unit} months={hub.months} saving={busy === 'unit'} onSave={saveUnit} onDelete={hasPermission('homework.hub.delete') ? removeUnit : undefined} onClose={() => setUnitDialog(null)} />}
    </PageContainer>
  )
}
