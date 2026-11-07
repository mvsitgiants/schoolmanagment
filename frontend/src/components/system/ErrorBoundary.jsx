import { Component } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * After a deploy, the screens' files have new names; a tab opened before it asks for an old one
 * and gets index.html back. Reload once to pick up the new build — guarded so a file that is
 * really broken doesn't reload in a loop.
 */
const RELOAD_KEY = 'hx_chunk_reload_at'
export const isChunkError = (e) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(String(e?.message ?? e))
export function reloadForNewBuild() {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < 20_000) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
  window.location.reload()
  return true
}

function Fallback({ full, onRetry }) {
  const { t } = useTranslation('ui')
  return (
    <div role="alert" className={full ? 'min-h-[100dvh] flex items-center justify-center bg-bg p-4' : 'py-16 flex items-center justify-center'}>
      <div className="max-w-md w-full bg-surface border border-border rounded-xl p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-danger-500 mx-auto" />
        <h2 className="mt-3 font-display text-base font-semibold text-ink">{t('ui.crash.title', 'Something went wrong on this screen')}</h2>
        <p className="mt-1.5 text-sm text-ink-muted">{t('ui.crash.hint', 'Your other work is safe. Reload the page; if it happens again, tell your administrator what you were doing.')}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-brand-500 text-white text-sm font-medium hover:bg-brand-600">
            <RefreshCw className="w-4 h-4" /> {t('ui.crash.reload', 'Reload')}
          </button>
          {onRetry && (
            <button type="button" onClick={onRetry} className="h-10 px-4 rounded-md border border-border text-sm font-medium text-ink hover:bg-bg">
              {t('ui.crash.tryAgain', 'Try again')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Catches a render error so one broken screen doesn't blank the whole app mid-consult.
 * `resetKey` (the route path) clears the error when the user moves to another screen.
 * `full`: the last-resort boundary around the whole app (no layout left to keep).
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error) {
    if (isChunkError(error) && reloadForNewBuild()) return
    console.error(error) // eslint-disable-line no-console
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <Fallback full={this.props.full} onRetry={this.props.full ? null : () => this.setState({ error: null })} />
  }
}
