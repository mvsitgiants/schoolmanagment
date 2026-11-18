// Typing in Hindi, Kannada … with an English keyboard (shared/typing.js does the sounds → letters).
//
// Where it works: text boxes inside an element marked `data-typein`:
//   data-typein="auto"  follows the switch the teacher sets (TypeInButton) — the content editor, a topic's notes …
//   data-typein="hi"    always that language — the "Name in हिन्दी" boxes
//   data-typein="off"   never (a box inside an "auto" area that holds codes, e-mail …)
// A word is written in the language when the teacher presses space, Enter or a punctuation mark. The other spellings
// of the last word show under it (TypeInBar); a pick is remembered on this device for next time.
import { useSyncExternalStore } from 'react'
import { transliterateChoices, transliterateWord, typingFullStop, typingScriptOf } from '@schoolgiant/shared'

const MODE_KEY = 'sg.typeIn'
const LEARN_KEY = (lang) => `sg.typeIn.words.${lang}`
const LEARN_MAX = 3000

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window: forget */ } }

let mode = read(MODE_KEY, null) // the switch: a language code, or null = English
let last = null // the last word written: { el, lang, roman, native, at (input index) | node + offset }
const subs = new Set()
const tell = () => subs.forEach((f) => f())
const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }

export function setTypeIn(lang) { mode = typingScriptOf(lang) ? lang : null; store(MODE_KEY, mode); last = null; tell() }
export const useTypeIn = () => useSyncExternalStore(subscribe, () => mode)
export const useLastTyped = () => useSyncExternalStore(subscribe, () => last)
export const forgetLastTyped = () => { if (last) { last = null; tell() } }

const learned = (lang) => read(LEARN_KEY(lang), {})
function learn(lang, roman, native) {
  const words = learned(lang)
  delete words[roman]
  words[roman] = native
  const keys = Object.keys(words)
  if (keys.length > LEARN_MAX) keys.slice(0, keys.length - LEARN_MAX).forEach((k) => delete words[k])
  store(LEARN_KEY(lang), words)
}

const TEXT_INPUT = new Set(['', 'text', 'search'])
/** The language a box types in, or null. */
function langFor(el) {
  if (!el || el.readOnly || el.disabled) return null
  const box = el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.has(el.getAttribute('type') ?? ''))
  if (!box) return null
  const zone = el.closest('[data-typein]')?.getAttribute('data-typein')
  const lang = zone === 'auto' ? mode : zone === 'off' ? null : zone
  return lang && typingScriptOf(lang) ? lang : null
}

const WORD_END = /[A-Za-z]+$/

// Letters typed since the caret last moved: only a word typed just now is turned, never one already in the text
// (Enter at the end of an English line must leave its last word alone).
let typedRun = 0
const typedJustNow = (word) => !!word && word.length <= typedRun
// what ends a word: space, Enter, and punctuation
const ENDS = /^[\s.,!?;:)\]"'’”-]$/

/** In an input or textarea: the English-letter word just before the caret → the language. Returns true when it changed. */
function convertInput(el, lang, tail = '') {
  const end = el.selectionStart
  if (end == null || end !== el.selectionEnd) return false
  const before = el.value.slice(0, end)
  const word = before.match(WORD_END)?.[0]
  const native = typedJustNow(word) && transliterateWord(word, lang, { learned: learned(lang) })
  typedRun = 0
  const mark = fullStop(lang, tail, native || before)
  if (!native && mark === tail) return false
  const start = native ? end - word.length : end
  const text = (native || '') + mark
  el.setRangeText(text, start, end, 'end')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  if (native) { last = { el, lang, roman: word, native, at: start }; tell() }
  return true
}

/** "." after a word in Hindi is "।". */
const fullStop = (lang, tail, before) => (tail === '.' && typingFullStop(lang) && /[^\x20-\x7e]$/.test(before) ? typingFullStop(lang) : tail)

/** In the rich editor: the same, through the browser's own typing (keeps undo, and the editor hears it). */
let busy = false
function convertEditable(lang, tail) {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !sel.isCollapsed) return false
  const node = sel.anchorNode
  if (node?.nodeType !== Node.TEXT_NODE) return false
  const end = sel.anchorOffset
  const word = node.data.slice(0, end).match(WORD_END)?.[0]
  const native = typedJustNow(word) && transliterateWord(word, lang, { learned: learned(lang) })
  typedRun = 0
  if (!native) return false
  const range = document.createRange()
  range.setStart(node, end - word.length)
  range.setEnd(node, end)
  sel.removeAllRanges()
  sel.addRange(range)
  busy = true
  try { document.execCommand('insertText', false, native + fullStop(lang, tail === '\n' ? '' : tail, native)) } finally { busy = false }
  if (tail === '\n') document.execCommand('insertParagraph')
  // where the word now sits, so a different spelling can replace it
  const at = window.getSelection()
  const tailLen = tail === '\n' ? 0 : (tail ? 1 : 0)
  if (at?.anchorNode?.nodeType === Node.TEXT_NODE && tail !== '\n') {
    last = { el: at.anchorNode.parentElement?.closest('[contenteditable]'), lang, roman: word, native, node: at.anchorNode, offset: at.anchorOffset - tailLen - native.length }
  } else last = null
  tell()
  return true
}

function onBeforeInput(e) {
  if (busy || e.isComposing) return
  const el = e.target
  const lang = langFor(el.isContentEditable ? el.closest('[contenteditable]') ?? el : el)
  if (!lang) return
  const tail = e.inputType === 'insertText' && ENDS.test(e.data ?? '') ? e.data
    : (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') ? '\n' : null
  if (tail == null) {
    if (e.inputType === 'insertText' && /^[A-Za-z]+$/.test(e.data ?? '')) typedRun += e.data.length
    else if (e.inputType === 'deleteContentBackward') typedRun = Math.max(0, typedRun - 1)
    else typedRun = 0
    if (e.inputType === 'insertText') forgetLastTyped()
    return
  }
  if (!e.cancelable) return // a phone keyboard's own word: left as it is
  if (el.isContentEditable) {
    if (convertEditable(lang, tail)) e.preventDefault()
  } else if (convertInput(el, lang, tail === '\n' ? (el.tagName === 'TEXTAREA' ? '\n' : '') : tail)) e.preventDefault()
}

const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const caretMoved = () => { typedRun = 0 }

// Enter in a one-line box submits the form without a beforeinput: write the word first
function onKeyDown(e) {
  if (MOVES.has(e.key)) { caretMoved(); return }
  if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return
  const lang = langFor(e.target)
  if (lang) convertInput(e.target, lang)
}

let installed = false
export function installTypeIn() {
  if (installed) return
  installed = true
  document.addEventListener('beforeinput', onBeforeInput, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('mousedown', caretMoved, true)
  document.addEventListener('focusin', caretMoved, true)
}

/** The spellings to offer for the last word, the one in place first. */
export function choicesFor(l) {
  if (!l) return []
  const list = transliterateChoices(l.roman, l.lang, { learned: learned(l.lang) })
  return [...new Set([l.native, ...list])]
}

/** Put another spelling (or the English letters back) in place of the last word, and remember it. */
export function replaceLastTyped(text) {
  const l = last
  if (!l) return false
  if (l.node) {
    if (!l.node.isConnected || l.node.data.slice(l.offset, l.offset + l.native.length) !== l.native) { forgetLastTyped(); return false }
    const range = document.createRange()
    range.setStart(l.node, l.offset)
    range.setEnd(l.node, l.offset + l.native.length)
    const sel = window.getSelection()
    l.el?.focus()
    sel.removeAllRanges()
    sel.addRange(range)
    busy = true
    try { document.execCommand('insertText', false, text) } finally { busy = false }
    const after = window.getSelection()
    // put the caret back after the space that followed the word
    if (after?.anchorNode?.nodeType === Node.TEXT_NODE && after.anchorNode.data.length > after.anchorOffset) {
      const r = document.createRange(); r.setStart(after.anchorNode, after.anchorOffset + 1); r.collapse(true); after.removeAllRanges(); after.addRange(r)
    }
    last = { ...l, native: text, node: after?.anchorNode ?? l.node }
  } else {
    if (!l.el.isConnected || l.el.value.slice(l.at, l.at + l.native.length) !== l.native) { forgetLastTyped(); return false }
    l.el.focus()
    const caret = l.el.selectionStart - l.native.length + text.length
    l.el.setRangeText(text, l.at, l.at + l.native.length)
    l.el.setSelectionRange(caret, caret)
    l.el.dispatchEvent(new Event('input', { bubbles: true }))
    last = { ...l, native: text }
  }
  if (text !== l.roman) learn(l.lang, l.roman, text)
  tell()
  return true
}
