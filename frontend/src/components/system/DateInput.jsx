import clsx from 'clsx'
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { fieldBase } from './Form'
import { useSettings } from '../../context/SettingsContext'
import { getFormatConfig } from '../../utils/format'

/**
 * The app's one date picker — a drop-in for `<input type="date">` / `<Input type="date">`.
 *
 *   <DateInput value={form.dob} max={today} onChange={(e) => set('dob', e.target.value)} />
 *
 * value is 'YYYY-MM-DD' or ''; onChange gets `{ target: { value, name, id } }` like a native input.
 * The box shows the date in the institution's format and accepts a typed date in that format;
 * the calendar opens as a popover (a bottom sheet on phones). Monday-first weeks.
 */

// ── date helpers (all on 'YYYY-MM-DD' strings, UTC maths so no timezone/DST drift) ──
const pad = (n) => String(n).padStart(2, '0')
const toIso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m + 1)}-${pad(d)}`
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const split = (iso) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) })
const utc = (y, m, d) => new Date(Date.UTC(y, m, d))
const fromUtc = (dt) => toIso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
const daysIn = (y, m) => utc(y, m + 1, 0).getUTCDate()
const addDays = (iso, n) => { const { y, m, d } = split(iso); return fromUtc(utc(y, m, d + n)) }
const addMonths = (iso, n) => {
  const { y, m, d } = split(iso)
  const first = utc(y, m + n, 1)
  return toIso(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, daysIn(first.getUTCFullYear(), first.getUTCMonth())))
}
const withYear = (iso, y) => { const { m, d } = split(iso); return toIso(y, m, Math.min(d, daysIn(y, m))) }
const withMonth = (iso, m) => { const { y, d } = split(iso); return toIso(y, m, Math.min(d, daysIn(y, m))) }
const clean = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : '')
const clamp = (iso, min, max) => (min && iso < min ? min : max && iso > max ? max : iso)
const outside = (iso, min, max) => (!!min && iso < min) || (!!max && iso > max)

/** Today in the institution's timezone. */
function todayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: getFormatConfig().timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    const n = new Date()
    return toIso(n.getFullYear(), n.getMonth(), n.getDate())
  }
}

const PLACEHOLDER_KEY = { 'DD/MM/YYYY': 'dmy', 'MM/DD/YYYY': 'mdy', 'YYYY-MM-DD': 'ymd', 'DD-MMM-YYYY': 'dmmmy' }
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthNames(lang, style) {
  const f = new Intl.DateTimeFormat(lang, { month: style, timeZone: 'UTC' })
  return Array.from({ length: 12 }, (_, m) => f.format(utc(2024, m, 1)))
}

/**
 * A typed date in the institution's format → ISO. '' for empty, null when it isn't a date.
 * `complete` asks for a four-digit year (used while typing, so "1/2/20" doesn't commit early).
 */
function parseTyped(text, fmt, lang, complete = false) {
  const s = text.trim()
  if (!s) return ''
  const parts = s.split(/[^0-9\p{L}]+/u).filter(Boolean)
  if (parts.length !== 3) return null
  const shortNames = monthNames(lang, 'short').map((n) => n.toLowerCase().replace(/\.$/, ''))
  const monthOf = (tok) => {
    if (/^\d{1,2}$/.test(tok)) return Number(tok) - 1
    const low = tok.toLowerCase()
    const i = shortNames.findIndex((n) => n && low.startsWith(n.slice(0, 3)))
    return i >= 0 ? i : EN_MONTHS.indexOf(low.slice(0, 3))
  }
  let y, m, d
  if (/^\d{4}$/.test(parts[0])) [y, m, d] = [parts[0], monthOf(parts[1]), parts[2]]
  else if (fmt === 'MM/DD/YYYY') [m, d, y] = [monthOf(parts[0]), parts[1], parts[2]]
  else [d, m, y] = [parts[0], monthOf(parts[1]), parts[2]]
  if (!/^\d{1,2}$/.test(d) || !(complete ? /^\d{4}$/ : /^(\d{2}|\d{4})$/).test(y)) return null
  let year = Number(y)
  if (y.length === 2) {
    const now = new Date().getFullYear()
    year += 2000 + year > now + 10 ? 1900 : 2000
  }
  const day = Number(d)
  if (!(m >= 0 && m <= 11) || day < 1 || day > daysIn(year, m) || year < 1000) return null
  return toIso(year, m, day)
}

// Classes that place the field in its row/grid go on the wrapper; the rest style the box itself.
const LAYOUT_CLASS = /^(w-|min-w-|max-w-|col-|row-|order-|flex-|shrink|grow|basis-|-?m[trblxyse]?-|self-|justify-self|place-self|hidden$|block$|inline|contents$|absolute$|relative$|sticky$|top-|left-|right-|bottom-|inset-|start-|end-|z-)/
function splitClasses(className) {
  const wrap = []
  const box = []
  String(className ?? '').split(/\s+/).filter(Boolean).forEach((c) => {
    const base = c.slice(c.lastIndexOf(':') + 1).replace(/^!/, '')
    ;(LAYOUT_CLASS.test(base) ? wrap : box).push(c)
  })
  return { wrap: wrap.join(' '), box: box.join(' ') }
}
const ownWidth = /(^|\s)(\S+:)?!?w-/

function useIsPhone() {
  const query = '(max-width: 639px)'
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setPhone(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}

// ── the popover / bottom sheet shell ──
function Popover({ open, anchorRef, onClose, sheet, layoutKey, label, children }) {
  const { t } = useTranslation('ui')
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!open || sheet) { setPos(null); return undefined }
    const update = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const p = panelRef.current
      if (!a || !p) return
      const w = p.offsetWidth
      const h = p.offsetHeight
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      const gap = 4
      const edge = 8
      let top = a.bottom + gap
      if (top + h > vh - edge) top = a.top - gap - h >= edge ? a.top - gap - h : Math.max(edge, vh - edge - h)
      const rtl = document.documentElement.dir === 'rtl'
      const left = Math.min(Math.max(edge, rtl ? a.right - w : a.left), Math.max(edge, vw - edge - w))
      setPos({ top, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, sheet, layoutKey, anchorRef])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (anchorRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose, anchorRef])

  if (!open) return null
  // Keep focus on the text box (typing + keyboard keep working) and don't let a mousedown in here
  // reach document listeners — otherwise a host popover / Select would treat it as an outside click.
  const guard = {
    onMouseDown: (e) => { e.preventDefault(); e.stopPropagation() },
    onClick: (e) => e.stopPropagation(),
  }
  if (sheet) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-end" {...guard}>
        <div className="absolute inset-0 bg-navy-900/40" onClick={onClose} />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label}
          className="relative w-full bg-surface rounded-t-2xl shadow-pop px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)]">
          <div className="flex items-center justify-between mb-1">
            <span className="mx-auto h-1 w-10 rounded-full bg-border" aria-hidden="true" />
            <button type="button" onClick={onClose} aria-label={t('ui.datePicker.close')}
              className="absolute end-2 top-2 p-2 rounded-md text-ink-faint hover:bg-bg"><X size={16} /></button>
          </div>
          <div className="max-w-sm mx-auto">{children}</div>
        </div>
      </div>,
      document.body,
    )
  }
  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={label} {...guard}
      style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className="z-[60] w-72 max-w-[calc(100vw-16px)] bg-surface border border-border rounded-lg shadow-pop p-2">
      {children}
    </div>,
    document.body,
  )
}

// ── the month / months / years grid ──
function Calendar({ active, setActive, view, setView, today, min, max, onPick, isSelected, inRange, onHover, footer }) {
  const { t, i18n } = useTranslation('ui')
  const lang = i18n.language || undefined
  const { y, m } = split(active)
  const longMonths = useMemo(() => monthNames(lang, 'long'), [lang])
  const shortMonths = useMemo(() => monthNames(lang, 'short'), [lang])
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) => f.format(utc(2024, 0, 1 + i))) // 1 Jan 2024 was a Monday
  }, [lang])
  const fullDate = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' }), [lang])
  const yearFmt = useMemo(() => new Intl.DateTimeFormat(lang, { year: 'numeric', timeZone: 'UTC' }), [lang])
  const yearLabel = (yy) => yearFmt.format(utc(yy, 6, 1))

  const minY = min ? split(min).y : -Infinity
  const maxY = max ? split(max).y : Infinity
  const monthOut = (yy, mm) => (!!max && toIso(yy, mm, 1) > max) || (!!min && toIso(yy, mm, daysIn(yy, mm)) < min)
  const blockStart = Math.floor(y / 12) * 12

  let title
  let prev
  let next
  let prevOff
  let nextOff
  let prevLabel
  let nextLabel
  if (view === 'days') {
    title = `${longMonths[m]} ${yearLabel(y)}`
    prev = () => setActive(clamp(addMonths(active, -1), min, max))
    next = () => setActive(clamp(addMonths(active, 1), min, max))
    const pm = split(addMonths(toIso(y, m, 1), -1))
    const nm = split(addMonths(toIso(y, m, 1), 1))
    prevOff = monthOut(pm.y, pm.m)
    nextOff = monthOut(nm.y, nm.m)
    prevLabel = t('ui.datePicker.prevMonth')
    nextLabel = t('ui.datePicker.nextMonth')
  } else if (view === 'months') {
    title = yearLabel(y)
    prev = () => setActive(withYear(active, y - 1))
    next = () => setActive(withYear(active, y + 1))
    prevOff = y - 1 < minY
    nextOff = y + 1 > maxY
    prevLabel = t('ui.datePicker.prevYear')
    nextLabel = t('ui.datePicker.nextYear')
  } else {
    title = `${yearLabel(blockStart)} – ${yearLabel(blockStart + 11)}`
    prev = () => setActive(withYear(active, y - 12))
    next = () => setActive(withYear(active, y + 12))
    prevOff = blockStart - 1 < minY
    nextOff = blockStart + 12 > maxY
    prevLabel = t('ui.datePicker.prevYears')
    nextLabel = t('ui.datePicker.nextYears')
  }

  const navBtn = 'h-8 w-8 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-bg disabled:opacity-30 disabled:hover:bg-transparent'
  const cellBase = 'text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30'

  // 6 weeks from the Monday on or before the 1st
  const lead = (utc(y, m, 1).getUTCDay() + 6) % 7
  const start = addDays(toIso(y, m, 1), -lead)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div onMouseLeave={() => onHover?.(null)}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <button type="button" className={navBtn} onClick={prev} disabled={prevOff} aria-label={prevLabel}><ChevronLeft size={16} className="rtl:rotate-180" /></button>
        <button type="button"
          onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
          aria-label={view === 'days' ? t('ui.datePicker.chooseMonth') : view === 'months' ? t('ui.datePicker.chooseYear') : t('ui.datePicker.backToDays')}
          className="flex-1 inline-flex items-center justify-center gap-1 h-8 [@media(pointer:coarse)]:h-10 rounded-md text-sm font-semibold text-ink hover:bg-bg">
          {title}
          <ChevronDown size={14} className={clsx('text-ink-faint transition-transform', view !== 'days' && 'rotate-180')} />
        </button>
        <button type="button" className={navBtn} onClick={next} disabled={nextOff} aria-label={nextLabel}><ChevronRight size={16} className="rtl:rotate-180" /></button>
      </div>

      {view === 'days' && (
        <div>
          <div className="grid grid-cols-7 mb-0.5" aria-hidden="true">
            {weekdays.map((w, i) => <span key={i} className="text-center text-[11px] font-medium text-ink-faint py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((iso) => {
              const day = split(iso)
              const off = outside(iso, min, max)
              const sel = isSelected(iso)
              const band = !sel && inRange?.(iso)
              return (
                <button key={iso} type="button" tabIndex={-1} disabled={off}
                  aria-pressed={sel} aria-current={iso === today ? 'date' : undefined}
                  aria-label={fullDate.format(utc(day.y, day.m, day.d))}
                  onClick={() => onPick(iso)}
                  onMouseEnter={() => onHover?.(iso)}
                  className={clsx(
                    cellBase,
                    'h-9 [@media(pointer:coarse)]:h-10 w-full',
                    band ? 'rounded-none' : 'rounded-md',
                    sel ? 'bg-brand-500 text-white font-semibold'
                      : band ? 'bg-brand-50 text-ink'
                        : day.m !== m ? 'text-ink-faint hover:bg-bg' : 'text-ink hover:bg-bg',
                    !sel && iso === today && 'ring-1 ring-inset ring-brand-500 text-brand-700 font-medium',
                    !sel && !band && iso === active && 'bg-bg',
                  )}>
                  {day.d}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-1 py-1">
          {shortMonths.map((name, mm) => (
            <button key={name} type="button" disabled={monthOut(y, mm)} aria-label={`${longMonths[mm]} ${yearLabel(y)}`}
              onClick={() => { setActive(clamp(withMonth(active, mm), min, max)); setView('days') }}
              className={clsx(cellBase, 'h-11 rounded-md',
                mm === m ? 'bg-brand-500 text-white font-semibold' : 'text-ink hover:bg-bg',
                mm !== m && today.startsWith(toIso(y, mm, 1).slice(0, 7)) && 'ring-1 ring-inset ring-brand-500')}>
              {name}
            </button>
          ))}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-1 py-1">
          {Array.from({ length: 12 }, (_, i) => blockStart + i).map((yy) => (
            <button key={yy} type="button" disabled={yy < minY || yy > maxY}
              onClick={() => { setActive(clamp(withYear(active, yy), min, max)); setView('months') }}
              className={clsx(cellBase, 'h-11 rounded-md',
                yy === y ? 'bg-brand-500 text-white font-semibold' : 'text-ink hover:bg-bg',
                yy !== y && String(yy) === today.slice(0, 4) && 'ring-1 ring-inset ring-brand-500')}>
              {yearLabel(yy)}
            </button>
          ))}
        </div>
      )}

      {footer && <div className="flex items-center justify-between gap-2 border-t border-border mt-2 pt-2">{footer}</div>}
    </div>
  )
}

/** Arrow / Page keys on the day grid. Returns the new active date, or null when the key isn't ours. */
function moveKey(key, shift, active, rtl) {
  const back = rtl ? 1 : -1
  switch (key) {
    case 'ArrowLeft': return addDays(active, back)
    case 'ArrowRight': return addDays(active, -back)
    case 'ArrowUp': return addDays(active, -7)
    case 'ArrowDown': return addDays(active, 7)
    case 'PageUp': return shift ? addMonths(active, -12) : addMonths(active, -1)
    case 'PageDown': return shift ? addMonths(active, 12) : addMonths(active, 1)
    case 'Home': { const { y, m } = split(active); return toIso(y, m, 1) }
    case 'End': { const { y, m } = split(active); return toIso(y, m, daysIn(y, m)) }
    default: return null
  }
}

const footerBtn = 'px-2.5 py-1.5 [@media(pointer:coarse)]:py-2.5 rounded-md text-sm font-medium hover:bg-bg disabled:opacity-40 disabled:hover:bg-transparent'

// ── DateInput ──
const DateInput = forwardRef(function DateInput({
  value, defaultValue, onChange, min, max, disabled, readOnly, required, name, id, placeholder, className, error,
  onBlur, onKeyDown, onFocus, ...rest
}, ref) {
  const { t, i18n } = useTranslation('ui')
  const { format } = useSettings()
  const lang = i18n.language || undefined
  const phone = useIsPhone()
  const lo = clean(min)
  const hi = clean(max)

  const controlled = value !== undefined
  const [internal, setInternal] = useState(() => clean(defaultValue))
  const current = clean(controlled ? value : internal)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState('days')
  const [active, setActive] = useState(() => current || clamp(todayIso(), lo, hi))
  const [text, setText] = useState(null) // null = show the formatted value
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const setRefs = useCallback((node) => {
    inputRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])

  const emit = (next) => {
    if (next === current) return
    if (!controlled) setInternal(next)
    const target = { value: next, name, id }
    onChange?.({ target, currentTarget: target, preventDefault() {}, stopPropagation() {} })
  }

  const locked = disabled || readOnly
  const openPanel = () => {
    if (locked || open) return
    setActive(current || clamp(todayIso(), lo, hi))
    setView('days')
    setOpen(true)
  }
  const close = useCallback(() => { setOpen(false); setView('days') }, [])
  const pick = (iso) => {
    if (outside(iso, lo, hi)) return
    emit(iso)
    setText(null)
    close()
  }

  const commitText = () => {
    if (text === null) return
    const parsed = parseTyped(text, format.dateFormat, lang)
    if (parsed === '') { if (!required) emit('') }
    else if (parsed && !outside(parsed, lo, hi)) emit(parsed)
    setText(null)
  }

  const handleKey = (e) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || locked) return
    if (!open) {
      if (e.key === 'ArrowDown' || (e.key === 'Enter' && text === null) || (e.key === ' ' && phone)) { e.preventDefault(); openPanel() }
      else if (e.key === 'Enter') { e.preventDefault(); commitText() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { close(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (view !== 'days') { setView('days'); return }
      const typed = text !== null ? parseTyped(text, format.dateFormat, lang) : null
      if (typed) pick(typed)
      else pick(active)
      return
    }
    if (view !== 'days') return
    const next = moveKey(e.key, e.shiftKey, active, document.documentElement.dir === 'rtl')
    if (next) { e.preventDefault(); setActive(clamp(next, lo, hi)) }
  }

  const onType = (e) => {
    const s = e.target.value
    setText(s)
    const parsed = parseTyped(s, format.dateFormat, lang, true)
    if (parsed && !outside(parsed, lo, hi)) { setActive(parsed); emit(parsed) }
  }

  const { wrap, box } = splitClasses(className)
  const showClear = !!current && !required && !locked
  const display = text ?? (current ? format.date(current) : '')
  const today = todayIso()
  const todayOff = outside(today, lo, hi)

  return (
    <div ref={rootRef} className={clsx('relative', !ownWidth.test(wrap) && 'w-full', wrap)}>
      <input
        ref={setRefs}
        type="text"
        id={id}
        autoComplete="off"
        inputMode={format.dateFormat === 'DD-MMM-YYYY' ? 'text' : 'numeric'}
        aria-haspopup="dialog"
        aria-expanded={open}
        required={required}
        disabled={disabled}
        readOnly={readOnly || phone}
        placeholder={placeholder ?? t(`ui.datePicker.placeholder.${PLACEHOLDER_KEY[format.dateFormat] ?? 'dmy'}`)}
        value={display}
        onChange={onType}
        onClick={openPanel}
        onFocus={onFocus}
        onKeyDown={handleKey}
        onBlur={(e) => { commitText(); onBlur?.(e) }}
        className={clsx(fieldBase, 'w-full', showClear ? 'pe-14' : 'pe-9', !phone && !locked && 'cursor-text', phone && !locked && 'cursor-pointer',
          error && 'border-danger-500 focus:ring-danger-500/20 focus:border-danger-500', box)}
        {...rest}
      />
      {name && <input type="hidden" name={name} value={current} />}
      <div className="absolute inset-y-0 end-1 flex items-center">
        {showClear && (
          <button type="button" tabIndex={-1} aria-label={t('ui.datePicker.clearDate')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setText(null); emit(''); close() }}
            className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg"><X size={14} /></button>
        )}
        <button type="button" tabIndex={-1} disabled={locked} aria-label={t('ui.datePicker.open')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (open) close(); else { inputRef.current?.focus(); openPanel() } }}
          className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg disabled:hover:bg-transparent">
          <CalendarDays size={15} />
        </button>
      </div>
      <Popover open={open} anchorRef={rootRef} onClose={close} sheet={phone} layoutKey={view} label={t('ui.datePicker.calendar')}>
        <div onKeyDown={handleKey}>
          <Calendar
            active={active} setActive={setActive} view={view} setView={setView} today={today} min={lo} max={hi}
            onPick={pick} isSelected={(iso) => iso === current}
            footer={(
              <>
                <button type="button" className={clsx(footerBtn, 'text-brand-700')} disabled={todayOff} onClick={() => pick(today)}>{t('ui.datePicker.today')}</button>
                {!required && <button type="button" className={clsx(footerBtn, 'text-ink-muted')} disabled={!current} onClick={() => { setText(null); emit(''); close() }}>{t('ui.datePicker.clear')}</button>}
              </>
            )}
          />
        </div>
      </Popover>
    </div>
  )
})
// FormField ties its label / error to this like it does for Input.
DateInput.formField = true

export default DateInput

/**
 * From–to in one popover: first click sets the start, second the end (the band between is shaded).
 * value is `{ from, to }` ('YYYY-MM-DD' or ''); onChange receives `{ from, to }`.
 */
export const DateRangeInput = forwardRef(function DateRangeInput({
  value, onChange, min, max, disabled, required, placeholder, className, error, id, ...rest
}, ref) {
  const { t } = useTranslation('ui')
  const { format } = useSettings()
  const phone = useIsPhone()
  const lo = clean(min)
  const hi = clean(max)
  const from = clean(value?.from)
  const to = clean(value?.to)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState('days')
  const [active, setActive] = useState(() => from || clamp(todayIso(), lo, hi))
  const [anchor, setAnchor] = useState(null)
  const [hover, setHover] = useState(null)
  const rootRef = useRef(null)

  const close = useCallback(() => { setOpen(false); setView('days'); setAnchor(null); setHover(null) }, [])
  const openPanel = () => {
    if (disabled || open) return
    setActive(from || clamp(todayIso(), lo, hi))
    setOpen(true)
  }
  const pick = (iso) => {
    if (outside(iso, lo, hi)) return
    if (!anchor) { setAnchor(iso); setActive(iso); return }
    const [a, b] = iso < anchor ? [iso, anchor] : [anchor, iso]
    onChange?.({ from: a, to: b })
    close()
  }

  const lit = anchor ? [anchor, hover || active].sort() : [from, to]
  const isSelected = (iso) => (anchor ? iso === anchor : iso === from || iso === to)
  const inRange = (iso) => !!lit[0] && !!lit[1] && iso > lit[0] && iso < lit[1]

  const handleKey = (e) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { close(); return }
    if (e.key === 'Enter') { e.preventDefault(); if (view !== 'days') setView('days'); else pick(active); return }
    if (view !== 'days') return
    const next = moveKey(e.key, e.shiftKey, active, document.documentElement.dir === 'rtl')
    if (next) { e.preventDefault(); setActive(clamp(next, lo, hi)); setHover(null) }
  }

  const { wrap, box } = splitClasses(className)
  const label = from && to ? (from === to ? format.date(from) : `${format.date(from)} – ${format.date(to)}`) : ''
  const today = todayIso()
  const showClear = !!(from || to) && !required && !disabled

  return (
    <div ref={rootRef} className={clsx('relative', !ownWidth.test(wrap) && 'w-full', wrap)}>
      <input
        ref={ref}
        type="text"
        id={id}
        readOnly
        disabled={disabled}
        required={required}
        aria-haspopup="dialog"
        aria-expanded={open}
        value={label}
        placeholder={placeholder ?? t('ui.datePicker.rangePlaceholder')}
        onClick={openPanel}
        onKeyDown={handleKey}
        className={clsx(fieldBase, 'w-full cursor-pointer', showClear ? 'pe-14' : 'pe-9', error && 'border-danger-500', box)}
        {...rest}
      />
      <div className="absolute inset-y-0 end-1 flex items-center">
        {showClear && (
          <button type="button" tabIndex={-1} aria-label={t('ui.datePicker.clearDate')} onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange?.({ from: '', to: '' }); close() }}
            className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg"><X size={14} /></button>
        )}
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={t('ui.datePicker.open')} onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : openPanel())}
          className="p-1 rounded text-ink-faint hover:text-ink hover:bg-bg"><CalendarDays size={15} /></button>
      </div>
      <Popover open={open} anchorRef={rootRef} onClose={close} sheet={phone} layoutKey={`${view}${anchor ? 1 : 0}`} label={t('ui.datePicker.calendar')}>
        <div onKeyDown={handleKey}>
          <p className="text-xs text-ink-muted text-center mb-1">{anchor ? t('ui.datePicker.pickEnd') : t('ui.datePicker.pickStart')}</p>
          <Calendar
            active={active} setActive={setActive} view={view} setView={setView} today={today} min={lo} max={hi}
            onPick={pick} isSelected={isSelected} inRange={inRange} onHover={anchor ? setHover : undefined}
            footer={!required ? (
              <>
                <span />
                <button type="button" className={clsx(footerBtn, 'text-ink-muted')} disabled={!from && !to && !anchor}
                  onClick={() => { onChange?.({ from: '', to: '' }); close() }}>{t('ui.datePicker.clear')}</button>
              </>
            ) : null}
          />
        </div>
      </Popover>
    </div>
  )
})
DateRangeInput.formField = true
