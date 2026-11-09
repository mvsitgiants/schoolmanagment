import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CheckCircle2, Send, Star } from 'lucide-react'
import { SURVEY_STATUS } from '@schoolgiant/shared'
import { ColorChip, StatusPill, TONE, hueTone } from '../system'
import FormRenderer from '../forms/FormRenderer'

export function useSurveyLabels() {
  const { t } = useTranslation('surveys')
  return {
    audience: (v) => t(`surveys.audiences.${v}`, v ?? ''),
    state: (v) => t(`surveys.states.${v}`, v ?? ''),
  }
}

export function StatePill({ value }) {
  const L = useSurveyLabels()
  return <StatusPill tone={SURVEY_STATUS[value]?.tone}>{L.state(value)}</StatusPill>
}
const AUDIENCE_TONE = { PARENTS: 'sky', STUDENTS: 'violet', STAFF: 'orange', PUBLIC: 'teal' }
export function AudienceChip({ value }) {
  const L = useSurveyLabels()
  return <ColorChip label={L.audience(value)} tone={AUDIENCE_TONE[value] ?? 'neutral'} dot />
}

/** A response-rate bar: green from 70 %, amber from 40 %, red below. */
export function RateBar({ rate, responded, invited, className }) {
  const { t } = useTranslation('surveys')
  const pct = rate ?? 0
  const fill = rate == null ? 'bg-brand-500' : pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-muted tabular-nums">{invited != null ? t('surveys.common.ofInvited', { count: responded ?? 0, invited }) : t('surveys.common.responses', { count: responded ?? 0 })}</span>
        {rate != null && <span className="font-semibold text-ink tabular-nums">{pct}%</span>}
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/[0.06]"><div className={clsx('h-full rounded-full transition-all', fill)} style={{ width: `${rate == null ? Math.min(100, (responded ?? 0) * 5) : pct}%` }} /></div>
    </div>
  )
}

/**
 * Fill a survey: the questionnaire (form engine), the errors the server found, a submit button, then a thank-you.
 * `onSubmit(values)` returns a promise; a 400 with `fields` shows them on the questions.
 */
export function SurveyFill({ definition, onSubmit, submitted, compact = false }) {
  const { t } = useTranslation('surveys')
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (submitted) {
    return (
      <div className="py-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <p className="mt-3 text-base font-semibold text-ink">{t('surveys.fill.thanks')}</p>
        <p className="mt-1 text-sm text-ink-muted">{t('surveys.fill.thanksHint')}</p>
      </div>
    )
  }
  const submit = async () => {
    setBusy(true)
    setMessage('')
    try {
      await onSubmit(values)
      setErrors({})
    } catch (e) {
      setErrors(e?.fields ?? e?.response?.data?.details?.fields ?? {})
      setMessage(e?.message ?? '')
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <FormRenderer definition={definition} values={values} onChange={setValues} errors={errors} />
      {message && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{message}</p>}
      <button type="button" disabled={busy} onClick={submit}
        className={clsx('inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600 disabled:opacity-60', compact ? 'h-10 text-sm' : 'h-12 text-base')}>
        <Send className="h-4 w-4" />{busy ? t('surveys.fill.sending') : t('surveys.fill.submit')}
      </button>
    </div>
  )
}

/** One question's answers as a picture: choices as bars, ratings as an average with the spread, text as a list. */
export function QuestionChart({ q }) {
  const { t } = useTranslation('surveys')
  return (
    <div className="ui-panel rounded-2xl border border-border/80 bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{q.label}</p>
        <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">{t('surveys.common.answered', { count: q.answered })}</span>
      </div>
      {q.kind === 'CHOICE' && <ChoiceBars options={q.options} total={q.answered} />}
      {q.kind === 'RATING' && <RatingView q={q} />}
      {q.kind === 'NUMBER' && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['average', q.average], ['min', q.min], ['max', q.max]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg p-2"><p className="text-[11px] uppercase tracking-wide text-ink-faint">{t(`surveys.results.${k}`)}</p><p className="font-display text-xl font-bold text-ink tabular-nums">{v ?? '—'}</p></div>
          ))}
        </div>
      )}
      {q.kind === 'TEXT' && (q.answers?.length ? (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pe-1">
          {q.answers.map((a, i) => <li key={i} className="rounded-lg bg-bg px-3 py-2 text-sm text-ink whitespace-pre-wrap">{a}</li>)}
        </ul>
      ) : <p className="text-sm text-ink-faint">{t('surveys.results.noText')}</p>)}
    </div>
  )
}

function ChoiceBars({ options = [], total }) {
  const peak = Math.max(1, ...options.map((o) => o.count))
  return (
    <ul className="space-y-2">
      {options.map((o) => {
        const tone = TONE[o.value === 'YES' ? 'success' : o.value === 'NO' ? 'danger' : hueTone(o.label)]
        return (
          <li key={o.value}>
            <div className="flex items-baseline justify-between gap-2 text-xs"><span className="truncate text-ink">{o.label}</span><span className="tabular-nums text-ink-muted">{o.count}{total ? ` · ${Math.round((o.count / total) * 100)}%` : ''}</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-black/[0.05]"><div className={clsx('h-full rounded-full', tone.fill)} style={{ width: `${(o.count / peak) * 100}%` }} /></div>
          </li>
        )
      })}
    </ul>
  )
}

const RATING_FILL = ['bg-rose-500', 'bg-orange-400', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-500', 'bg-emerald-600']

function RatingView({ q }) {
  const { t } = useTranslation('surveys')
  const opts = [...(q.options ?? [])].sort((a, b) => a.points - b.points)
  const total = opts.reduce((n, o) => n + o.count, 0)
  const fill = (i) => RATING_FILL[Math.round((i / Math.max(1, opts.length - 1)) * (RATING_FILL.length - 1))]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><Star className="h-7 w-7 fill-current" /></span>
        <div>
          <p className="font-display text-2xl font-bold text-ink tabular-nums">{q.average ?? '—'}<span className="text-sm font-medium text-ink-faint"> / {q.max}</span></p>
          <p className="text-xs text-ink-muted">{t('surveys.results.averageScore')}</p>
        </div>
      </div>
      {total > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full bg-black/[0.05]">
          {opts.map((o, i) => o.count > 0 && <span key={o.label} className={fill(i)} style={{ width: `${(o.count / total) * 100}%` }} title={`${o.label}: ${o.count}`} />)}
        </div>
      )}
      <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {opts.map((o, i) => (
          <li key={o.label} className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 shrink-0 rounded-full', fill(i))} /><span className="truncate text-ink-muted">{o.label}</span><span className="ms-auto font-semibold tabular-nums text-ink">{o.count}</span></li>
        ))}
      </ul>
    </div>
  )
}
