import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Plus } from 'lucide-react'
import Button from '../ui/Button'

/**
 * One "Add" button that opens the ways to add a file — take a photo, choose a file, choose one the school already
 * has — instead of a row of buttons. Each option: { key, icon, label, hint?, onSelect }.
 *
 *   <AddFileMenu label="Add document" options={[…]} up />
 */
export default function AddFileMenu({ label, options = [], up = false, size = 'sm', variant = 'secondary', loading = false, disabled = false, className }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      <Button size={size} variant={variant} icon={Plus} loading={loading} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}<ChevronDown className={clsx('ms-1 h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      {open && (
        <div role="menu" className={clsx('absolute end-0 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface py-1 shadow-pop', up ? 'bottom-full mb-2' : 'top-full mt-2')}>
          {options.map((o) => {
            const Icon = o.icon
            return (
              <button key={o.key} type="button" role="menuitem" onClick={() => { setOpen(false); o.onSelect() }}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-start hover:bg-bg focus:bg-bg focus:outline-none">
                {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  {o.hint && <span className="block text-xs text-ink-faint">{o.hint}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
