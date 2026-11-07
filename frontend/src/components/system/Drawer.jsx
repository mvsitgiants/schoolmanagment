import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useOverlayLayer, useFocusTrap } from './Modal'

const WIDTH = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg', xl: 'sm:max-w-2xl', '2xl': 'sm:max-w-3xl' }

/**
 * Record slide-over for viewing / editing one record. Use this instead of a
 * nested modal or a full detail page.
 *
 *   - desktop (`sm`+): slides in from the end side (right; left under dir="rtl"), full height.
 *   - phones: slides **up from the bottom** as a sheet (rounded top, grab handle).
 *
 *   <Drawer open={!!row} onClose={() => setRow(null)} title={row?.name} subtitle="Work Order" footer={<Button>Save</Button>}>
 *     …fields…
 *   </Drawer>
 */
export default function Drawer({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const { t } = useTranslation('ui')
  const isTop = useOverlayLayer(open)
  const panelRef = useRef(null)
  const titleId = useId()
  useFocusTrap(open, panelRef, isTop)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && isTop()) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, isTop])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end">
      <div className="absolute inset-0 bg-navy-900/40 backdrop-blur-[2px] animate-[drawerFade_120ms_ease-out]" onClick={() => isTop() && onClose?.()} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${WIDTH[size]} bg-surface shadow-pop flex flex-col outline-none
                    max-h-[90dvh] rounded-t-2xl border-t border-border
                    sm:h-full sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-s
                    pb-[env(safe-area-inset-bottom)] sm:pb-0
                    animate-[drawerUp_200ms_cubic-bezier(0.16,1,0.3,1)] sm:animate-[drawerIn_160ms_cubic-bezier(0.16,1,0.3,1)] rtl:sm:animate-[drawerInRtl_160ms_cubic-bezier(0.16,1,0.3,1)]`}
      >
        <div className="sm:hidden pt-2 flex justify-center shrink-0">
          <span className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            {subtitle && <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{subtitle}</p>}
            <h2 id={titleId} className="font-display text-base font-semibold text-ink truncate">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ui.common.close')}
            className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:bg-bg hover:text-ink shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-4 sm:px-5 py-4">{children}</div>
        {footer && <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-t border-border flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
      <style>{`
        @keyframes drawerIn { from { transform: translateX(16px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }
        @keyframes drawerInRtl { from { transform: translateX(-16px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }
        @keyframes drawerUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes drawerFade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>,
    document.body,
  )
}
