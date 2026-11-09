import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Building2, Star } from 'lucide-react'
import { formatINRCompact } from '@schoolgiant/shared'
import { CodeBadge, PANEL, TONE } from '../system'
import PctBar from './PctBar'

function Figure({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint truncate">{label}</p>
      <div className="mt-1 text-ink">{children}</div>
    </div>
  )
}

/** One campus at a glance (Analytics › Campus comparison): strength, staff, and its four health figures. */
export default function CampusTile({ campus, minAttendance = 75 }) {
  const { t } = useTranslation('analytics')
  const c = campus
  return (
    <section className={clsx(PANEL, 'p-5 flex flex-col gap-4 min-w-0')} aria-label={c.name}>
      <header className="flex items-start gap-3 min-w-0">
        <span className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', TONE.brand.bg, TONE.brand.text)}>
          <Building2 className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-semibold text-ink tracking-tight truncate">{c.name}</h3>
          <p className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
            <CodeBadge>{c.code}</CodeBadge>
            {c.city && <span className="truncate">{c.city}</span>}
            {c.isDefault && <span className={clsx('inline-flex items-center gap-1', TONE.warning.text)}><Star className="w-3 h-3" />{t('analytics.campuses.main')}</span>}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Figure label={t('analytics.campuses.students')}><span className="font-display text-xl font-semibold tabular-nums">{c.students}</span></Figure>
        <Figure label={t('analytics.campuses.staff')}><span className="font-display text-xl font-semibold tabular-nums">{c.staff}</span></Figure>
        <Figure label={t('analytics.campuses.sections')}><span className="font-display text-xl font-semibold tabular-nums">{c.sections}</span></Figure>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-4">
        <Figure label={t('analytics.campuses.attendance')}><PctBar value={c.attendancePct} good={90} warn={minAttendance} width="w-full" align="start" /></Figure>
        <Figure label={t('analytics.campuses.result')}><PctBar value={c.resultPct} good={60} warn={40} width="w-full" align="start" /></Figure>
        <Figure label={t('analytics.campuses.collection')}><PctBar value={c.collectionPct} good={85} warn={60} width="w-full" align="start" /></Figure>
        <Figure label={t('analytics.campuses.outstanding')}>
          <span className={clsx('font-semibold tabular-nums', c.overdue > 0 ? TONE.danger.text : 'text-ink')}>{formatINRCompact(c.outstanding)}</span>
          {c.overdue > 0 && <span className="block text-[11px] text-ink-faint">{t('analytics.campuses.overdueSub', { amount: formatINRCompact(c.overdue) })}</span>}
        </Figure>
      </div>
    </section>
  )
}
