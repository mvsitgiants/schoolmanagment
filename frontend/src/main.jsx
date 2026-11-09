import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { ModuleProvider } from './context/ModuleContext.jsx'
import { SnackbarProvider, notify } from './context/SnackbarContext.jsx'
import { ConfirmProvider, DocumentViewerHost, ErrorBoundary, reloadForNewBuild } from './components/system'
import './index.css'
import { i18nReady } from './i18n'
import { initDensity } from './utils/density'
import PwaPrompts from './components/app/PwaPrompts.jsx'

// The stored layout density has to be on <html> before the first paint.
initDensity()

// A screen's file that is gone after a deploy (an old tab asking for the previous build): load
// the new build instead of failing the navigation.
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewBuild()) e.preventDefault() })

// A load that fails with a server error says so once, even on screens that only show an empty
// list — "nothing here" must not be mistaken for "nothing to do". (Server unreachable is already
// announced by api/client.js; 4xx are the screen's own business — no access, not found.)
let loadNoticeAt = 0
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e) => {
      const status = e?.response?.status
      if (!status || status < 500 || Date.now() - loadNoticeAt < 15_000) return
      loadNoticeAt = Date.now()
      notify(e.message || 'Some information could not be loaded. Try again in a moment.', { variant: 'error' })
    },
  }),
  defaultOptions: {
    // retry once on a server error or outage; a 4xx (no access, not found, invalid) won't change on retry
    queries: { staleTime: 30_000, retry: (n, e) => n < 1 && (e?.response?.status ?? 500) >= 500, refetchOnWindowFocus: false },
  },
})

// Render once the chosen language's core translations are in (English is bundled, so it is
// immediate; another language is one small fetch — and falls back to English if that fails).
i18nReady.then(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <SnackbarProvider>
          <ConfirmProvider>
            <ModuleProvider>
              <ErrorBoundary full>
                <App />
                <DocumentViewerHost />
                <PwaPrompts />
              </ErrorBoundary>
            </ModuleProvider>
          </ConfirmProvider>
        </SnackbarProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
))
