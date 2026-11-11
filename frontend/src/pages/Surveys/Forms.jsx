import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  BarChart3, BellRing, ClipboardList, EyeOff, FilePen, Link2, Lock, MessageSquareHeart, PenLine, Plus, Rocket, Trash2, Unlock, Users,
} from 'lucide-react'
import { SURVEY_AUDIENCES } from '@schoolgiant/shared'
import {
  DateInput, ColorChip, Drawer, EmptyState, FormField, Input, Modal, Note, PageContainer, PageHeader, Panel, Select, SideNav, SideNavLayout, StatCardRow, Textarea, useConfirm,
} from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import FormRenderer from '../../components/forms/FormRenderer'
import { AudienceChip, RateBar, StatePill, SurveyFill, useSurveyLabels } from '../../components/surveys/SurveyKit'
import {
  answerMySurvey, closeSurvey, deleteSurvey, fetchMySurvey, fetchMySurveys, fetchQuestionnaires, fetchSurveys, publishSurvey, remindSurvey, saveSurvey,
} from '../../api/surveys'
import { fetchAcademicLookup } from '../../api/academics'
import { hasPermission } from '../../api/auth'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

const fieldsOf = (e) => e?.response?.data?.details?.fields ?? {}
const EMPTY = { title: '', intro: '', formId: '', audience: 'PARENTS', classIds: [], sectionIds: [], anonymous: false, opensOn: '', closesOn: '' }
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

function Chip({ on, onClick, children }) {
  return <button type="button" onClick={onClick} className={clsx('rounded-full border px-2.5 py-1 text-xs transition', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-ink-muted hover:border-ink-faint hover:text-ink')}>{children}</button>
}

/** New survey, or a change to one. Once sent, only the title, the note and the closing day can change. */
function SurveyEditor({ survey, open, onClose }) {
  const { t } = useTranslation('surveys')
  const L = useSurveyLabels()
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [preview, setPreview] = useState(false)
  const locked = !!survey?.publishedAt
  useEffect(() => {
    if (!open) return
    setErrors({})
    setPreview(false)
    setF(survey ? { title: survey.title, intro: survey.intro ?? '', formId: survey.formId, audience: survey.audience, classIds: survey.classIds, sectionIds: survey.sectionIds, anonymous: survey.anonymous, opensOn: survey.opensOn ?? '', closesOn: survey.closesOn ?? '' } : EMPTY)
  }, [open, survey])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const { data: forms = [] } = useQuery({ queryKey: ['surveys', 'questionnaires'], queryFn: fetchQuestionnaires, enabled: open })
  const { data: lookup } = useQuery({ queryKey: ['academics', 'lookup'], queryFn: fetchAcademicLookup, staleTime: 300_000, enabled: open })
  const form = forms.find((x) => x.formId === f.formId)
  const save = useMutation({
    mutationFn: () => saveSurvey(survey?.id, locked ? { title: f.title, intro: f.intro, closesOn: f.closesOn } : f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surveys'] }); showSuccess(t('surveys.editor.saved')); onClose() },
    onError: (e) => { setErrors(fieldsOf(e)); showError(e.message) },
  })
  const byClass = f.audience === 'PARENTS' || f.audience === 'STUDENTS'
  return (
    <Drawer open={open} onClose={onClose} size="xl" title={survey ? t('surveys.editor.editTitle') : t('surveys.editor.newTitle')} subtitle={t('surveys.editor.subtitle')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('surveys.common.cancel')}</Button><Button icon={FilePen} loading={save.isPending} disabled={f.title.trim().length < 3 || !f.formId} onClick={() => save.mutate()}>{t('surveys.editor.save')}</Button></>}>
      <div className="space-y-4">
        {locked && <Note tone="info">{t('surveys.editor.lockedHint')}</Note>}
        <FormField label={t('surveys.editor.title')} required error={errors.title}><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={t('surveys.editor.titlePlaceholder')} /></FormField>
        <FormField label={t('surveys.editor.intro')} hint={t('surveys.editor.introHint')}><Textarea rows={2} value={f.intro} onChange={(e) => set('intro', e.target.value)} /></FormField>
        <FormField label={t('surveys.editor.questionnaire')} required error={errors.formId} hint={t('surveys.editor.questionnaireHint')}>
          <Select value={f.formId} disabled={locked} onChange={(e) => { const pick = forms.find((x) => x.formId === e.target.value); setF((x) => ({ ...x, formId: e.target.value, title: x.title || pick?.name || '' })) }}>
            <option value="">{t('surveys.editor.pickQuestionnaire')}</option>
            {forms.map((x) => <option key={x.formId} value={x.formId}>{x.name} · {t('surveys.editor.questions', { count: x.questions })}</option>)}
          </Select>
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          {form && <Button size="sm" variant="secondary" icon={ClipboardList} onClick={() => setPreview((v) => !v)}>{preview ? t('surveys.editor.hidePreview') : t('surveys.editor.preview')}</Button>}
          {hasPermission('core.forms.create') && <Link to="/core/forms" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><PenLine className="h-4 w-4" />{t('surveys.editor.designNew')}</Link>}
        </div>
        {preview && form && <div className="rounded-xl border border-border bg-bg p-4"><FormRenderer definition={form.definition} readOnly /></div>}
        <FormField label={t('surveys.editor.audience')} required>
          <div className="grid gap-2 sm:grid-cols-2">
            {SURVEY_AUDIENCES.map((a) => (
              <button key={a.value} type="button" disabled={locked} onClick={() => set('audience', a.value)}
                className={clsx('rounded-xl border p-3 text-start transition disabled:cursor-default', f.audience === a.value ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300' : 'border-border hover:border-ink-faint', locked && f.audience !== a.value && 'opacity-50')}>
                <span className="block text-sm font-semibold text-ink">{L.audience(a.value)}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{t(`surveys.audienceHelp.${a.value}`)}</span>
              </button>
            ))}
          </div>
        </FormField>
        {byClass && (
          <>
            <FormField label={t('surveys.editor.classes')} hint={t('surveys.editor.classesHint')} error={errors.classIds}>
              <div className="flex flex-wrap gap-1.5">{(lookup?.classes ?? []).map((c) => <Chip key={c.id} on={f.classIds.includes(c.id)} onClick={() => !locked && set('classIds', toggle(f.classIds, c.id))}>{c.name}</Chip>)}</div>
            </FormField>
            <FormField label={t('surveys.editor.sections')} hint={t('surveys.editor.sectionsHint')} error={errors.sectionIds}>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{(lookup?.sections ?? []).filter((s) => !f.classIds.includes(s.classId)).map((s) => <Chip key={s.id} on={f.sectionIds.includes(s.id)} onClick={() => !locked && set('sectionIds', toggle(f.sectionIds, s.id))}>{s.short}</Chip>)}</div>
            </FormField>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('surveys.editor.opensOn')} hint={t('surveys.editor.opensHint')}><DateInput disabled={locked} value={f.opensOn} onChange={(e) => set('opensOn', e.target.value)} /></FormField>
          <FormField label={t('surveys.editor.closesOn')} error={errors.closesOn}><DateInput value={f.closesOn} onChange={(e) => set('closesOn', e.target.value)} /></FormField>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
          <div><p className="text-sm font-semibold text-ink">{t('surveys.editor.anonymous')}</p><p className="text-xs text-ink-muted">{t('surveys.editor.anonymousHint')}</p></div>
          <Switch checked={f.anonymous} disabled={locked} onChange={(v) => set('anonymous', v)} />
        </div>
      </div>
    </Drawer>
  )
}

function PublishModal({ survey, onClose }) {
  const { t } = useTranslation('surveys')
  const qc = useQueryClient()
  const { showError, showSuccess } = useSnackbar()
  const [notify, setNotify] = useState(survey.audience !== 'PUBLIC')
  const go = useMutation({
    mutationFn: () => publishSurvey(survey.id, notify),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['surveys'] }); showSuccess(s.asked ? t('surveys.list.publishedAsked', { count: s.asked }) : t('surveys.list.published')); onClose() },
    onError: (e) => showError(e.message),
  })
  return (
    <Modal open onClose={onClose} title={t('surveys.list.publishTitle', { title: survey.title })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('surveys.common.cancel')}</Button><Button icon={Rocket} loading={go.isPending} onClick={() => go.mutate()}>{t('surveys.list.publish')}</Button></>}>
      <div className="space-y-3 text-sm text-ink">
        <p>{t('surveys.list.publishHint')}</p>
        {survey.audience !== 'PUBLIC' && (
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 rounded border-border text-brand-500" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>{t(`surveys.list.notify.${survey.audience}`, { count: survey.invited ?? 0 })}</span></label>
        )}
      </div>
    </Modal>
  )
}

/** A survey as a tile: audience, state, how many answered so far, and what can be done next. */
function SurveyTile({ s, onEdit, onPublish, onAct }) {
  const { t } = useTranslation('surveys')
  const { date } = useFormat()
  const draft = s.state === 'DRAFT'
  return (
    <div className="ui-panel flex flex-col gap-3 rounded-2xl border border-border/80 bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-ink" title={s.title}>{s.title}</p>
          <p className="truncate text-xs text-ink-muted">{s.formName}{s.formVersion ? ` · ${t('surveys.list.version', { n: s.formVersion })}` : ''}</p>
        </div>
        <StatePill value={s.state} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <AudienceChip value={s.audience} />
        {(s.classIds.length > 0 || s.sectionIds.length > 0) && <ColorChip label={t('surveys.list.someClasses', { count: s.classIds.length + s.sectionIds.length })} tone="neutral" />}
        {s.anonymous && <ColorChip label={t('surveys.list.anonymous')} icon={EyeOff} tone="neutral" />}
      </div>
      {draft ? <p className="text-xs text-ink-faint">{t('surveys.list.notSent')}</p> : <RateBar rate={s.rate} responded={s.responses} invited={s.invited} />}
      <p className="text-xs text-ink-faint">
        {s.opensOn || s.closesOn ? t('surveys.list.dates', { from: s.opensOn ? date(s.opensOn) : '—', to: s.closesOn ? date(s.closesOn) : '—' }) : t('surveys.list.noDates')}
      </p>
      <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-2">
        {draft && hasPermission('surveys.forms.publish') && <Button size="sm" icon={Rocket} onClick={() => onPublish(s)}>{t('surveys.list.publish')}</Button>}
        {!draft && hasPermission('surveys.responses.view') && <Button size="sm" variant="secondary" icon={BarChart3} to={`/surveys/responses?survey=${s.id}`}>{t('surveys.list.results')}</Button>}
        {s.state === 'OPEN' && s.audience !== 'PUBLIC' && hasPermission('surveys.forms.publish') && <Button size="sm" variant="ghost" icon={BellRing} onClick={() => onAct('remind', s)}>{t('surveys.list.remind')}</Button>}
        {s.publicUrl && <Button size="sm" variant="ghost" icon={Link2} onClick={() => onAct('copy', s)}>{t('surveys.list.copyLink')}</Button>}
        {['OPEN', 'SCHEDULED'].includes(s.state) && hasPermission('surveys.forms.publish') && <Button size="sm" variant="ghost" icon={Lock} onClick={() => onAct('close', s)}>{t('surveys.list.close')}</Button>}
        {s.state === 'CLOSED' && hasPermission('surveys.forms.publish') && <Button size="sm" variant="ghost" icon={Unlock} onClick={() => onAct('reopen', s)}>{t('surveys.list.reopen')}</Button>}
        {hasPermission('surveys.forms.edit') && <Button size="sm" variant="ghost" icon={PenLine} aria-label={t('surveys.list.edit')} onClick={() => onEdit(s)} />}
        {!s.responses && hasPermission('surveys.forms.delete') && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('surveys.list.delete')} onClick={() => onAct('delete', s)} />}
      </div>
    </div>
  )
}

/** A staff member fills a staff survey (opened from the bell, or the "for you" list). */
function FillDrawer({ id, onClose }) {
  const { t } = useTranslation('surveys')
  const qc = useQueryClient()
  const [done, setDone] = useState(false)
  useEffect(() => setDone(false), [id])
  const { data: s, error } = useQuery({ queryKey: ['surveys', 'mine', id], queryFn: () => fetchMySurvey(id), enabled: !!id })
  return (
    <Drawer open={!!id} onClose={onClose} size="lg" title={s?.title ?? ''} subtitle={s?.anonymous ? t('surveys.fill.anonymousNote') : undefined}>
      {error && <Note tone="danger">{error.message}</Note>}
      {s && (
        <div className="space-y-4">
          {s.intro && <p className="whitespace-pre-wrap text-sm text-ink-muted">{s.intro}</p>}
          {s.state !== 'OPEN' ? <Note tone="info">{t('surveys.fill.notOpen')}</Note> : (
            <SurveyFill definition={s.definition} submitted={done || s.answered} compact
              onSubmit={async (values) => { await answerMySurvey(s.id, values); setDone(true); qc.invalidateQueries({ queryKey: ['surveys', 'mine'] }) }} />
          )}
        </div>
      )}
    </Drawer>
  )
}

function ForYou({ onFill }) {
  const { t } = useTranslation('surveys')
  const { data = [] } = useQuery({ queryKey: ['surveys', 'mine'], queryFn: fetchMySurveys })
  const todo = data.filter((s) => !s.answered)
  if (!todo.length) return null
  return (
    <Panel title={t('surveys.fill.forYou')} subtitle={t('surveys.fill.forYouHint')} icon={MessageSquareHeart}>
      <div className="flex flex-wrap gap-2">
        {todo.map((s) => <Button key={s.id} variant="secondary" icon={PenLine} onClick={() => onFill(s.id)}>{s.title}</Button>)}
      </div>
    </Panel>
  )
}

/** Surveys & feedback › Surveys: every survey as a tile (drafts, open, closed), the editor, publishing and reminders. */
export default function SurveysForms() {
  const { t } = useTranslation('surveys')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { showError, showSuccess } = useSnackbar()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState('')
  const [editing, setEditing] = useState(null) // null closed · {} new · survey
  const [publishing, setPublishing] = useState(null)
  const canView = hasPermission('surveys.forms.view')
  const fill = params.get('fill')
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['surveys', 'list'], queryFn: fetchSurveys, enabled: canView })
  const act = useMutation({
    mutationFn: async ({ kind, s }) => {
      if (kind === 'copy') { await navigator.clipboard?.writeText(s.publicUrl); return t('surveys.list.linkCopied') }
      if (kind === 'remind') return t('surveys.list.reminded', { count: (await remindSurvey(s.id)).asked })
      if (kind === 'close') { await closeSurvey(s.id, true); return t('surveys.list.closed') }
      if (kind === 'reopen') { await closeSurvey(s.id, false); return t('surveys.list.reopened') }
      if (kind === 'delete') {
        if (!(await confirm({ title: t('surveys.list.deleteConfirm', { title: s.title }), confirmLabel: t('surveys.list.delete'), tone: 'danger' }))) return null
        await deleteSurvey(s.id)
        return t('surveys.list.deleted')
      }
      return null
    },
    onSuccess: (msg) => { if (msg) { qc.invalidateQueries({ queryKey: ['surveys'] }); showSuccess(msg) } },
    onError: (e) => showError(e.message),
  })
  const counts = useMemo(() => data.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] ?? 0) + 1 }), {}), [data])
  const shown = state ? data.filter((s) => s.state === state) : data
  const sent = data.filter((s) => s.rate != null && s.state !== 'DRAFT')
  const avgRate = sent.length ? Math.round(sent.reduce((n, s) => n + s.rate, 0) / sent.length) : null
  const setFill = (id) => setParams(id ? { fill: id } : {}, { replace: true })
  return (
    <PageContainer>
      <PageHeader icon={MessageSquareHeart} title={t('surveys.list.title')} subtitle={t('surveys.list.subtitle')}
        actions={canView && hasPermission('surveys.forms.create') && <Button icon={Plus} onClick={() => setEditing({})}>{t('surveys.list.new')}</Button>} />
      <ForYou onFill={setFill} />
      {!canView ? null : (
        <>
          <StatCardRow items={[
            { icon: Rocket, tone: 'success', label: t('surveys.list.statOpen'), value: counts.OPEN ?? 0 },
            { icon: FilePen, tone: 'neutral', label: t('surveys.list.statDrafts'), value: counts.DRAFT ?? 0 },
            { icon: Users, tone: 'brand', label: t('surveys.list.statResponses'), value: data.reduce((n, s) => n + (s.responses ?? 0), 0) },
            { icon: BarChart3, tone: 'violet', label: t('surveys.list.statRate'), value: avgRate != null ? `${avgRate}%` : '—', progress: avgRate ?? undefined },
          ]} />
          <SideNavLayout nav={<SideNav title={t('surveys.list.show')} value={state} onChange={setState} items={[
            { id: '', label: t('surveys.list.all'), count: data.length },
            ...['OPEN', 'SCHEDULED', 'DRAFT', 'CLOSED'].map((x) => ({ id: x, label: t(`surveys.states.${x}`), count: counts[x] ?? 0 })),
          ]} />}>
            {error && <EmptyState error={error} onRetry={refetch} />}
            {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-black/[0.04]" /> : !shown.length ? (
              <EmptyState icon={MessageSquareHeart} title={t('surveys.list.empty')} hint={t('surveys.list.emptyHint')}
                action={hasPermission('surveys.forms.create') && <Button icon={Plus} onClick={() => setEditing({})}>{t('surveys.list.new')}</Button>} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((s) => <SurveyTile key={s.id} s={s} onEdit={setEditing} onPublish={setPublishing} onAct={(kind, x) => act.mutate({ kind, s: x })} />)}
              </div>
            )}
          </SideNavLayout>
        </>
      )}
      <SurveyEditor open={!!editing} survey={editing?.id ? editing : null} onClose={() => setEditing(null)} />
      {publishing && <PublishModal survey={publishing} onClose={() => setPublishing(null)} />}
      <FillDrawer id={fill} onClose={() => setFill(null)} />
    </PageContainer>
  )
}
