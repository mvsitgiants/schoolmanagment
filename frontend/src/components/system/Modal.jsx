import { useEffect, useId, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

// Shared overlay stack. Only the top-most overlay reacts to Escape / backdrop
// clicks, and the body scroll-lock is released only once the last overlay
// closes. Every stacked surface registers here — the base <Modal>, and the raw
// <Attachments> preview / document picker that open on top of it — so pressing
// Escape inside a nested surface no longer also closes the modal behind it.
const overlayStack = []
let overlaySeq = 0

const pushOverlay = (id) => {
  overlayStack.push(id)
  document.body.style.overflow = 'hidden'
}
const popOverlay = (id) => {
  const i = overlayStack.lastIndexOf(id)
  if (i !== -1) overlayStack.splice(i, 1)
  if (overlayStack.length === 0) document.body.style.overflow = ''
}
const isTopOverlay = (id) => overlayStack[overlayStack.length - 1] === id

/**
 * Registers a stacked overlay while `open` is true and returns a stable
 * `() => boolean` reporting whether this overlay is currently the top-most one.
 * Gate Escape / outside-click handlers with it so stacked overlays don't all
 * dismiss at once.
 */
export function useOverlayLayer(open) {
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = ++overlaySeq
  useEffect(() => {
    if (!open) return undefined
    const id = idRef.current
    pushOverlay(id)
    return () => popOverlay(id)
  }, [open])
  return useCallback(() => isTopOverlay(idRef.current), [])
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

const focusablesIn = (el) =>
  el ? Array.from(el.querySelectorAll(FOCUSABLE)).filter(
    (n) => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement,
  ) : []

/**
 * While `active`, keeps Tab focus inside `containerRef`, moves focus into the
 * dialog on open (unless an `autoFocus` inside already claimed it), and returns
 * focus to the previously-focused element on close. `isTop` (from
 * useOverlayLayer) gates the trap so stacked dialogs don't fight over Tab.
 */
export function useFocusTrap(active, containerRef, isTop) {
  const restoreRef = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    restoreRef.current = document.activeElement
    const container = containerRef.current
    if (container && !container.contains(document.activeElement)) {
      ;(focusablesIn(container)[0] || container).focus()
    }
    const onKey = (e) => {
      if (e.key !== 'Tab' || !isTop()) return
      const box = containerRef.current
      if (!box) return
      const items = focusablesIn(box)
      if (!items.length) { e.preventDefault(); box.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const el = document.activeElement
      if (!box.contains(el)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && el === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && el === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const el = restoreRef.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [active, containerRef, isTop])
}

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const { t } = useTranslation('ui')
  const isTop = useOverlayLayer(open)
  const panelRef = useRef(null)
  const titleId = useId() // the dialog is named by its title for screen readers
  useFocusTrap(open, panelRef, isTop)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && isTop()) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, isTop])

  if (!open) return null

  const WIDTH = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-navy-900/40 backdrop-blur-[2px]" onClick={() => isTop() && onClose?.()} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative w-full ${WIDTH[size]} bg-surface rounded-t-2xl sm:rounded-lg shadow-pop border border-border max-h-[92dvh] sm:max-h-[90vh] flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0 outline-none`}>
        <div className="sm:hidden pt-2 flex justify-center shrink-0">
          <span className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border">
          <h2 id={titleId} className="font-display text-base font-semibold text-ink truncate pe-2">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('ui.common.close')}
            className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 sm:px-5 py-4 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-t border-border flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
