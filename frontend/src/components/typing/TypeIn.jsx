import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Check, Languages } from 'lucide-react'
import { getLanguage, transliterateWord, typingLanguages } from '@schoolgiant/shared'
import { choicesFor, forgetLastTyped, installTypeIn, replaceLastTyped, setTypeIn, useLastTyped, useTypeIn } from './typingEngine'

/** The language's first letter (अ, ಅ), shown on the switch. */
const letterOf = (lang) => transliterateWord('a', lang) ?? 'A'

/**
 * The typing-language switch, for a toolbar: English letters, or a language typed the way it sounds. It sets the one
 * switch every `data-typein="auto"` area follows (the content editor, a topic's notes and questions).
 */
export function TypeInButton({ className }) {
  const { t } = useTranslation('common')
  const lang = useTypeIn()
  const [open, setOpen] = useState(null) // where the menu shows (the toolbar scrolls, so it is placed on the page)
  const box = useRef(null)
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setOpen((x) => (x ? null : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }))
  }
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(null) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const langs = typingLanguages()
  if (!langs.length) return null
  const pick = (code) => { setTypeIn(code); setOpen(null) }
  const name = lang ? getLanguage(lang).nativeName : null
  return (
    <span ref={box} className={clsx('shrink-0', className)}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={toggle} aria-expanded={!!open} aria-haspopup="menu"
        title={name ? t('typing.on', { lang: name }) : t('typing.button')} aria-label={t('typing.button')}
        className={clsx('flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/[0.04] [@media(pointer:coarse)]:h-10',
          lang ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-muted hover:text-ink')}>
        <Languages className="h-4 w-4" aria-hidden />
        <span lang={lang ?? 'en'}>{lang ? letterOf(lang) : 'A'}</span>
      </button>
      {open && (
        <div role="menu" style={{ position: 'fixed', top: open.top, right: open.right }} className="z-50 w-72 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-surface p-1 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-muted">{t('typing.title')}</p>
          {[null, ...langs.map((l) => l.code)].map((code) => (
            <button key={code ?? 'en'} type="button" role="menuitemradio" aria-checked={lang === code} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(code)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-black/[0.04]">
              <span className="w-4">{lang === code && <Check className="h-4 w-4 text-brand-700" aria-hidden />}</span>
              <span lang={code ?? 'en'}>{code ? getLanguage(code).nativeName : t('typing.english')}</span>
              {code && <span className="ml-auto text-xs text-ink-faint" lang={code}>namaste → {transliterateWord('namaste', code)}</span>}
            </button>
          ))}
          <p className="border-t border-border px-2.5 pb-1.5 pt-2 text-xs leading-relaxed text-ink-muted">{t('typing.help')}</p>
        </div>
      )}
    </span>
  )
}

/** Where to show the spellings: under the word in the editor, under the box otherwise. */
function placeOf(l) {
  let rect = null
  if (l.node?.isConnected) {
    try {
      const r = document.createRange()
      r.setStart(l.node, l.offset)
      r.setEnd(l.node, Math.min(l.node.data.length, l.offset + l.native.length))
      rect = r.getBoundingClientRect()
    } catch { rect = null }
  }
  if ((!rect || !rect.width) && l.el?.isConnected) rect = l.el.getBoundingClientRect()
  if (!rect) return null
  return { top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)) }
}

/**
 * Mounted once for the app: starts listening, and offers the other spellings of the word just written — a tap puts it
 * in place and remembers it on this device; the English letters are always the last choice.
 */
export function TypeInBar() {
  const { t } = useTranslation('common')
  const l = useLastTyped()
  const [, redraw] = useState(0)
  useEffect(() => { installTypeIn() }, [])
  useEffect(() => {
    if (!l) return undefined
    const move = () => redraw((n) => n + 1)
    const away = (e) => { if (e.target !== l.el && !l.el?.contains?.(e.target) && !e.target.closest?.('[data-typein-bar]')) forgetLastTyped() }
    const esc = (e) => { if (e.key === 'Escape') forgetLastTyped() }
    window.addEventListener('scroll', move, true)
    window.addEventListener('resize', move)
    document.addEventListener('mousedown', away, true)
    document.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('scroll', move, true); window.removeEventListener('resize', move)
      document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true)
    }
  }, [l])
  if (!l) return null
  const at = placeOf(l)
  if (!at) return null
  const choices = choicesFor(l)
  return createPortal(
    <div data-typein-bar role="listbox" aria-label={t('typing.other')} style={{ position: 'fixed', top: at.top, left: at.left, zIndex: 60 }}
      className="flex max-w-[332px] flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-lg">
      {choices.map((c) => (
        <button key={c} type="button" role="option" aria-selected={c === l.native} lang={l.lang} onMouseDown={(e) => e.preventDefault()} onClick={() => replaceLastTyped(c)}
          className={clsx('rounded-md px-2 py-1 text-sm', c === l.native ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink hover:bg-black/[0.04]')}>{c}</button>
      ))}
      <button type="button" role="option" aria-selected={l.native === l.roman} lang="en" title={t('typing.keepEnglish')} onMouseDown={(e) => e.preventDefault()} onClick={() => replaceLastTyped(l.roman)}
        className="rounded-md border-l border-border px-2 py-1 text-sm text-ink-muted hover:bg-black/[0.04]">{l.roman}</button>
    </div>,
    document.body,
  )
}
