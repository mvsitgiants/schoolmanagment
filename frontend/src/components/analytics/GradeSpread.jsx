import { useTranslation } from 'react-i18next'
import { ChartCard, ColorChip, StackedBar } from '../system'

// Grades are ordered (best first), so they take one hue from dark to light — never a rainbow.
const RAMP = ['#0C4A6E', '#075985', '#0369A1', '#0284C7', '#0EA5E9', '#38BDF8', '#7DD3FC', '#A5DCF7', '#C7E9FA']

/** A colour per grade, best darkest, spread over the ramp. */
export function gradeColors(grades = []) {
  const n = grades.length
  return Object.fromEntries(grades.map((g, i) => [g, RAMP[n <= 1 ? 3 : Math.round((i * (RAMP.length - 1)) / (n - 1))]]))
}

/** How each class's grades are spread: one stacked bar per class (Analytics › Academic performance). */
export default function GradeSpread({ classes = [], grades = [], className }) {
  const { t } = useTranslation('analytics')
  const colors = gradeColors(grades)
  const table = {
    columns: [{ key: 'name', label: t('analytics.academics.class') }, ...grades.map((g) => ({ key: g, label: g, align: 'right' }))],
    rows: classes.map((c) => ({ name: c.name, ...Object.fromEntries(grades.map((g) => [g, c.grades?.[g] ?? 0])) })),
  }
  return (
    <ChartCard title={t('analytics.academics.gradeSpread')} subtitle={t('analytics.academics.gradeSpreadSub')} table={table} className={className}>
      {classes.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-faint">{t('analytics.common.noData')}</p>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => (
            <div key={c.classId} className="grid grid-cols-[88px_1fr] items-center gap-3">
              <ColorChip label={c.name} seed={c.classId} dot className="truncate" />
              <StackedBar height={18} legend={false} total={c.assessed || undefined}
                segments={grades.map((g) => ({ label: g, value: c.grades?.[g] ?? 0, color: colors[g] }))} />
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 text-xs text-ink-muted border-t border-border/70">
            {grades.map((g) => (
              <span key={g} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[g] }} />
                <span className="font-medium text-ink">{g}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  )
}
