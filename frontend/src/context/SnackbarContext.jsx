import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const SnackbarContext = createContext(null)

const VARIANTS = {
  success: { icon: CheckCircle2, iconClass: 'text-success-600', borderClass: 'border-s-success-500' },
  error: { icon: XCircle, iconClass: 'text-danger-600', borderClass: 'border-s-danger-500' },
  info: { icon: Info, iconClass: 'text-info-600', borderClass: 'border-s-info-500' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-600', borderClass: 'border-s-amber-400' }
}

const DEFAULT_DURATION = 4000

// Lets non-component code (e.g. the axios interceptor in api/client.js) raise
// a snackbar without needing access to React context.
let globalShow = null

export function notify(message, opts) {
  if (globalShow) globalShow(message, opts)
}

export function SnackbarProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((message, { variant = 'info', duration = DEFAULT_DURATION } = {}) => {
    if (!message) return
    const id = ++nextId.current
    // A burst of identical errors (e.g. every request failing while the server is down) shows once
    setToasts((prev) => prev.some((t) => t.message === message && t.variant === variant) ? prev : [...prev, { id, message, variant }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }, [dismiss])

  const api = useRef({
    show,
    showSuccess: (message, opts) => show(message, { ...opts, variant: 'success' }),
    showError: (message, opts) => show(message, { ...opts, variant: 'error' }),
    showInfo: (message, opts) => show(message, { ...opts, variant: 'info' }),
    showWarning: (message, opts) => show(message, { ...opts, variant: 'warning' }),
    dismiss
  })
  api.current.show = show
  api.current.dismiss = dismiss
  globalShow = show

  return (
    <SnackbarContext.Provider value={api.current}>
      {children}
      <div className="fixed bottom-4 end-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {toasts.map((t) => {
          const { icon: Icon, iconClass, borderClass } = VARIANTS[t.variant] || VARIANTS.info
          return (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-2.5 rounded-md border border-border border-s-4 ${borderClass} px-3.5 py-3 shadow-pop bg-surface-raised`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconClass}`} />
              <p className="flex-1 text-sm font-medium text-ink leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-ink-faint hover:text-ink transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </SnackbarContext.Provider>
  )
}

export function useSnackbar() {
  const ctx = useContext(SnackbarContext)
  if (!ctx) throw new Error('useSnackbar must be used within a SnackbarProvider')
  return ctx
}
