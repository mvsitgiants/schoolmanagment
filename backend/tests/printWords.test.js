import { describe, expect, it } from 'vitest'
import { amountInWordsFor, classInWords, dateInWords, numberInWords, wordsFor } from '../src/documents/words.js'

// Amounts, dates and classes in words come from each language's printWords.json — one rule for every language.
describe('words on printed documents', () => {
  it('writes amounts in English and Hindi, Indian grouping', () => {
    expect(amountInWordsFor(4130000, 'en')).toBe('Rupees Forty One Thousand Three Hundred Only')
    expect(amountInWordsFor(4130000, 'hi')).toBe('इकतालीस हज़ार तीन सौ रुपये मात्र')
    expect(amountInWordsFor(123456789, 'en')).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only')
    expect(amountInWordsFor(100, 'hi')).toBe('एक रुपया मात्र')
    expect(amountInWordsFor(-2450000, 'hi')).toBe('ऋण चौबीस हज़ार पाँच सौ रुपये मात्र')
    expect(numberInWords(123456789, 'hi')).toBe('बारह करोड़ चौंतीस लाख छप्पन हज़ार सात सौ नवासी')
  })

  it('writes dates as each language says them', () => {
    expect(dateInWords('2013-05-10', 'en')).toBe('Tenth May Two Thousand Thirteen')
    expect(dateInWords('2013-05-10', 'hi')).toBe('दस मई दो हज़ार तेरह')
    expect(dateInWords('1998-11-21', 'hi')).toBe('इक्कीस नवंबर उन्नीस सौ अट्ठानवे') // years before 2000 in hundreds
    expect(dateInWords('1998-11-21', 'en')).toBe('Twenty First November One Thousand Nine Hundred Ninety Eight')
    expect(dateInWords('not a date', 'hi')).toBe('')
  })

  it('gives the class in words, and division names', () => {
    expect(classInWords('Class 8 – A', 'hi')).toBe('आठवीं')
    expect(classInWords('Class XII', 'en')).toBe('Twelfth')
    expect(classInWords('Nursery', 'hi')).toBe('')
    expect(wordsFor('hi').divisions[0]).toBe('प्रथम श्रेणी')
  })

  it('falls back to English for a language without its own words', () => {
    expect(amountInWordsFor(4130000, 'mr')).toBe('Rupees Forty One Thousand Three Hundred Only')
    expect(dateInWords('2013-05-10', '../hi')).toBe('Tenth May Two Thousand Thirteen') // not a language code
  })

  it('has every list a language needs, at the right length', () => {
    for (const lang of ['en', 'hi']) {
      const W = wordsFor(lang)
      expect(W.numbers).toHaveLength(100)
      expect(W.days).toHaveLength(32)
      expect(W.months).toHaveLength(12)
      expect(W.classOrdinals).toHaveLength(21)
      expect(W.divisions).toHaveLength(4)
    }
  })
})
