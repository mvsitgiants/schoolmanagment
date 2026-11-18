// English letters → the language's script, for the "Name in हिन्दी / ಕನ್ನಡ" boxes ("uday" → उदय). The sounds, the
// common name words and the per-script rules live in shared/typing.js (also used by typing in the content editor).
import { transliterateText, typingScriptOf } from '@schoolgiant/shared'

/** Whether names in this language (a SUPPORTED_LANGUAGES row) can be typed in English letters. */
export const canTransliterate = (language) => !!typingScriptOf(language?.code)

/** Every run of English letters in `text` written in the language's script; the rest stays as typed. */
export const transliterate = (text, language) => (canTransliterate(language) ? transliterateText(text, language.code) : text)

/** Whether there is anything in English letters left to turn. */
export const hasLatin = (text) => /[A-Za-z]/.test(String(text ?? ''))
