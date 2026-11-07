import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, CornerDownLeft, PanelsTopLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import useAuthUser from '../../hooks/useAuthUser'
import { pagesFor } from '../../catalog/nav'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

/**
 * The header search box: one place to find a screen — and, as modules arrive, a student,
 * a receipt or a member of staff. Records will come from a search API and each one knows the screen
 * that owns it, so picking one lands there already filtered to the record.
 *
 * Screens are matched here in the browser against the same navigation config the sidebar
 * reads, filtered by the modules this tenant has and the pages this role may open: with
 * 24 modules and ~190 screens, remembering which menu something lives under is its own
 * chore, and typing its name should be enough.
 *
 * `/` focuses it from anywhere, arrows move through the list, Enter opens, Escape closes.
 */
export default function GlobalSearch() {
  const { t } = useTranslation(['common', 'nav', 'ui'])
  const cl = useCatalogLabel()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // Records (students by admission number, name or mobile; receipts; staff) join here as their
  // modules are built: a search API per module fills `hits`, each hit knowing the screen it opens.
  const [hits] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching] = useState(false)
  const user = useAuthUser()
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const debounced = useDebouncedValue(query, 250)

  // Screens this user can actually open (same rules as the sidebar), one searchable list.
  // Names show in the active language; the English names still match what is typed.
  const pages = useMemo(() => pagesFor(user).map((p) => ({
    kind: 'Page',
    code: cl.page(p.module, p),
    label: cl.module(p.module),
    english: `${p.name} ${p.module.name}`.toLowerCase(),
    path: p.path,
    isPage: true,
  })), [user, cl])

  const pageHits = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (q.length < 2) return []
    const scored = pages
      .map((p) => {
        const name = p.code.toLowerCase()
        const full = `${p.label} ${p.code} ${p.english}`.toLowerCase()
        if (name.startsWith(q)) return { p, rank: 0 }
        if (name.includes(q)) return { p, rank: 1 }
        if (full.includes(q)) return { p, rank: 2 }
        return null
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || a.p.code.localeCompare(b.p.code))
    return scored.slice(0, 6).map((x) => x.p)
  }, [pages, debounced])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return
      const el = e.target
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onClickOutside = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Screens first: they need no round trip, and someone typing "leads" almost always
  // wants the Leads screen rather than a record that happens to contain the word.
  const allHits = useMemo(() => [...pageHits, ...hits], [pageHits, hits])

  useEffect(() => { setActive(0) }, [allHits.length])

  const go = (hit) => {
    if (!hit) return
    setOpen(false)
    setQuery('')
    // A screen is just opened; a record opens its screen filtered down to it.
    if (hit.isPage || hit.direct) navigate(hit.path)
    else navigate(`${hit.path}?search=${encodeURIComponent(hit.search ?? hit.code ?? '')}&jump=1`)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!allHits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % allHits.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + allHits.length) % allHits.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(allHits[active]) }
  }

  const showPanel = open && query.trim().length >= 2

  return (
    <div className="relative w-full max-w-md" ref={boxRef}>
      <Search className="w-4 h-4 text-ink-faint absolute start-3 top-1/2 -translate-y-1/2" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-label={t('search.placeholder', 'Search screens')}
        placeholder={`${t('search.placeholder', 'Search screens…')}  ( / )`}
        className="w-full h-9 ps-9 pe-8 text-sm rounded-md border border-border bg-bg focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 focus:bg-white"
      />
      {!query && (
        <kbd className="hidden sm:block absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ink-faint border border-border rounded px-1.5 py-0.5 leading-none">/</kbd>
      )}

      {showPanel && (
        <div id="global-search-results" role="listbox"
          className="absolute inset-x-0 top-11 max-h-[420px] overflow-y-auto scroll-thin rounded-md border border-border bg-surface shadow-lg z-50 p-1.5">
          {allHits.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-muted">
              {searching ? t('search.searching', 'Searching…') : t('search.noMatch', { query: query.trim(), defaultValue: `No match for “${query.trim()}”. Try a screen name.` })}
            </p>
          ) : allHits.map((h, i) => (
            <button
              key={`${h.kind}-${h.code}-${h.path}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-start ${i === active ? 'bg-brand-50' : ''}`}
            >
              {h.isPage ? <PanelsTopLeft className="w-3.5 h-3.5 text-brand-500 shrink-0" /> : null}
              <span className={`text-xs text-ink font-medium truncate max-w-[45%] ${h.isPage || h.direct ? '' : 'font-mono-num'}`}>{h.code}</span>
              {h.label && <span className="text-xs text-ink-muted truncate flex-1">{h.label}</span>}
              <span className="text-[11px] text-ink-faint ms-auto shrink-0">{h.isPage ? t('search.screen', 'Screen') : t('ui.search.record')}</span>
              {i === active && <CornerDownLeft className="w-3 h-3 text-ink-faint shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
