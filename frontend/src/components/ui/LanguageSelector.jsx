import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Globe, Check, ChevronDown, Search } from 'lucide-react'
import { useLanguage } from '../../hooks/useLanguage'
import { saveMyLanguage } from '../../api/auth'

/**
 * Language picker.
 *   enabledLanguages: codes the institution switched on (all when empty)
 *   saveToProfile:    also save the choice on the signed-in staff user's account (top bar)
 *   onSelect(code):   extra hook after switching (e.g. the parent app remembers it per family)
 */
export default function LanguageSelector({ enabledLanguages, variant = 'topbar', className, saveToProfile = false, onSelect }) {
  const { t } = useTranslation('ui')
  const { language, languageMeta, setLanguage, languages } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setSearch('')
      return undefined
    }
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const activeLanguages = useMemo(() => {
    if (Array.isArray(enabledLanguages) && enabledLanguages.length > 0) {
      return languages.filter((l) => enabledLanguages.includes(l.code))
    }
    return languages
  }, [languages, enabledLanguages])

  // One language (the launch set-up): nothing to choose, so no picker.
  const single = activeLanguages.length < 2

  const filteredLanguages = useMemo(() => {
    if (!search.trim()) return activeLanguages
    const q = search.trim().toLowerCase()
    return activeLanguages.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    )
  }, [activeLanguages, search])

  const handleSelect = async (code) => {
    setOpen(false)
    await setLanguage(code)
    onSelect?.(code)
    if (saveToProfile) {
      try { await saveMyLanguage(code) } catch { /* the choice still applies in this browser */ }
    }
  }

  if (single) return null
  return (
    <div className={clsx('relative inline-flex items-center', className)} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('ui.language.change')}
        className={clsx(
          'h-8 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-bg transition-colors border border-transparent hover:border-border',
          open && 'bg-bg border-border text-ink'
        )}
      >
        <Globe className="w-3.5 h-3.5 text-brand-600 shrink-0" />
        <span className="hidden sm:inline font-medium">{languageMeta?.nativeName || 'English'}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {open && (
        <div className="absolute end-0 top-full mt-1.5 w-60 max-h-80 rounded-xl bg-surface border border-border shadow-xl z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-1">
          <div className="p-2 border-b border-border bg-bg/50">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-ink-faint absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                placeholder={t('ui.language.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-7 ps-8 pe-2.5 text-xs rounded-md bg-surface border border-border text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 scroll-hide max-h-60">
            {filteredLanguages.length === 0 ? (
              <div className="p-3 text-center text-xs text-ink-muted">{t('ui.language.none')}</div>
            ) : (
              filteredLanguages.map((l) => {
                const active = l.code === language
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => handleSelect(l.code)}
                    className={clsx(
                      'w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors text-start',
                      active
                        ? 'bg-brand-50 text-brand-700 font-semibold'
                        : 'text-ink hover:bg-bg hover:text-brand-600'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium leading-none">{l.nativeName}</span>
                      {l.code !== 'en' && (
                        <span className="text-[11px] text-ink-faint truncate font-normal">
                          {l.name}
                        </span>
                      )}
                    </div>
                    {active && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0 ms-2" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
