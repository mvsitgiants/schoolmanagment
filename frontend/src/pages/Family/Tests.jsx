import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, ListChecks, XCircle } from 'lucide-react'
import { FCard, FEmpty, FError, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyAttempt, familySaveAnswer, familyStartTest, familySubmitTest, familyTestEvent, familyTestResult, familyTests } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { PillRow, StatusPill, pillClass, useConfirm } from '../../components/system'

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Result({ attemptId, onBack }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { data: r, isLoading, error } = useFamilyQuery(['test-result', attemptId], () => familyTestResult(slug, studentId, attemptId))
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  const pick = (l) => (Array.isArray(l.yours) ? l.yours : l.yours === null ? [] : [Number(l.yours)])
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-medium text-brand-700"><ChevronLeft className="w-4 h-4 rtl:rotate-180" />{t('family.tests.back')}</button>
      <FCard>
        <p className="text-[17px] font-semibold leading-snug text-ink break-words">{r.testTitle}</p>
        {!r.released ? <p className="mt-2 text-sm text-ink-muted">{t(`family.tests.notYet.${r.results ?? 'AFTER_CLOSE'}`)}</p> : (
          <>
            <div className="mt-3 flex items-center gap-4">
              <div className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ${r.passed ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
                <span className="text-2xl font-bold tabular-nums leading-none">{r.score.total}</span>
                <span className="mt-0.5 text-[11px] font-medium">/ {r.totalMarks}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${r.passed ? 'text-success-700' : 'text-danger-700'}`}>{r.score.pct}% · {r.passed ? t('family.tests.pass') : t('family.tests.fail')}</p>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-black/[0.06]"><span className={`block h-full rounded-full ${r.passed ? 'bg-success-500' : 'bg-danger-500'}`} style={{ width: `${Math.max(0, Math.min(100, r.score.pct))}%` }} /></span>
                {r.pending > 0 && <p className="mt-2 text-xs text-amber-700">{t('family.tests.pending', { count: r.pending })}</p>}
              </div>
            </div>
          </>
        )}
      </FCard>
      {r.released && r.lines?.map((l) => (
        <FCard key={l.index}>
          <div className="flex items-start gap-2">
            {l.pending ? <Clock className="w-5 h-5 text-amber-600 shrink-0" /> : l.correct === false ? <XCircle className="w-5 h-5 text-danger-600 shrink-0" /> : <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />}
            <p className="min-w-0 flex-1 text-sm text-ink break-words whitespace-pre-line">{l.index + 1}. {l.text}</p>
            <span className="text-xs text-ink-muted whitespace-nowrap">{l.pending ? '—' : l.got}/{l.marks}</span>
          </div>
          {l.options.length > 0 && (
            <ul className="mt-2 ml-7 space-y-1 text-sm">
              {l.options.map((o, i) => <li key={i} className={o.correct ? 'text-success-700 font-medium' : pick(l).includes(i) ? 'text-danger-700 line-through' : 'text-ink-muted'}>{o.text}{pick(l).includes(i) ? ` ${t('family.tests.yours')}` : ''}</li>)}
            </ul>
          )}
          {!l.options.length && <p className="mt-2 ml-7 text-sm text-ink-muted whitespace-pre-line">{t('family.tests.youWrote')} {l.yours ?? '—'}</p>}
          {l.answers?.length > 0 && <p className="mt-1 ml-7 text-sm text-success-700">{t('family.tests.answer')} {l.answers.join(' / ')}</p>}
          {l.explanation && <p className="mt-1 ml-7 text-xs text-ink-muted">{l.explanation}</p>}
          {l.feedback && <p className="mt-1 ml-7 text-xs italic text-ink-muted">“{l.feedback}”</p>}
        </FCard>
      ))}
    </>
  )
}

/** Writing the test: one question at a time, saved as the student goes, timed by the server. */
function Paper({ attemptId, onDone }) {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const confirm = useConfirm()
  const { data: p, isLoading, error } = useFamilyQuery(['attempt', attemptId], () => familyAttempt(slug, studentId, attemptId), { refetchOnWindowFocus: false })
  const [answers, setAnswers] = useState({})
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState(null)
  const [warning, setWarning] = useState(null)
  const timers = useRef({})
  useEffect(() => { if (p?.answers) setAnswers(p.answers) }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p?.secondsLeft !== undefined) setLeft(p.secondsLeft) }, [p?.secondsLeft])
  const submit = useMutation({ mutationFn: () => familySubmitTest(slug, studentId, attemptId), onSuccess: () => onDone(attemptId) })
  // the countdown; at zero the paper goes in
  useEffect(() => {
    if (left === null) return undefined
    if (left <= 0) { submit.mutate(); return undefined }
    const id = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps
  // proctoring: leaving the page / app, leaving full screen
  useEffect(() => {
    if (!p || p.submitted) return undefined
    const report = async (type) => {
      try {
        const r = await familyTestEvent(slug, studentId, attemptId, type)
        if (r.submitted) onDone(attemptId)
        else if (r.left !== null && r.left !== undefined) setWarning(t('family.tests.leftWarning', { count: Math.max(0, r.left) }))
      } catch { /* the server still counts it on the next save */ }
    }
    const onVis = () => { if (document.visibilityState === 'hidden') report('BLUR') }
    const onFs = () => { if (!document.fullscreenElement && p.proctor?.fullscreen) report('FULLSCREEN_EXIT') }
    document.addEventListener('visibilitychange', onVis)
    document.addEventListener('fullscreenchange', onFs)
    if (p.proctor?.fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    return () => { document.removeEventListener('visibilitychange', onVis); document.removeEventListener('fullscreenchange', onFs) }
  }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p?.submitted) onDone(attemptId) }, [p?.submitted]) // eslint-disable-line react-hooks/exhaustive-deps
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!p || p.submitted) return <FSkeleton className="h-64" />
  const q = p.questions[at]
  const save = (index, value, delay = 0) => {
    setAnswers((a) => ({ ...a, [index]: value }))
    clearTimeout(timers.current[index])
    timers.current[index] = setTimeout(() => {
      familySaveAnswer(slug, studentId, attemptId, { index, value }).then((r) => setLeft(r.secondsLeft)).catch((e) => { if (e.code === 'SUBMITTED') onDone(attemptId) })
    }, delay)
  }
  const done = p.questions.filter((x) => answers[x.index] !== undefined && answers[x.index] !== null && answers[x.index] !== '' && !(Array.isArray(answers[x.index]) && !answers[x.index].length)).length
  const value = answers[q.index]
  return (
    <>
      <div className="sticky top-0 z-30 flex min-h-[66px] items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="min-w-0 text-sm font-medium text-ink line-clamp-2">{p.testTitle}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 font-mono-num text-lg font-semibold ${left !== null && left < 60 ? 'text-danger-600' : 'text-ink'}`}><Clock className="w-4 h-4" />{left === null ? '—' : mmss(Math.max(0, left))}</span>
      </div>
      {warning && <p className="text-sm text-amber-700">{warning}</p>}
      <FCard>
        <p className="text-xs text-ink-muted">{t('family.tests.qOf', { n: at + 1, total: p.questions.length })} · {t('family.tests.marks', { count: q.marks })}{q.negative ? ` · ${t('family.tests.negative', { n: q.negative })}` : ''}</p>
        <p className="mt-2 text-[15px] text-ink whitespace-pre-line">{q.text}</p>
        <div className="mt-3 space-y-2">
          {['MCQ', 'TRUE_FALSE'].includes(q.type) && q.options.map((o) => (
            <label key={o.i} className={`flex min-h-[48px] items-center gap-3 rounded-xl border px-3 py-2 text-[15px] ${Number(value) === o.i && value !== null && value !== undefined ? 'border-brand-500 bg-brand-50' : 'border-border'}`}>
              <input type="radio" name={`q${q.index}`} checked={value !== null && value !== undefined && Number(value) === o.i} onChange={() => save(q.index, o.i)} className="border-border text-brand-500" />{o.text}
            </label>
          ))}
          {q.type === 'MULTI' && q.options.map((o) => {
            const list = Array.isArray(value) ? value : []
            return (
              <label key={o.i} className={`flex min-h-[48px] items-center gap-3 rounded-xl border px-3 py-2 text-[15px] ${list.includes(o.i) ? 'border-brand-500 bg-brand-50' : 'border-border'}`}>
                <input type="checkbox" checked={list.includes(o.i)} onChange={() => save(q.index, list.includes(o.i) ? list.filter((x) => x !== o.i) : [...list, o.i])} className="rounded border-border text-brand-500" />{o.text}
              </label>
            )
          })}
          {q.type === 'MULTI' && <p className="text-xs text-ink-faint">{t('family.tests.pickAll')}</p>}
          {['FILL', 'SHORT'].includes(q.type) && <input value={value ?? ''} onChange={(e) => save(q.index, e.target.value, 800)} className="w-full min-h-[48px] rounded-xl border border-border px-3 text-sm" aria-label={t('family.tests.yourAnswer')} />}
          {q.type === 'LONG' && <textarea rows={8} value={value ?? ''} onChange={(e) => save(q.index, e.target.value, 1200)} className="w-full rounded-xl border border-border p-3 text-sm" aria-label={t('family.tests.yourAnswer')} />}
          {value !== undefined && value !== null && value !== '' && ['MCQ', 'TRUE_FALSE'].includes(q.type) && <button type="button" onClick={() => save(q.index, null)} className="min-h-[40px] text-sm text-ink-muted underline">{t('family.tests.clear')}</button>}
        </div>
      </FCard>
      <div className="flex items-center justify-between gap-2">
        <button type="button" disabled={!at} onClick={() => setAt(at - 1)} className="inline-flex min-h-[48px] items-center gap-1 rounded-xl border border-border px-4 text-sm disabled:opacity-40"><ChevronLeft className="w-4 h-4" />{t('family.tests.prev')}</button>
        {at < p.questions.length - 1
          ? <button type="button" onClick={() => setAt(at + 1)} className="inline-flex min-h-[48px] items-center gap-1 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white">{t('family.tests.next')}<ChevronRight className="w-4 h-4" /></button>
          : <button type="button" disabled={submit.isPending} onClick={async () => { if (await confirm({ title: t('family.tests.submitTitle'), message: t('family.tests.submitHint', { done, total: p.questions.length }), confirmLabel: t('family.tests.submit') })) submit.mutate() }} className="min-h-[48px] rounded-xl bg-success-600 px-5 text-sm font-medium text-white">{t('family.tests.submit')}</button>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.questions.map((x, i) => {
          const a = answers[x.index]
          const filled = a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length)
          return <button key={x.index} type="button" onClick={() => setAt(i)} aria-label={t('family.tests.goTo', { n: i + 1 })} className={`h-10 w-10 rounded-lg text-sm font-medium ${i === at ? 'ring-2 ring-brand-500' : ''} ${filled ? 'bg-brand-600 text-white' : 'bg-black/[0.06] text-ink'}`}>{i + 1}</button>
        })}
      </div>
    </>
  )
}

const STATE_TONE = { OPEN: 'success', LATER: 'info', CLOSED: 'neutral' }

/** The student's online tests: what is open, what is coming, results — filtered by state when there is a mix. */
export default function FamilyTests() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const { date } = useFormat()
  const [writing, setWriting] = useState(null)
  const [result, setResult] = useState(null)
  const [startError, setStartError] = useState(null)
  const [state, setState] = useState('')
  const { data: d, isLoading, error } = useFamilyQuery(['tests'], () => familyTests(slug, studentId))
  const start = useMutation({ mutationFn: (testId) => familyStartTest(slug, studentId, testId), onSuccess: (a) => { setStartError(null); qc.setQueryData(['family', slug, studentId, 'attempt', a.id], a); setWriting(a.id) }, onError: (e) => setStartError(e.message) })
  const finish = (id) => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setWriting(null); setResult(id); qc.invalidateQueries({ queryKey: ['family', slug, studentId, 'tests'] }) }
  useEffect(() => { setState(''); setResult(null) }, [studentId])
  if (writing) return <Paper attemptId={writing} onDone={finish} />
  if (result) return <Result attemptId={result} onBack={() => setResult(null)} />
  if (isLoading) return <FSkeleton className="h-64" />
  if (error) return <FError error={error} />
  if (!d.tests.length) return <FCard><FEmpty icon={ClipboardCheck} title={t('family.tests.none')} /></FCard>
  const counts = d.tests.reduce((m, x) => ({ ...m, [x.state]: (m[x.state] ?? 0) + 1 }), {})
  const states = ['OPEN', 'LATER', 'CLOSED'].filter((k) => counts[k])
  const rows = state ? d.tests.filter((x) => x.state === state) : d.tests
  return (
    <>
      {states.length > 1 && (
        <PillRow>
          <button type="button" onClick={() => setState('')} aria-pressed={!state} className={pillClass(!state)}>{t('family.tests.all')} <span className="tabular-nums opacity-70">{d.tests.length}</span></button>
          {states.map((k) => <button key={k} type="button" onClick={() => setState(k)} aria-pressed={state === k} className={pillClass(state === k)}>{t(`family.tests.states.${k}`)} <span className="tabular-nums opacity-70">{counts[k]}</span></button>)}
        </PillRow>
      )}
      {startError && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{startError}</p>}
      {rows.map((x) => (
        <FCard key={x.id}>
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-xs font-semibold uppercase tracking-wide text-brand-600 break-words">{x.subject}</p>
            <StatusPill tone={STATE_TONE[x.state]}>{t(`family.tests.states.${x.state}`)}</StatusPill>
          </div>
          <p className="mt-1 text-[17px] font-semibold leading-snug text-ink break-words">{x.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2.5 py-1"><ListChecks className="h-3.5 w-3.5" aria-hidden />{t('family.tests.questions', { count: x.questions })}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2.5 py-1"><Award className="h-3.5 w-3.5" aria-hidden />{t('family.tests.marks', { count: x.totalMarks })}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2.5 py-1"><Clock className="h-3.5 w-3.5" aria-hidden />{t('family.tests.minutes', { count: x.durationMin })}</span>
          </div>
          <p className={`mt-2 text-sm ${x.state === 'OPEN' ? 'font-medium text-ink' : 'text-ink-muted'}`}>{x.state === 'LATER' ? t('family.tests.opensOn', { when: `${date(x.opens.date)} ${x.opens.time}` }) : x.state === 'OPEN' ? t('family.tests.openUntil', { when: `${date(x.closes.date)} ${x.closes.time}` }) : t('family.tests.closed')}</p>
          {x.instructions && x.state === 'OPEN' && <p className="mt-2 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-ink whitespace-pre-line break-words">{x.instructions}</p>}
          {(x.canStart || x.last) && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {x.canStart && <button type="button" disabled={start.isPending} onClick={() => start.mutate(x.id)} className="min-h-[48px] rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 sm:min-w-[160px]">{x.inProgress ? t('family.tests.carryOn') : t('family.tests.start')}</button>}
              {x.last && <button type="button" onClick={() => setResult(x.last.id)} className="inline-flex min-h-[48px] items-center justify-center gap-1 rounded-xl border border-border px-4 text-sm font-medium text-ink hover:bg-black/[0.02]">{x.last.released ? t('family.tests.seeResult', { total: x.last.score?.total ?? 0, max: x.totalMarks }) : t('family.tests.submitted')}<ChevronRight className="h-4 w-4 text-ink-faint rtl:rotate-180" aria-hidden /></button>}
            </div>
          )}
          {x.attemptsAllowed > 1 && <p className="mt-2 text-xs text-ink-faint">{t('family.tests.attempts', { used: x.attemptsUsed, allowed: x.attemptsAllowed })}</p>}
        </FCard>
      ))}
    </>
  )
}
