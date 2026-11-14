import { createContext, useContext } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

/** Ctrl + Enter, or ⌘ + Enter on a Mac. */
export const isSaveShortcut = (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat

/** "Ctrl + Enter to save" (⌘ on a Mac). Hidden on touch screens, which have no keyboard shortcut. */
export function SaveShortcutHint({ className }) {
  const { t } = useTranslation('ui')
  return <span className={clsx('text-xs text-ink-faint hidden sm:block [@media(pointer:coarse)]:hidden', className)}>{t('ui.form.saveShortcut', { key: IS_MAC ? '⌘' : 'Ctrl' })}</span>
}

/** True inside a pop-up or drawer — FormSection drops its card there (a card inside a card looks heavy). */
export const InOverlayContext = createContext(false)
export const useInOverlay = () => useContext(InOverlayContext)
