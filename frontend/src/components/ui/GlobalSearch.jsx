import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, CornerDownLeft, PanelsTopLeft, GraduationCap, Users, IdCard, ReceiptIndianRupee, MessageSquareText, FileText, BookOpen, Boxes, Bus, DoorClosed } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { globalSearch } from '../../api/dashboard'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import useAuthUser from '../../hooks/useAuthUser'
import { pagesFor } from '../../catalog/nav'
import { useCatalogLabel } from '../../hooks/useCatalogLabel'

/**
 * The header search box: one place to find a screen, a student, a parent, a member of staff, a receipt, an
 * enquiry, a book, an asset… Records come from GET /dashboard/search and each one knows the screen that owns
 * it, so picking one lands there (a profile, or the list already filtered to the record).
 *
 * Screens are matched here in the browser against the same navigation config the sidebar
 * reads, filtered by the modules this tenant has and the pages this role may open: with
 * 24 modules and ~190 screens, remembering which menu something lives under is its own
 * chore, and typing its name should be enough.
 *
 * `/` focuses it from anywhere, arrows move through the list, Enter opens, Escape closes.
 */
const KIND_ICON = { STUDENT: GraduationCap, GUARDIAN: Users, STAFF: IdCard, RECEIPT: ReceiptIndianRupee, ENQUIRY: MessageSquareText, APPLICATION: FileText, BOOK: BookOpen, ASSET: Boxes, VEHICLE: Bus, VISITOR: DoorClosed }

export default function GlobalSearch() {
  const { t } = useTranslation(['common', 'nav', 'ui'])
  const cl = useCatalogLabel()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const user = useAuthUser()
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const debounced = useDebouncedValue(query, 250)
  // Records — students, parents, staff, receipts, enquiries, books, assets… — from the server, only where this
  // person may look (backend services/search.js). Each one opens the screen that owns it.
  const term = debounced.trim()
  const { data: records = [], isFetching: searching } = useQuery({
    queryKey: ['global-search', term], queryFn: () => globalSearch(term), enabled: term.length >= 2,
    staleTime: 30_000, placeholderData: keepPreviousData,
  })
  const hits = useMemo(() => (term.length >= 2 ? records.map((r) => ({ ...r, code: r.title, label: r.subtitle, direct: true })) : []), [records, term])

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

  // Screens first: they need no round trip, and someone typing "fees" almost always wants the screen rather than
  // a record that happens to contain the word. With records too, a few screens are enough.
  const allHits = useMemo(() => [...(hits.length ? pageHits.slice(0, 3) : pageHits), ...hits], [pageHits, hits])

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
        aria-label={t('search.placeholder')}
        placeholder={t('search.placeholder')}
        className="w-full h-9 ps-9 pe-8 text-sm rounded-md border border-border bg-bg focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 focus:bg-white"
      />
      {!query && (
        <kbd className="hidden sm:block absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ink-faint border border-border rounded px-1.5 py-0.5 leading-none">/</kbd>
      )}

      {showPanel && (
        <div id="global-search-results" role="listbox"
          className="absolute inset-x-0 top-11 max-h-[min(480px,70vh)] overflow-y-auto scroll-thin rounded-lg border border-border bg-surface shadow-lg z-50 p-1.5 min-w-[18rem]">
          {allHits.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-muted">
              {searching || term !== query.trim() ? t('search.searching') : t('search.noMatch', { query: query.trim() })}
            </p>
          ) : allHits.map((h, i) => {
            const group = h.isPage ? 'PAGE' : h.kind
            const first = i === 0 || (allHits[i - 1].isPage ? 'PAGE' : allHits[i - 1].kind) !== group
            const Icon = h.isPage ? PanelsTopLeft : KIND_ICON[h.kind] ?? Search
            return (
              <div key={`${h.kind}-${h.id ?? h.path}-${i}`}>
                {first && <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{h.isPage ? t('search.screens') : t(`search.kinds.${h.kind}`)}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-start ${i === active ? 'bg-brand-50' : ''}`}
                >
                  <span className={`grid place-items-center w-7 h-7 rounded-md shrink-0 ${h.isPage ? 'bg-brand-50 text-brand-600' : 'bg-black/[0.04] text-ink-muted'}`}><Icon className="w-3.5 h-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink font-medium truncate">{h.code}</span>
                    {h.label && <span className="block text-[11.5px] text-ink-muted truncate">{h.label}</span>}
                  </span>
                  {h.status && <span className="text-[10.5px] font-medium text-ink-muted bg-black/[0.04] rounded px-1.5 py-0.5 shrink-0">{h.status}</span>}
                  {i === active && <CornerDownLeft className="w-3 h-3 text-ink-faint shrink-0" />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
