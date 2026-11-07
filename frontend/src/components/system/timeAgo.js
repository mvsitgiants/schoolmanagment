import { useTranslation } from 'react-i18next'

/**
 * "5 minutes ago" / "yesterday" / "in 3 months" in the UI language — Intl does the wording,
 * so no locale keys are needed. Works both ways (past and future), e.g. for expiry dates.
 *
 *   const ago = useTimeAgo();  ago(row.createdAt)
 */
export function useTimeAgo() {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en-GB' : `${lang}-IN`, { numeric: 'auto' })
  return (at) => {
    if (!at) return ''
    const ms = new Date(at).getTime()
    if (Number.isNaN(ms)) return ''
    const secs = Math.round((ms - Date.now()) / 1000)
    const abs = Math.abs(secs)
    if (abs < 60) return rtf.format(0, 'second')
    if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute')
    if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour')
    if (abs < 86400 * 45) return rtf.format(Math.round(secs / 86400), 'day')
    if (abs < 86400 * 548) return rtf.format(Math.round(secs / (86400 * 30.44)), 'month')
    return rtf.format(Math.round(secs / (86400 * 365.25)), 'year')
  }
}

/** Whole days from now to a date (negative = past). */
export const daysUntil = (at) => (at ? Math.floor((new Date(at).getTime() - Date.now()) / 86400e3) : null)
