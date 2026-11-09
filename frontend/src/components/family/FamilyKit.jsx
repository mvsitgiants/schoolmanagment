import { createContext, useContext, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

// Building blocks of the parent & student app (/app/:slug): phone-first cards in the school's own
// brand colour (the brand-* tokens are re-pointed by applyBrandRamp). Ported from the hospital portal.

export const FamilyContext = createContext(null)
export const useFamily = () => useContext(FamilyContext)

/** A query of the signed-in family about the picked child. A 401 (session ended) goes back to sign-in. */
export function useFamilyQuery(key, fn, opts = {}) {
  const { slug, studentId } = useFamily()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['family', slug, studentId, ...key], queryFn: fn, retry: false, enabled: !!studentId, ...opts })
  const status = q.error?.status
  useEffect(() => { if (status === 401) qc.setQueryData(['family-me', slug], null) }, [status, qc, slug])
  return q
}

/** A narrow column that reads well on a 360 px phone (wider, still centred, on a desktop). */
export function FamilyShell({ children, className }) {
  return <div className={clsx('min-h-[100dvh] bg-bg', className)}><div className="max-w-lg md:max-w-2xl mx-auto px-4 pt-4 pb-28 space-y-4">{children}</div></div>
}

/** A plain white card with an optional title row. */
export function FCard({ children, className, title, action }) {
  return (
    <section className={clsx('rounded-2xl border border-border bg-surface min-w-0', className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4">
          {title && <h2 className="min-w-0 font-display text-base font-semibold text-ink break-words">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

/** A tappable row (≥ 64 px for a thumb). `href` opens a document or file in a new tab. */
export function FRow({ to, href, onClick, icon: Icon, tone, title, subtitle, meta, right }) {
  const body = (
    <>
      {Icon && <span className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tone === 'danger' ? 'bg-danger-50 text-danger-600' : tone === 'success' ? 'bg-success-50 text-success-600' : 'bg-black/[0.04] text-ink-muted')}><Icon className="w-5 h-5" aria-hidden /></span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-medium text-ink break-words">{title}</span>
        {subtitle && <span className="block mt-0.5 text-sm text-ink-muted break-words">{subtitle}</span>}
        {meta && <span className="block mt-0.5 text-xs text-ink-faint truncate">{meta}</span>}
      </span>
      {right}
      {(to || href || onClick) && <ChevronRight className="w-5 h-5 text-ink-faint shrink-0 rtl:rotate-180" aria-hidden />}
    </>
  )
  const cls = 'w-full min-h-[64px] flex items-center gap-3 px-1 py-3 text-start' // square: rows sit in divide-y lists, and rounding bent the dividers
  const tap = 'hover:bg-black/[0.02] active:bg-black/[0.04]'
  if (to) return <Link to={to} className={clsx(cls, tap)}>{body}</Link>
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={clsx(cls, tap)}>{body}</a>
  if (onClick) return <button type="button" onClick={onClick} className={clsx(cls, tap)}>{body}</button>
  return <div className={cls}>{body}</div>
}

export function FEmpty({ icon: Icon, title, hint }) {
  return (
    <div className="text-center py-8 px-2">
      {Icon && <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04] text-ink-faint"><Icon className="w-6 h-6" aria-hidden /></span>}
      <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-muted max-w-xs mx-auto break-words">{hint}</p>}
    </div>
  )
}

export const FSkeleton = ({ className = 'h-32' }) => <div className={clsx('rounded-2xl bg-black/[0.06] animate-pulse', className)} aria-busy="true" />

/** A query's error as a card (not a blank screen). */
export function FError({ error }) {
  const { t } = useTranslation('family')
  if (!error) return null
  return <FCard><p className="text-sm text-danger-700">{error.code === 'FEATURE_OFF' ? t('family.featureOff') : error.message}</p></FCard>
}

/** Which child the screens are about, when a parent has more than one at the school. */
export function ChildSwitcher({ students, value, onChange }) {
  const { t } = useTranslation('family')
  if (students.length < 2) return null
  return (
    <div className="flex gap-2 overflow-x-auto scroll-hide -mx-4 px-4 py-0.5" role="tablist" aria-label={t('family.whichChild')}>
      {students.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={value === s.id} onClick={() => onChange(s.id)}
          className={clsx('shrink-0 min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors', value === s.id ? 'border-brand-300 bg-brand-50 text-brand-700 font-semibold' : 'bg-surface border-border text-ink-muted hover:bg-black/[0.03] hover:text-ink')}>
          {s.firstName}{s.classShort ? <span className="ms-1 text-xs font-normal opacity-70">{s.classShort}</span> : null}
        </button>
      ))}
    </div>
  )
}
