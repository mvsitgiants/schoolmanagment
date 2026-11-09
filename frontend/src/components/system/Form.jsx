import clsx from 'clsx'
import { Children, Fragment, cloneElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

// An Input is full width unless the caller gives it one (`w-20`): without tailwind-merge both classes
// would apply and `w-full` wins, squeezing whatever sits beside it in a row to nothing.
const ownWidth = /(^|\s)w-/
// on a touch screen a field is 44px tall — a fingertip, not a mouse pointer (index.css sets its 16px text)
const fieldBase =
  'h-9 [@media(pointer:coarse)]:h-[44px] px-3 text-sm rounded-md border border-border bg-white text-ink placeholder:text-ink-faint ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:bg-bg disabled:text-ink-faint'

export const Label = ({ children, htmlFor, required }) => (
  <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-muted mb-1">
    {children} {required && <span className="text-danger-500" aria-hidden="true">*</span>}
  </label>
)

export const Input = forwardRef(function Input({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(fieldBase, !ownWidth.test(className ?? '') && 'w-full', error && 'border-danger-500 focus:ring-danger-500/20 focus:border-danger-500', className)}
      {...props}
    />
  )
})

/**
 * Drop-in replacement for a native <select> — same API (option children, value/defaultValue,
 * onChange receiving { target: { value, name } }) — but renders a type-to-filter combobox so
 * every dropdown in the app is searchable, long master-data lists included.
 */
export const Select = forwardRef(function Select({ className, error, children, value, defaultValue, onChange, disabled, name, placeholder, id, required, ...props }, ref) {
  const { t } = useTranslation('ui')
  // <optgroup> is flattened, keeping its label against each option so the panel can show a
  // heading. Before this, a group and everything inside it was silently dropped — the caller
  // wrote a perfectly ordinary grouped <select> and got an empty list.
  const options = useMemo(() => {
    const out = []
    const push = (node, group) => {
      if (!node || !node.props) return
      if (node.type === 'optgroup') {
        Children.toArray(node.props.children).forEach((child) => push(child, node.props.label))
        return
      }
      if (node.type !== 'option' && !('value' in node.props)) return
      // `<option>{name} ({count})</option>` gives an array of children; String(array)
      // joined it with commas ("Admin, (,2,)"). Flatten to plain text instead.
      const label = Children.toArray(node.props.children).map((c) => (typeof c === 'string' || typeof c === 'number' ? c : '')).join('')
      out.push({
        // Like a native <select>, an <option> without a value attribute uses its text.
        value: 'value' in node.props ? node.props.value : label,
        label,
        disabled: !!node.props.disabled,
        group: group ?? null,
      })
    }
    Children.toArray(children).forEach((c) => push(c, null))
    return out
  }, [children])

  const isControlled = value !== undefined
  const [internal, setInternal] = useState(defaultValue ?? '')
  const current = isControlled ? value : internal

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const [rect, setRect] = useState(null)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const setRefs = useMemo(() => (node) => {
    inputRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (rootRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false); setQuery('')
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // The panel is portaled to <body> and fixed-positioned so it isn't clipped by a scrollable
  // Modal/Drawer body — track the trigger's position while open (scroll happens on capture
  // since ancestor scroll containers don't bubble the event).
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const update = () => setRect(rootRef.current.getBoundingClientRect())
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  const selected = options.find((o) => String(o.value) === String(current))
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  const commit = (opt) => {
    if (opt.disabled) return
    // Native <select> always yields a string via e.target.value — match that so existing handlers
    // (some options pass a numeric `value` prop) keep getting the same type they always did.
    const val = String(opt.value)
    if (!isControlled) setInternal(val)
    onChange?.({ target: { value: val, name } })
    setOpen(false)
    setQuery('')
  }

  const openPanel = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setHighlight(Math.max(0, options.findIndex((o) => String(o.value) === String(current))))
  }

  const onKeyDown = (e) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(filtered.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) commit(filtered[highlight]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery('') }
    else if (e.key === 'Tab') { setOpen(false); setQuery('') }
  }

  return (
    <div className="relative" ref={rootRef}>
      <input
        ref={setRefs}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-required={required}
        readOnly={!open}
        disabled={disabled}
        className={clsx(fieldBase, 'w-full pe-8 cursor-pointer', error && 'border-danger-500', className)}
        value={open ? query : (selected ? selected.label : '')}
        placeholder={placeholder}
        onFocus={openPanel}
        onClick={openPanel}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
        onKeyDown={onKeyDown}
        {...props}
      />
      <ChevronDown size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      {open && rect && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: 'fixed', top: rect.bottom + 4, ...(document.documentElement.dir === 'rtl' ? { right: document.documentElement.clientWidth - rect.right } : { left: rect.left }), minWidth: rect.width, width: 'max-content', maxWidth: 'min(90vw, 480px)' }}
          className="z-[60] max-h-64 overflow-y-auto scroll-thin bg-surface border border-border rounded-md shadow-pop"
        >
          {filtered.length === 0 ? (
            <p className="text-xs text-ink-muted px-3 py-3">{query ? t('ui.form.noMatchesFor', { query }) : t('ui.form.noMatches')}</p>
          ) : filtered.map((o, i) => (
            <Fragment key={`${o.value}-${i}`}>
              {o.group && o.group !== filtered[i - 1]?.group && (
                <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{o.group}</p>
              )}
            <button
              type="button"
              role="option"
              aria-selected={String(o.value) === String(current)}
              disabled={o.disabled}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(o)}
              className={clsx(
                'w-full flex items-center px-3 py-2 [@media(pointer:coarse)]:py-3 text-start text-sm whitespace-normal break-words',
                o.disabled ? 'text-ink-faint cursor-not-allowed' : 'text-ink hover:bg-bg',
                i === highlight && !o.disabled && 'bg-bg',
              )}
            >
              {o.label}
            </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
})

export const Textarea = forwardRef(function Textarea({ className, error, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={clsx(fieldBase, 'w-full h-auto min-h-[80px] py-2 resize-y', error && 'border-danger-500', className)}
      {...props}
    />
  )
})

const LINKABLE = new Set(['input', 'select', 'textarea'])

/**
 * A labelled field. When its child is one field (Input, Select, Textarea or a native one), the label
 * is tied to it (htmlFor ↔ id) — a screen reader names the field and tapping the label focuses it —
 * and the error / hint is read out with it (aria-describedby), with aria-invalid and aria-required.
 * Anything else (a group of buttons, a custom control) renders as given.
 */
export function FormField({ label, htmlFor, required, error, hint, className, children }) {
  const auto = useId()
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null
  const linkable = !!only && (LINKABLE.has(only.type) || only.type === Input || only.type === Select || only.type === Textarea)
  const id = htmlFor ?? (linkable ? only.props.id ?? `fld${auto.replace(/:/g, '')}` : undefined)
  const message = error || hint
  const msgId = message ? `${id ?? `fld${auto.replace(/:/g, '')}`}-msg` : undefined
  const field = linkable
    ? cloneElement(only, {
      id,
      'aria-invalid': error ? true : only.props['aria-invalid'],
      'aria-describedby': [only.props['aria-describedby'], msgId].filter(Boolean).join(' ') || undefined,
      'aria-required': required || only.props['aria-required'] || undefined,
    })
    : children
  return (
    <div className={className}>
      {label && <Label htmlFor={id} required={required}>{label}</Label>}
      {field}
      {error && <p id={msgId} className="text-xs text-danger-500 mt-1">{error}</p>}
      {!error && hint && <p id={msgId} className="text-xs text-ink-faint mt-1">{hint}</p>}
    </div>
  )
}
