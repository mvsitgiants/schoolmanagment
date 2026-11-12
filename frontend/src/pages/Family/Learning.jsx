import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BookOpen, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, CornerDownRight, ExternalLink, FileText, GraduationCap, Link2, Paperclip, PlayCircle, Sparkles, Video } from 'lucide-react'
import { SideNav, SideNavLayout, StatusPill, TONE, hueTone } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCourse, familyItemFileUrl, familyJoinLive, familyLearning, familyMarkItem, familyViewItem } from '../../api/family'
import { RichTextView } from '../../components/lms/RichText'
import { useFormat } from '../../context/SettingsContext'

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const ICON = { NOTE: FileText, FILE: Paperclip, LINK: Link2, VIDEO: PlayCircle }

/** A slim completion bar: brand while going, green when finished. */
function Bar({ pct, className }) {
  return (
    <span className={clsx('block h-1.5 overflow-hidden rounded-full bg-black/[0.06]', className)}>
      <span className={clsx('block h-full rounded-full transition-all', pct >= 100 ? 'bg-success-500' : 'bg-brand-500')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}

/** The subject's initials on its own colour — the same subject looks the same everywhere in the app. */
function SubjectTile({ subject, className }) {
  const tone = TONE[hueTone(subject)]
  const words = String(subject ?? '').split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() : words[0] ? words[0][0].toUpperCase() + (words[0][1] ?? '') : '·'
  return <span className={clsx('flex shrink-0 items-center justify-center rounded-xl border text-sm font-bold', tone.bg, tone.border, tone.text, className)} aria-hidden>{letters}</span>
}

/** One practice question; its answer shows on a tap. */
function PracticeRow({ q, n }) {
  const { t } = useTranslation('family')
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl bg-black/[0.03] px-3 py-2.5">
      <p className="text-sm text-ink whitespace-pre-line break-words"><span className="me-1 font-semibold text-ink-muted">{n}.</span>{q.question}</p>
      {q.kind === 'MCQ' && q.options.length > 0 && <ol className="mt-1 list-[lower-alpha] ps-5 text-sm text-ink-muted">{q.options.map((o, i) => <li key={i}>{o}</li>)}</ol>}
      {q.answer && (open
        ? <p className="mt-1.5 rounded-lg bg-success-50 px-2.5 py-2 text-sm text-ink whitespace-pre-line break-words">{q.answer}</p>
        : <button type="button" onClick={() => setOpen(true)} className="mt-1 inline-flex min-h-[40px] items-center text-sm font-medium text-brand-700">{t('family.learning.showAnswer')}</button>)}
    </li>
  )
}

/** The topic's practice questions (the ones its teacher asks in class). */
function Practice({ questions }) {
  const { t } = useTranslation('family')
  if (!questions?.length) return null
  return (
    <div className="pt-1">
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-brand-600" aria-hidden />{t('family.learning.practice')}</p>
      <ol className="space-y-1.5">{questions.map((q, i) => <PracticeRow key={q.id} q={q} n={i + 1} />)}</ol>
    </div>
  )
}

function CourseView({ courseId, onBack }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { data: c, isLoading, error } = useFamilyQuery(['course', courseId], () => familyCourse(slug, studentId, courseId))
  const mark = useMutation({ mutationFn: ({ itemId, done }) => familyMarkItem(slug, studentId, courseId, itemId, done), onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'course', courseId], d); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'learning'] }) } })
  const [open, setOpen] = useState(null)
  const [seen] = useState(() => new Set())
  // opening an item counts a view (once per student on the server; once per visit here)
  const toggle = (itemId) => {
    const next = open === itemId ? null : itemId
    setOpen(next)
    if (next && !seen.has(next)) { seen.add(next); familyViewItem(slug, studentId, courseId, next).catch(() => {}) }
  }
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-medium text-brand-700"><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('family.learning.back')}</button>
      <FCard>
        <div className="flex items-start gap-3">
          <SubjectTile subject={c.subject} className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{c.subject}</p>
            <p className="mt-0.5 text-[17px] font-semibold leading-snug text-ink break-words">{c.title}</p>
          </div>
        </div>
        {c.description && <p className="mt-2 text-sm text-ink-muted whitespace-pre-line break-words">{c.description}</p>}
        <div className="mt-3 flex items-center gap-3">
          <Bar pct={c.pct} className="flex-1" />
          <span className="shrink-0 text-xs font-medium text-ink-muted tabular-nums">{t('family.learning.doneOf', { done: c.done, total: c.total })} · {c.pct}%</span>
        </div>
      </FCard>
      {c.units.map((u) => {
        const done = u.items.filter((i) => i.done).length
        return (
          <FCard key={u.id} title={u.title} action={<span className="text-xs font-medium text-ink-muted tabular-nums">{done}/{u.items.length}</span>}>
            <ul className="-my-2 divide-y divide-border">
              {u.items.map((i) => {
                const Icon = ICON[i.kind] ?? FileText
                const expanded = open === i.id
                const sub = i.hub && i.subTopicId
                return (
                  <li key={i.id} className={clsx('py-1', sub && 'ps-6')}>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label={i.done ? t('family.learning.undo') : t('family.learning.markDone')} aria-pressed={i.done} onClick={() => mark.mutate({ itemId: i.id, done: !i.done })}
                        className="-ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-black/[0.03]">
                        {i.done ? <CheckCircle2 className="h-6 w-6 text-success-600" /> : <Circle className="h-6 w-6 text-ink-faint" />}
                      </button>
                      <button type="button" onClick={() => toggle(i.id)} aria-expanded={expanded} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 py-1.5 text-start">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-ink-muted">{sub ? <CornerDownRight className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}</span>
                        <span className="min-w-0 flex-1">
                          <span className={clsx('block text-sm font-medium leading-snug break-words', i.done ? 'text-ink-muted line-through decoration-ink-faint' : 'text-ink')}>{(sub && i.subTitle) || i.title}</span>
                          {i.practice?.length > 0 && <span className="block text-xs text-ink-faint">{t('family.learning.practiceN', { count: i.practice.length })}</span>}
                          {i.minutes ? <span className="block text-xs text-ink-faint">{t('family.learning.minutes', { count: i.minutes })}</span> : null}
                        </span>
                        <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-180')} aria-hidden />
                      </button>
                    </div>
                    {expanded && (
                      <div className="mb-2 mt-1 space-y-2 ps-10">
                        {i.html ? <RichTextView html={i.html} /> : i.body && <p className="text-sm text-ink whitespace-pre-line break-words">{i.body}</p>}
                        {i.embed && <div className="aspect-video w-full overflow-hidden rounded-xl bg-black"><iframe src={i.embed} title={i.title} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>}
                        {i.url && !i.embed && <a href={i.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-brand-700 hover:bg-black/[0.02]"><ExternalLink className="h-4 w-4" />{t('family.learning.open')}</a>}
                        {i.files.map((f) => (
                          <a key={f.id} href={familyItemFileUrl(slug, studentId, courseId, i.id, f.id)} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm text-ink hover:bg-black/[0.02]">
                            <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="shrink-0 text-xs text-ink-faint">{size(f.size)}</span>
                          </a>
                        ))}
                        <Practice questions={i.practice} />
                        {!i.html && !i.body && !i.embed && !i.url && !i.files.length && !i.practice?.length && <p className="text-sm text-ink-faint">{t('family.learning.nothingMore')}</p>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </FCard>
        )
      })}
    </>
  )
}

/** The student's study material and live classes; a course opens with the other courses alongside to hop between. */
export default function FamilyLearning() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [course, setCourse] = useState(null)
  const [joinError, setJoinError] = useState(null)
  const { data: d, isLoading, error } = useFamilyQuery(['learning'], () => familyLearning(slug, studentId))
  const join = useMutation({ mutationFn: (liveId) => familyJoinLive(slug, studentId, liveId), onSuccess: (r) => { setJoinError(null); window.open(r.url, '_blank', 'noopener') }, onError: (e) => setJoinError(e.message) })
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (course) {
    return (
      <SideNavLayout nav={d.courses.length > 1 && (
        <SideNav title={t('family.learning.courses')} value={course} onChange={setCourse} items={d.courses.map((c) => ({
          id: c.id, label: c.subject || c.title, icon: BookOpen, hint: c.title, count: `${c.done}/${c.total}`, progress: { value: c.done, max: c.total || 1, kind: 'done' },
        }))} />
      )}>
        <CourseView key={course} courseId={course} onBack={() => setCourse(null)} />
      </SideNavLayout>
    )
  }
  return (
    <>
      {d.live.length > 0 && (
        <FCard title={t('family.learning.live')}>
          {joinError && <p className="mb-2 text-sm text-danger-700">{joinError}</p>}
          <ul className="-my-2 divide-y divide-border">
            {d.live.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', l.status === 'LIVE' ? 'bg-success-50 text-success-600' : 'bg-black/[0.04] text-ink-muted')}><Video className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  {l.status === 'LIVE' && <StatusPill tone="success">{t('family.learning.liveNow')}</StatusPill>}
                  <p className={clsx('text-sm font-medium leading-snug text-ink break-words', l.status === 'LIVE' && 'mt-1')}>{l.subject ? <span className="text-brand-700">{l.subject} · </span> : null}{l.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{date(l.date)} · {l.start}{l.host ? ` · ${l.host}` : ''}</p>
                </div>
                <button type="button" disabled={!l.canJoin || join.isPending} onClick={() => join.mutate(l.id)} className="min-h-[44px] shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-black/[0.06] disabled:text-ink-faint">{t('family.learning.join')}</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">{t('family.learning.joinHint')}</p>
        </FCard>
      )}
      {!d.courses.length ? <FCard><FEmpty icon={GraduationCap} title={t('family.learning.none')} /></FCard> : (
        <FCard title={t('family.learning.courses')}>
          <ul className="-my-2 divide-y divide-border">
            {d.courses.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setCourse(c.id)} className="-mx-1 flex w-[calc(100%+0.5rem)] min-h-[64px] items-center gap-3 rounded-xl px-1 py-3 text-start hover:bg-black/[0.02] active:bg-black/[0.04]">
                  <SubjectTile subject={c.subject} className="h-11 w-11" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-snug text-ink break-words">{c.title}</span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <Bar pct={c.pct} className="flex-1" />
                      <span className="shrink-0 text-xs text-ink-muted tabular-nums">{t('family.learning.doneOf', { done: c.done, total: c.total })}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </FCard>
      )}
      {d.recordings.length > 0 && (
        <FCard title={t('family.learning.recordings')}>
          <ul className="-my-2 divide-y divide-border">
            {d.recordings.map((r) => (
              <li key={r.id}>
                <a href={r.url} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center gap-3 py-2 text-sm text-ink">
                  <PlayCircle className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                  <span className="min-w-0 flex-1 break-words">{r.subject ? `${r.subject} · ` : ''}{r.title}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{date(r.date)}</span>
                </a>
              </li>
            ))}
          </ul>
        </FCard>
      )}
    </>
  )
}
