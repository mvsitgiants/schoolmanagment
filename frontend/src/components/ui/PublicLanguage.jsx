import { useEffect } from 'react'
import LanguageSelector from './LanguageSelector'
import { changeLanguage, getStoredLanguage } from '../../i18n'

/**
 * The language picker on a page families open without signing in (online application, admission form link).
 * `ui`: { languages, defaultLanguage } from the school. A family that never chose a language gets the school's
 * default (not stored, so their own choice still wins later); the picker offers only the school's languages and
 * hides itself when there is just one.
 */
export default function PublicLanguage({ ui, className }) {
  useEffect(() => {
    if (!ui?.defaultLanguage || getStoredLanguage()) return
    if (!ui.languages?.length || ui.languages.includes(ui.defaultLanguage)) changeLanguage(ui.defaultLanguage, { persist: false })
  }, [ui?.defaultLanguage]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ui) return null
  return <LanguageSelector enabledLanguages={ui.languages} className={className} />
}
