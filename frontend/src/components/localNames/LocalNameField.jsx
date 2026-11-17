import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLanguage } from '@schoolgiant/shared'
import { FormField, Input } from '../system'
import useAuthUser from '../../hooks/useAuthUser'
import { lookupLocalNames, saveRecordLocalNames } from '../../api/core'
import { canTransliterate, hasLatin, transliterate } from '../../utils/transliterate'

// A name in the school's other languages beside the English one (Settings › Also keep names in). The English stays on
// the record as typed; the local text goes to the language's glossary (Administration › Names in other languages),
// which print templates in that language use.
//
//   const names = useLocalNames('students')
//   <LocalNameField names={names} slot="student" english={fullName} label={t('…name')} />
//   … after the record saves: await names.save()

/** The languages this school keeps names in besides English ([] = none: the boxes don't show). */
export function useNamesAlsoIn() {
  const user = useAuthUser()
  const codes = user?.tenant?.namesAlsoIn ?? []
  return useMemo(() => codes.map((c) => getLanguage(c)).filter((l) => l && l.code !== 'en' && codes.includes(l.code)), [codes.join()])
}

/** One form's names in other languages: slots (a field each) with their English and the text per language. */
export function useLocalNames(kind) {
  const langs = useNamesAlsoIn()
  const [values, setValues] = useState({}) // slot → { lang → text }
  const english = useRef({}) // slot → the English now in the form
  const touched = useRef(new Set()) // `${slot}:${lang}` the user typed in
  const loaded = useRef(new Set()) // slots already looked up

  const track = useCallback((slot, text) => { english.current[slot] = String(text ?? '').trim() }, [])
  const load = useCallback(async (slot, text) => {
    const en = String(text ?? '').trim()
    if (!en || !langs.length || loaded.current.has(slot)) return
    loaded.current.add(slot)
    for (const l of langs) {
      try {
        const found = (await lookupLocalNames(l.code, kind, [en]))[en]
        if (found && !touched.current.has(`${slot}:${l.code}`)) setValues((v) => ({ ...v, [slot]: { ...v[slot], [l.code]: found } }))
      } catch { /* no permission to read them: the box starts empty */ }
    }
  }, [kind, langs])
  const set = useCallback((slot, lang, text) => {
    touched.current.add(`${slot}:${lang}`)
    setValues((v) => ({ ...v, [slot]: { ...v[slot], [lang]: text } }))
  }, [])
  /** Save what was typed, against the English the form saved. Call after the record itself is saved. */
  const save = useCallback(async () => {
    for (const l of langs) {
      const entries = Object.keys(english.current)
        .filter((slot) => english.current[slot] && touched.current.has(`${slot}:${l.code}`))
        .map((slot) => ({ english: english.current[slot], value: String(values[slot]?.[l.code] ?? '').trim() }))
      if (entries.length) await saveRecordLocalNames(l.code, kind, entries)
    }
    touched.current.clear()
  }, [kind, langs, values])
  // something typed and not saved yet (re-computed on each render: set() changes `values`)
  const dirty = touched.current.size > 0
  return { kind, langs, values, track, load, set, save, dirty }
}

/** The local-language box(es) for one name in a form; nothing when the school keeps names only in English. */
export default function LocalNameField({ names, slot, english, label, disabled, required, className }) {
  const { t } = useTranslation('ui')
  const first = useRef(english)
  names.track(slot, english)
  // the name the record was opened with: its saved local text fills the box
  useEffect(() => { names.load(slot, first.current) }, [names.load, slot])
  if (!names.langs.length) return null
  return names.langs.map((l) => (
    <LocalNameBox key={l.code} language={l} value={names.values[slot]?.[l.code] ?? ''} onChange={(text) => names.set(slot, l.code, text)}
      english={english} label={t('ui.localName.label', { label, language: l.nativeName })} disabled={disabled} required={required} className={className} />
  ))
}

// a word ends here: turn the English letters typed so far into the script
const WORD_END = /[\s.,\-'()/]$/

/**
 * One language's box. In a script we can type phonetically (Hindi), English letters turn into the script
 * at the end of each word and on leaving the box ("uday " → "उदय "); with the box empty, the English name
 * written in the script is offered in one click.
 */
function LocalNameBox({ language, value, onChange, english, label, disabled, required, className }) {
  const { t } = useTranslation('ui')
  const phonetic = canTransliterate(language)
  const convert = (text) => (phonetic && hasLatin(text) ? transliterate(text, language) : text)
  const suggestion = phonetic && !value.trim() && String(english ?? '').trim() ? convert(String(english).trim()) : ''

  const change = (e) => {
    const text = e.target.value
    // only when typing at the end, so the cursor never jumps while someone corrects the middle
    const atEnd = e.target.selectionStart === text.length
    onChange(atEnd && WORD_END.test(text) ? convert(text) : text)
  }
  const blur = () => { if (phonetic && hasLatin(value)) onChange(convert(value)) }

  const hint = (
    <>
      {suggestion && (
        <button type="button" onClick={() => onChange(suggestion)} disabled={disabled} lang={language.code}
          className="me-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-brand-50 text-brand-700 font-medium hover:bg-brand-100">
          {t('ui.localName.use', { text: suggestion })}
        </button>
      )}
      {phonetic ? t('ui.localName.hintTyping', { language: language.nativeName }) : t('ui.localName.hint', { language: language.nativeName })}
    </>
  )
  return (
    <FormField className={className} label={label} hint={hint} required={required}>
      <Input lang={language.code} value={value} onChange={change} onBlur={blur} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder={phonetic ? t('ui.localName.placeholderTyping', { language: language.nativeName }) : t('ui.localName.placeholder', { language: language.nativeName })} />
    </FormField>
  )
}
