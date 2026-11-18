import { describe, expect, it } from 'vitest'
import { transliterateChoices, transliterateText, transliterateWord, typingLanguages } from '@schoolgiant/shared'

// Typing Hindi / Kannada with an English keyboard (shared/typing.js): the word as it sounds → the script.
describe('typing in another language', () => {
  it('writes Hindi the way people type it', () => {
    expect(transliterateWord('kitaab', 'hi')).toBe('किताब')
    expect(transliterateWord('kya', 'hi')).toBe('क्या') // a final "a" is long
    expect(transliterateWord('ladki', 'hi')).toBe('लड़की') // known word
    expect(transliterateWord('sankhya', 'hi')).toBe('संख्या') // n before a consonant: the dot
    expect(transliterateWord('Vidyaalay', 'hi')).toBe('विद्यालय') // a capital at the start is not a sound
    expect(transliterateText('R. K. Sharma', 'hi')).toBe('आर. के. शर्मा') // initials, and a name
    expect(transliterateText('yah 2 pustak, ok?', 'hi')).toBe('यह 2 पुस्तक, ओक?')
  })

  it('writes Kannada with its short e/o and a closing ್', () => {
    expect(transliterateWord('hesaru', 'kn')).toBe('ಹೆಸರು')
    expect(transliterateWord('shaale', 'kn')).toBe('ಶಾಲೆ')
    expect(transliterateWord('kannaDa', 'kn')).toBe('ಕನ್ನಡ')
    expect(transliterateWord('bas', 'kn')).toBe('ಬಸ್')
  })

  it('offers the other spellings, the first being what was written, and remembers a pick', () => {
    const c = transliterateChoices('kitab', 'hi')
    expect(c[0]).toBe('किताब')
    expect(c).toContain('कितब')
    expect(transliterateChoices('pani', 'hi')).toContain('पानी')
    expect(transliterateWord('pani', 'hi', { learned: { pani: 'पानी' } })).toBe('पानी')
  })

  it('leaves English and what it can’t read alone', () => {
    expect(transliterateWord('kitaab', 'en')).toBeNull()
    expect(transliterateWord('abc123', 'hi')).toBeNull()
    expect(typingLanguages().map((l) => l.code)).toEqual(expect.arrayContaining(['hi', 'kn']))
  })
})
