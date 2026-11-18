// npm run i18n:sync -- --lang kn
// Keeps one language's translation files in step with English: every English file and key exists in the language
// (a new key starts as the English text, so screens never show a raw key), and keys English no longer has are removed.
// Translated texts are never touched. Run it before translating a phase, and after English gains new texts.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const L = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales')
const lang = process.argv[process.argv.indexOf('--lang') + 1]
if (!process.argv.includes('--lang') || !/^[a-z]{2,3}$/.test(lang ?? '') || lang === 'en') {
  console.error('Name the language: npm run i18n:sync -- --lang kn')
  process.exit(1)
}

/** English's shape with the language's texts where it has them. */
function merge(en, own) {
  if (Array.isArray(en)) return Array.isArray(own) && own.length === en.length ? own : en
  if (en && typeof en === 'object') return Object.fromEntries(Object.entries(en).map(([k, v]) => [k, merge(v, own?.[k])]))
  return typeof own === typeof en && own !== '' ? own : en
}
const countKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.values(o).reduce((n, v) => n + countKeys(v), 0) : 1)

fs.mkdirSync(path.join(L, lang), { recursive: true })
let added = 0
let removed = 0
for (const file of fs.readdirSync(path.join(L, 'en')).filter((f) => f.endsWith('.json'))) {
  const en = JSON.parse(fs.readFileSync(path.join(L, 'en', file), 'utf8'))
  const target = path.join(L, lang, file)
  const own = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {}
  const out = merge(en, own)
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  const text = JSON.stringify(out, null, 2) + '\n'
  if (text !== before) {
    added += Math.max(0, countKeys(en) - countKeys(own))
    removed += Math.max(0, countKeys(own) - countKeys(out))
    fs.writeFileSync(target, text)
  }
}
console.log(`✓ ${lang}: every English file and key is there (${added} added in English, ${removed} no longer used removed)`)
