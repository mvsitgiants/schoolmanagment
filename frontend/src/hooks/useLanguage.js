import { useEffect, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, getLanguage } from '@schoolgiant/shared'
import { changeLanguage as setLang, getSavedLanguage } from '../i18n'

/**
 * Hook to access and switch the current active language.
 */
export function useLanguage() {
  const { t, i18n } = useTranslation()
  const [langCode, setLangCode] = useState(() => i18n.language || getSavedLanguage())
  const [, startTransition] = useTransition()

  useEffect(() => {
    const onLanguageChange = (lng) => {
      startTransition(() => {
        setLangCode(lng)
      })
    }
    i18n.on('languageChanged', onLanguageChange)
    return () => {
      i18n.off('languageChanged', onLanguageChange)
    }
  }, [i18n])

  const meta = getLanguage(langCode)

  const handleSetLanguage = async (newCode) => {
    await setLang(newCode)
  }

  return {
    language: langCode,
    languageMeta: meta,
    isRTL: meta.dir === 'rtl',
    setLanguage: handleSetLanguage,
    languages: SUPPORTED_LANGUAGES,
    t,
  }
}

export default useLanguage
