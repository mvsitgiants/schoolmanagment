import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '../system'

/** "Aug 2026" (or "August 2026" with `long`) from a YYYY-MM month, in the reader's language. */
export function useMonthLabel() {
  const { i18n } = useTranslation()
  return useCallback((ym, { long = false } = {}) => {
    if (!ym) return ''
    const [y, m] = ym.split('-').map(Number)
    return new Intl.DateTimeFormat(i18n.language || 'en', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
  }, [i18n.language])
}

/** "Mon", "Tue"… for a YYYY-MM-DD date, in the reader's language. */
export function useWeekdayLabel() {
  const { i18n } = useTranslation()
  return useCallback((ymd) => new Intl.DateTimeFormat(i18n.language || 'en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`)), [i18n.language])
}

/** Pick a month of the academic year (`months` as YYYY-MM); the first option clears it. */
export function MonthSelect({ months = [], value, onChange, placeholder, error, className, 'aria-label': ariaLabel }) {
  const label = useMonthLabel()
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} error={error} className={className} aria-label={ariaLabel}>
      <option value="">{placeholder}</option>
      {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
    </Select>
  )
}
