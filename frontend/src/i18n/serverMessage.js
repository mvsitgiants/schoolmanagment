import i18n from './index'
import enErrors from './locales/en/errors.json'

// Server error messages arrive in English. Their translations live in the `errors` namespace, keyed by a short hash
// of the English text — the key list is generated from the backend's error calls, so the server keeps sending plain
// English and needs no change. Messages built with values ("Bed B-12 is occupied.") are stored as templates
// ("Bed {{v1}} is occupied."): the English template is matched against the message and the values are carried into
// the translation. Anything unknown is shown exactly as the server sent it.

/** FNV-1a (32-bit) of the trimmed English text → "m" + 8 hex digits. The generator uses the same function. */
export function messageKey(text) {
  let h = 0x811c9dc5
  const s = String(text).trim()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `m${h.toString(16).padStart(8, '0')}`
}

let patterns = null
/** English templates with {{v1}}… → regexes, most specific (most fixed text) first. */
function templatePatterns() {
  if (patterns) return patterns
  patterns = Object.entries(enErrors.errors ?? {})
    .filter(([, en]) => /\{\{v\d+\}\}/.test(en))
    .map(([key, en]) => {
      const names = []
      const source = en.split(/(\{\{v\d+\}\})/).map((part) => {
        const m = part.match(/^\{\{(v\d+)\}\}$/)
        if (m) { names.push(m[1]); return '(.+?)' }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('')
      return { key, names, re: new RegExp(`^${source}$`, 's'), fixed: en.replace(/\{\{v\d+\}\}/g, '').length }
    })
    .sort((a, b) => b.fixed - a.fixed)
  return patterns
}

/** English server message → the user's language, or the same text when there is no translation. */
export function translateServerMessage(text) {
  if (!text || typeof text !== 'string') return text
  const exact = i18n.t(`errors.${messageKey(text)}`, { ns: 'errors', defaultValue: '' })
  if (exact) return exact
  const msg = text.trim()
  for (const p of templatePatterns()) {
    const m = msg.match(p.re)
    if (m) return i18n.t(`errors.${p.key}`, { ns: 'errors', ...Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])), defaultValue: text })
  }
  return text
}
