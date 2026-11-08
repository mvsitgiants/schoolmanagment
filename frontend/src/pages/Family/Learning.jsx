import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronLeft, Circle, ExternalLink, GraduationCap, Link2, Paperclip, PlayCircle, Video } from 'lucide-react'
import { ProgressBar, StatusPill } from '../../components/system'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCourse, familyItemFileUrl, familyJoinLive, familyLearning, familyMarkItem } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'

const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const ICON = { NOTE: Circle, FILE: Paperclip, LINK: Link2, VIDEO: PlayCircle }

function CourseView({ courseId, onBack }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { data: c, isLoading, error } = useFamilyQuery(['course', courseId], () => familyCourse(slug, studentId, courseId))
  const mark = useMutation({ mutationFn: ({ itemId, done }) => familyMarkItem(slug, studentId, courseId, itemId, done), onSuccess: (d) => { qc.setQueryData(['family', slug, studentId, 'course', courseId], d); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'learning'] }) } })
  const [open, setOpen] = useState(null)
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-brand-700"><ChevronLeft className="w-4 h-4" />{t('family.learning.back')}</button>
      <FCard>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{c.subject}</p>
        <p className="mt-0.5 text-[15px] font-semibold text-ink">{c.title}</p>
        {c.description && <p className="mt-1 text-sm text-ink-muted whitespace-pre-line">{c.description}</p>}
        <div className="mt-3"><ProgressBar value={c.pct} /></div>
        <p className="mt-1 text-xs text-ink-muted">{t('family.learning.doneOf', { done: c.done, total: c.total })}</p>
      </FCard>
      {c.units.map((u) => (
        <FCard key={u.id} title={u.title}>
          <div className="divide-y divide-border">
            {u.items.map((i) => {
              const Icon = ICON[i.kind] ?? Circle
              const expanded = open === i.id
              return (
                <div key={i.id} className="py-2">
                  <div className="flex items-center gap-3">
                    <button type="button" aria-label={i.done ? t('family.learning.undo') : t('family.learning.markDone')} onClick={() => mark.mutate({ itemId: i.id, done: !i.done })} className="min-h-[44px] min-w-[44px] flex items-center justify-center">
                      {i.done ? <CheckCircle2 className="w-6 h-6 text-success-600" /> : <Circle className="w-6 h-6 text-ink-faint" />}
                    </button>
                    <button type="button" onClick={() => setOpen(expanded ? null : i.id)} className="flex-1 min-w-0 text-left min-h-[44px]">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><Icon className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="truncate">{i.title}</span></span>
                      {i.minutes ? <span className="block text-xs text-ink-faint">{t('family.learning.minutes', { count: i.minutes })}</span> : null}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-2 ml-[52px] space-y-2">
                      {i.body && <p className="text-sm text-ink whitespace-pre-line break-words">{i.body}</p>}
                      {i.embed && <div className="aspect-video w-full overflow-hidden rounded-xl bg-black"><iframe src={i.embed} title={i.title} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>}
                      {i.url && !i.embed && <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-brand-700"><ExternalLink className="w-4 h-4" />{t('family.learning.open')}</a>}
                      {i.files.map((f) => (
                        <a key={f.id} href={familyItemFileUrl(slug, studentId, courseId, i.id, f.id)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-3 text-sm text-ink hover:bg-black/[0.02]">
                          <Paperclip className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-ink-faint">{size(f.size)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </FCard>
      ))}
    </>
  )
}

/** The student's study material and live classes. */
export default function FamilyLearning() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const [course, setCourse] = useState(null)
  const [joinError, setJoinError] = useState(null)
  const { data: d, isLoading, error } = useFamilyQuery(['learning'], () => familyLearning(slug, studentId))
  const join = useMutation({ mutationFn: (liveId) => familyJoinLive(slug, studentId, liveId), onSuccess: (r) => { setJoinError(null); window.open(r.url, '_blank', 'noopener') }, onError: (e) => setJoinError(e.message) })
  if (course) return <CourseView courseId={course} onBack={() => setCourse(null)} />
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  return (
    <>
      {d.live.length > 0 && (
        <FCard title={t('family.learning.live')}>
          {joinError && <p className="mb-2 text-sm text-danger-700">{joinError}</p>}
          <div className="divide-y divide-border">
            {d.live.map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2">
                <Video className={`w-5 h-5 shrink-0 ${l.status === 'LIVE' ? 'text-success-600' : 'text-ink-faint'}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{l.subject ? `${l.subject} · ` : ''}{l.title}</p>
                  <p className="text-xs text-ink-muted">{date(l.date)} · {l.start}{l.host ? ` · ${l.host}` : ''}</p>
                </div>
                {l.status === 'LIVE' && <StatusPill tone="success">{t('family.learning.liveNow')}</StatusPill>}
                <button type="button" disabled={!l.canJoin || join.isPending} onClick={() => join.mutate(l.id)} className="min-h-[44px] rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:bg-black/10 disabled:text-ink-faint">{t('family.learning.join')}</button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">{t('family.learning.joinHint')}</p>
        </FCard>
      )}
      {!d.courses.length ? <FCard><FEmpty icon={GraduationCap} title={t('family.learning.none')} /></FCard> : (
        <FCard title={t('family.learning.courses')}>
          <div className="divide-y divide-border">
            {d.courses.map((c) => (
              <button key={c.id} type="button" onClick={() => setCourse(c.id)} className="block w-full py-3 text-left min-h-[44px]">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{c.subject}</p>
                <p className="text-sm font-medium text-ink">{c.title}</p>
                <div className="mt-1.5 flex items-center gap-2"><div className="flex-1"><ProgressBar value={c.pct} showValue={false} /></div><span className="text-xs text-ink-muted">{t('family.learning.doneOf', { done: c.done, total: c.total })}</span></div>
              </button>
            ))}
          </div>
        </FCard>
      )}
      {d.recordings.length > 0 && (
        <FCard title={t('family.learning.recordings')}>
          {d.recordings.map((r) => (
            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-2 py-1 text-sm text-ink">
              <PlayCircle className="w-4 h-4 text-ink-faint" aria-hidden /><span className="flex-1 truncate">{r.subject ? `${r.subject} · ` : ''}{r.title}</span><span className="text-xs text-ink-faint">{date(r.date)}</span>
            </a>
          ))}
        </FCard>
      )}
    </>
  )
}
