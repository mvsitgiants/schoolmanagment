import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Eye, Users } from 'lucide-react'
import { addDaysYmd, hasRichContent } from '@schoolgiant/shared'
import { DateInput, FormField, Input, Note, Panel, SegmentedControl, localIso } from '../system'
import Button from '../ui/Button'
import { RichTextView } from '../lms/RichText'
import { StudentPicker } from '../../pages/Lms/CreateContent'
import { FileChips } from './HubTools'
import { fetchHubStudents } from '../../api/teaching'

// Step 3 of the Subject hub: the unit as a student will see it, a checklist, and how to publish it.

const filled = (c) => !!c && (hasRichContent(c.html) || c.files.length > 0)

/** Publish options as the form holds them, from the unit's current state. */
export function publishDefaults(unit) {
  return {
    when: unit?.status === 'SCHEDULED' ? 'LATER' : 'NOW',
    publishDate: unit?.publishDate ?? addDaysYmd(localIso(new Date()), 1), publishTime: unit?.publishTime ?? '08:00',
    visibility: unit?.visibility ?? 'ALL', studentIds: unit?.studentIds ?? [],
  }
}

function StudentView({ hub }) {
  const { t } = useTranslation('hub')
  return (
    <Panel icon={Eye} title={t('hub.review.previewTitle')} subtitle={t('hub.review.previewHint')}>
      <article className="space-y-5">
        <h2 className="text-lg font-semibold text-ink">{hub.unit.name}</h2>
        {hub.topics.map((tp, i) => {
          const practice = tp.questions.filter((q) => q.use === 'CLASS')
          return (
            <section key={tp.id} className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
              <h3 className="text-base font-semibold text-ink">{`${i + 1}. ${tp.name}`}</h3>
              {filled(tp.content) ? (
                <>
                  <RichTextView html={tp.content.html} />
                  <FileChips files={tp.content.files} />
                </>
              ) : <p className="text-sm italic text-ink-faint">{t('hub.review.nothingYet')}</p>}
              {tp.subTopics.map((s, j) => (
                <div key={s.id} className="space-y-1.5 ps-3 sm:ps-4">
                  <h4 className="text-sm font-semibold text-ink">{`${i + 1}.${j + 1} ${s.name}`}</h4>
                  {filled(s.content) ? (
                    <>
                      <RichTextView html={s.content.html} />
                      <FileChips files={s.content.files} />
                    </>
                  ) : <p className="text-sm italic text-ink-faint">{t('hub.review.nothingYet')}</p>}
                </div>
              ))}
              {practice.length > 0 && (
                <div className="rounded-lg bg-bg p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('hub.review.practice')}</p>
                  <ol className="list-decimal space-y-1.5 ps-5 text-sm text-ink">
                    {practice.map((q) => (
                      <li key={q.id}>
                        <span className="whitespace-pre-line">{q.question}</span>
                        {q.kind === 'MCQ' && q.options.length > 0 && (
                          <ul className="mt-1 grid grid-cols-1 gap-x-4 text-ink-muted sm:grid-cols-2">
                            {q.options.map((o, k) => <li key={k}>{`${String.fromCharCode(97 + k)}) ${o}`}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )
        })}
      </article>
    </Panel>
  )
}

function Checklist({ hub }) {
  const { t } = useTranslation('hub')
  const empty = hub.topics.filter((tp) => !filled(tp.content) && !tp.subTopics.some((s) => filled(s.content)))
  const emptySubs = hub.topics.flatMap((tp) => tp.subTopics.filter((s) => !filled(s.content)).map((s) => `${tp.name} · ${s.name}`))
  const count = (use) => hub.topics.reduce((n, tp) => n + tp.questions.filter((q) => q.use === use).length, 0)
  const noNotes = hub.topics.filter((tp) => !tp.howTo && !tp.keyPoints.length)
  const rows = [
    { ok: hub.topics.length > 0, text: t('hub.review.topics', { count: hub.topics.length }) },
    { ok: !empty.length, text: empty.length ? t('hub.review.emptyTopics', { count: empty.length }) : t('hub.review.allContent'), list: empty.map((x) => x.name) },
    ...(emptySubs.length ? [{ ok: false, text: t('hub.review.emptySubs', { count: emptySubs.length }), list: emptySubs }] : []),
    { ok: count('CLASS') > 0, text: t('hub.review.practiceCount', { count: count('CLASS') }) },
    { ok: true, quiet: true, text: t('hub.review.otherQuestions', { homework: count('HOMEWORK'), exam: count('EXAM') }) },
    { ok: !noNotes.length, quiet: true, text: noNotes.length ? t('hub.review.noNotes', { count: noNotes.length }) : t('hub.review.allNotes') },
  ]
  return (
    <Panel title={t('hub.review.checkTitle')}>
      <ul className="space-y-2.5">
        {rows.map((r, i) => {
          const Icon = r.ok ? CheckCircle2 : AlertCircle
          return (
            <li key={i} className="flex gap-2 text-sm">
              <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', r.ok ? 'text-success-600' : r.quiet ? 'text-ink-faint' : 'text-amber-600')} aria-hidden />
              <span className="min-w-0">
                <span className="text-ink">{r.text}</span>
                {r.list?.length > 0 && <span className="block truncate text-xs text-ink-muted">{r.list.slice(0, 4).join(', ')}{r.list.length > 4 ? ` ${t('hub.review.more', { count: r.list.length - 4 })}` : ''}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** Publish now or later, to all students or chosen ones. */
function PublishOptions({ hub, value, onChange, errors }) {
  const { t } = useTranslation('hub')
  const [picking, setPicking] = useState(false)
  const set = (k) => (e) => onChange({ ...value, [k]: e?.target ? e.target.value : e })
  return (
    <Panel title={t('hub.review.publishTitle')}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">{t('hub.review.when')}</p>
          <SegmentedControl className="w-full" value={value.when} onChange={set('when')} options={[{ value: 'NOW', label: t('hub.review.now') }, { value: 'LATER', label: t('hub.review.later') }]} />
          {value.when === 'LATER' && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormField label={t('hub.review.date')} error={errors.publishDate}><DateInput value={value.publishDate} min={localIso(new Date())} onChange={set('publishDate')} /></FormField>
              <FormField label={t('hub.review.time')}><Input type="time" value={value.publishTime} onChange={set('publishTime')} /></FormField>
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">{t('hub.review.who')}</p>
          <SegmentedControl className="w-full" value={value.visibility} onChange={(v) => { onChange({ ...value, visibility: v }); if (v === 'STUDENTS' && !value.studentIds.length) setPicking(true) }}
            options={[{ value: 'ALL', label: t('hub.review.all') }, { value: 'STUDENTS', label: t('hub.review.chosen') }]} />
          {value.visibility === 'STUDENTS' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={Users} onClick={() => setPicking(true)}>{t('hub.review.chooseStudents')}</Button>
              <span className={clsx('text-xs', errors.studentIds ? 'text-danger-700' : 'text-ink-muted')}>{errors.studentIds ?? t('hub.review.chosenCount', { count: value.studentIds.length })}</span>
            </div>
          )}
        </div>
      </div>
      {picking && (
        <StudentPicker classId={hub.classId} value={value.studentIds} rowsKey={['hub-students', hub.classId, hub.subjectId]} fetchRows={() => fetchHubStudents(hub.classId, hub.subjectId)}
          onClose={() => setPicking(false)} onDone={(ids) => { onChange({ ...value, studentIds: ids }); setPicking(false) }} />
      )}
    </Panel>
  )
}

/** Step 3: checklist and publish options first on phones; beside the student view on computers. */
export default function HubReview({ hub, options, onOptions, errors }) {
  const { t } = useTranslation('hub')
  const status = hub.unit.status
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3 lg:order-2">
        {status !== 'EMPTY' && status !== 'DRAFT' && <Note tone={status === 'MIXED' ? 'warning' : 'success'}>{t(`hub.review.state.${status}`)}</Note>}
        <Checklist hub={hub} />
        <PublishOptions hub={hub} value={options} onChange={onOptions} errors={errors} />
      </div>
      <div className="min-w-0 lg:order-1"><StudentView hub={hub} /></div>
    </div>
  )
}
