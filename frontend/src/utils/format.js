// Tenant-aware formatting. SettingsContext calls configureFormat() once the
// tenant's settings load; every helper falls back to app defaults until then,
// so importing and calling these before login is safe.

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$' }

const cfg = {
  dateFormat: 'DD/MM/YYYY',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  locale: undefined, // browser default
}

export function configureFormat(partial = {}) {
  if (partial.dateFormat) cfg.dateFormat = partial.dateFormat
  if (partial.timezone) cfg.timezone = partial.timezone
  if (partial.currency) cfg.currency = partial.currency
  if (partial.locale) cfg.locale = partial.locale
}

export const getFormatConfig = () => ({ ...cfg })

const toDate = (v) => {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v) ? null : v
  // A bare "YYYY-MM-DD" is a calendar date — pin it to midday UTC so the
  // tenant timezone can't roll it to the previous/next day.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + 'T12:00:00Z')
    return isNaN(d) ? null : d
  }
  const d = new Date(v)
  return isNaN(d) ? null : d
}

const parts = (date, opts) => {
  const map = {}
  for (const p of new Intl.DateTimeFormat(cfg.locale || 'en-IN', { timeZone: cfg.timezone, ...opts }).formatToParts(date)) {
    map[p.type] = p.value
  }
  return map
}

/** Date only, honouring the tenant's dateFormat + timezone. */
export function formatDate(value) {
  const d = toDate(value)
  if (!d) return '—'
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const monShort = parts(d, { month: 'short' }).month
  switch (cfg.dateFormat) {
    case 'MM/DD/YYYY': return `${p.month}/${p.day}/${p.year}`
    case 'YYYY-MM-DD': return `${p.year}-${p.month}-${p.day}`
    case 'DD-MMM-YYYY': return `${p.day} ${monShort} ${p.year}`
    case 'DD/MM/YYYY':
    default: return `${p.day}/${p.month}/${p.year}`
  }
}

/** Date + time, honouring the tenant's dateFormat + timezone. */
export function formatDateTime(value, { seconds = false } = {}) {
  const d = toDate(value)
  if (!d) return '—'
  const t = parts(d, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true })
  const time = `${t.hour}:${t.minute}${seconds ? ':' + t.second : ''} ${t.dayPeriod}`.trim()
  return `${formatDate(d)}, ${time}`
}

/** Time only. */
export function formatTime(value, { seconds = false } = {}) {
  const d = toDate(value)
  if (!d) return '—'
  const t = parts(d, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true })
  return `${t.hour}:${t.minute}${seconds ? ':' + t.second : ''} ${t.dayPeriod}`.trim()
}

export function formatNumber(value, opts = {}) {
  if (value == null || value === '' || isNaN(Number(value))) return '—'
  return new Intl.NumberFormat(cfg.locale, opts).format(Number(value))
}

export function formatCurrency(value, { currency = cfg.currency, compact = false } = {}) {
  if (value == null || value === '' || isNaN(Number(value))) return '—'
  const n = Number(value)
  try {
    return new Intl.NumberFormat(cfg.locale, {
      // whole amounts without ".00" (₹55,000), paise shown when there are any (₹27,500.50)
      style: 'currency', currency, maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: compact || Number.isInteger(n) ? 0 : 2,
      notation: compact ? 'compact' : 'standard',
    }).format(n)
  } catch {
    const sym = CURRENCY_SYMBOL[currency] || `${currency} `
    return `${sym}${formatNumber(n, { maximumFractionDigits: compact ? 0 : 2 })}`
  }
}

export const currencySymbol = (c = cfg.currency) => CURRENCY_SYMBOL[c] || `${c} `
