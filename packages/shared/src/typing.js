// Typing in another language with an English keyboard: a word typed the way it sounds ("kitaab") is written in the
// language's script (किताब) when the teacher presses space. Works on the device, no internet and no AI.
//
// Indian scripts share one layout in Unicode (क is 0x15 into Devanagari, ಕ is 0x15 into Kannada …), so one sound table
// serves every script below; a script only says where its block starts and how it differs. A new language that uses
// one of these scripts needs no code: its row in languages.js names the script. Common words a sound table can't get
// right ("hain" → हैं) and the full stop of the language go in TYPING_LANGUAGES.
import { SUPPORTED_LANGUAGES } from './languages.js'

/** Per script: where its Unicode block starts, and how it differs from Devanagari. */
export const TYPING_SCRIPTS = {
  // finalA: a word-final "a" is the long आ ("kya" → क्या, "raja" → राजा), as people type Hindi in English letters;
  // finalI: a word-final "i" is the long ई too ("ladki" → लड़की, "achchhi" → अच्छी);
  // fullLetters: offer the word with its consonants written in full too (people type "ladka" for लड़का)
  Devanagari: { base: 0x0900, shortEO: false, nukta: true, finalHalant: false, finalA: 'long', finalI: 'long', fullLetters: true },
  Gujarati: { base: 0x0a80, shortEO: false, nukta: true, finalHalant: false, finalA: 'long', fullLetters: true },
  // shortEO: "e"/"o" are the short ಎ/ಒ and "E"/"O" the long ಏ/ಓ; finalHalant: a word ending in a consonant ends with ್ ("bas" → ಬಸ್)
  Kannada: { base: 0x0c80, shortEO: true, nukta: false, finalHalant: true, finalA: 'short' },
  Telugu: { base: 0x0c00, shortEO: true, nukta: false, finalHalant: true, finalA: 'short' },
  Malayalam: { base: 0x0d00, shortEO: true, nukta: false, finalHalant: true, finalA: 'short' },
}

// Offsets into the block (Devanagari values: अ = 0x0905 → 0x05).
const VOWEL = { A: 0x05, AA: 0x06, I: 0x07, II: 0x08, U: 0x09, UU: 0x0a, RI: 0x0b, E: 0x0e, EE: 0x0f, AI: 0x10, O: 0x12, OO: 0x13, AU: 0x14 }
const MATRA = { AA: 0x3e, I: 0x3f, II: 0x40, U: 0x41, UU: 0x42, RI: 0x43, E: 0x46, EE: 0x47, AI: 0x48, O: 0x4a, OO: 0x4b, AU: 0x4c }
const HALANT = 0x4d
const ANUSVARA = 0x02
const VISARGA = 0x03
const NUKTA = 0x3c

// The sounds, longest first where one starts another. A consonant is one or more letters (क्ष is क + ्‌ + ष);
// `nukta` marks the dotted letters (फ़, ज़) of scripts that have them.
const CONSONANTS = [
  ['ksh', [0x15, 0x37]], ['gy', [0x1c, 0x1e]], ['GY', [0x1c, 0x1e]],
  ['chh', [0x1b]], ['Ch', [0x1b]], ['ch', [0x1a]], ['c', [0x15]],
  ['kh', [0x16]], ['k', [0x15]], ['K', [0x15]], ['q', [0x15], true], ['x', [0x15, 0x38]],
  ['gh', [0x18]], ['g', [0x17]], ['G', [0x17]],
  ['jh', [0x1d]], ['j', [0x1c]], ['J', [0x1c]], ['z', [0x1c], true], ['Z', [0x1c], true],
  ['Th', [0x20]], ['T', [0x1f]], ['th', [0x25]], ['t', [0x24]],
  ['Dh', [0x22]], ['D', [0x21]], ['dh', [0x27]], ['d', [0x26]],
  ['Rh', [0x22], true], ['R', [0x21], true], // ड़ ढ़: "laRkaa" → लड़का
  ['N', [0x23]], ['n', [0x28]],
  ['ph', [0x2b]], ['p', [0x2a]], ['P', [0x2a]], ['f', [0x2b], true], ['F', [0x2b], true],
  ['bh', [0x2d]], ['b', [0x2c]], ['B', [0x2c]],
  ['m', [0x2e]], ['y', [0x2f]], ['Y', [0x2f]], ['r', [0x30]], ['L', [0x33]], ['l', [0x32]],
  ['v', [0x35]], ['V', [0x35]], ['w', [0x35]], ['W', [0x35]],
  ['Sh', [0x37]], ['shh', [0x37]], ['sh', [0x36]], ['s', [0x38]], ['S', [0x36]],
  ['h', [0x39]],
]
const VOWELS = [
  ['RRi', 'RI'],
  ['aa', 'AA'], ['A', 'AA'], ['ai', 'AI'], ['au', 'AU'], ['ou', 'AU'], ['a', 'A'],
  ['ee', 'II'], ['ii', 'II'], ['I', 'II'], ['i', 'I'],
  ['oo', 'UU'], ['uu', 'UU'], ['U', 'UU'], ['u', 'U'],
  ['E', 'EE'], ['e', 'E'], ['O', 'OO'], ['o', 'O'],
]
const MARKS = [['M', ANUSVARA], ['H', VISARGA]]
// 'n' before these sounds is written as the dot (ं): "hindi" → हिंदी, "sankhya" → संख्या; before य र ल व ह न म it stays न्
const NASAL_DOT_BEFORE = new Set([0x15, 0x16, 0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x1d, 0x1f, 0x20, 0x21, 0x22, 0x24, 0x25, 0x26, 0x27, 0x2a, 0x2b, 0x2c, 0x2d, 0x36, 0x37, 0x38])

// 'm' before प फ ब भ: the dot too ("champa" → चंपा, "sambhav" → संभव)
const M_DOT_BEFORE = new Set([0x2a, 0x2b, 0x2c, 0x2d])

/** The words people type in English letters that a sound table gets wrong, and the language's full stop. */
export const TYPING_LANGUAGES = {
  hi: {
    fullStop: '।',
    // names that end in -ndra keep the short end (महेन्द्र); other words ending in "a" are long (शर्मा, गरिमा)
    shortEnd: /ndra$/,
    // a single letter (an initial, "R. K.") is written as it is said
    letters: {
  a: 'ए', b: 'बी', c: 'सी', d: 'डी', e: 'ई', f: 'एफ़', g: 'जी', h: 'एच', i: 'आई', j: 'जे', k: 'के', l: 'एल', m: 'एम',
  n: 'एन', o: 'ओ', p: 'पी', q: 'क्यू', r: 'आर', s: 'एस', t: 'टी', u: 'यू', v: 'वी', w: 'डब्ल्यू', x: 'एक्स', y: 'वाई', z: 'ज़ेड',
    },
    // common name words, where the English spelling hides a long vowel or a hard sound
    names: {
  singh: 'सिंह', kumar: 'कुमार', kumari: 'कुमारी', ram: 'राम', raj: 'राज', rajesh: 'राजेश', rakesh: 'राकेश', rahul: 'राहुल',
  raju: 'राजू', rajan: 'राजन', rajeev: 'राजीव', rajiv: 'राजीव', rajendra: 'राजेन्द्र', ravindra: 'रवीन्द्र', anand: 'आनंद',
  krishna: 'कृष्ण', chandra: 'चन्द्र', prakash: 'प्रकाश', prasad: 'प्रसाद', lal: 'लाल', devi: 'देवी', rani: 'रानी', bai: 'बाई',
  lakshmi: 'लक्ष्मी', laxmi: 'लक्ष्मी', sita: 'सीता', gita: 'गीता', radha: 'राधा', shanti: 'शान्ति', jyoti: 'ज्योति',
  ali: 'अली', mohammad: 'मोहम्मद', mohammed: 'मोहम्मद', muhammad: 'मुहम्मद', mohd: 'मोहम्मद', khan: 'ख़ान', ahmad: 'अहमद',
  shri: 'श्री', sri: 'श्री', ji: 'जी', yadav: 'यादव', pandey: 'पाण्डेय', pande: 'पाण्डे', maurya: 'मौर्य', bhatt: 'भट्ट',
  thakur: 'ठाकुर', shah: 'शाह', tiwari: 'तिवारी', tripathi: 'त्रिपाठी', dubey: 'दुबे', chaubey: 'चौबे', chaudhary: 'चौधरी',
  chaudhari: 'चौधरी', choudhary: 'चौधरी', agarwal: 'अग्रवाल', agrawal: 'अग्रवाल', sinha: 'सिन्हा', rao: 'राव', reddy: 'रेड्डी',
  nair: 'नायर', das: 'दास', dutta: 'दत्ता', bose: 'बोस', joshi: 'जोशी', rathore: 'राठौर', rawat: 'रावत', negi: 'नेगी',
  bisht: 'बिष्ट', saxena: 'सक्सेना', srivastava: 'श्रीवास्तव', shrivastava: 'श्रीवास्तव', srivastav: 'श्रीवास्तव',
  arora: 'अरोड़ा', kaur: 'कौर', patil: 'पाटिल', naidu: 'नायडू', iyer: 'अय्यर', pathak: 'पाठक', dixit: 'दीक्षित',
  dwivedi: 'द्विवेदी', trivedi: 'त्रिवेदी', chaturvedi: 'चतुर्वेदी', upadhyay: 'उपाध्याय', bajpai: 'बाजपेयी', vajpayee: 'वाजपेयी',
  rajput: 'राजपूत', chauhan: 'चौहान', solanki: 'सोलंकी', rana: 'राणा', kashyap: 'कश्यप', nishad: 'निषाद', paswan: 'पासवान',
  prajapati: 'प्रजापति', vishwakarma: 'विश्वकर्मा', kushwaha: 'कुशवाहा', rajbhar: 'राजभर', ansari: 'अंसारी', qureshi: 'क़ुरैशी',
  siddiqui: 'सिद्दीक़ी', fatima: 'फ़ातिमा', abdul: 'अब्दुल', ashok: 'अशोक', deepak: 'दीपक', dinesh: 'दिनेश', mukesh: 'मुकेश',
  ramesh: 'रमेश', suresh: 'सुरेश', naresh: 'नरेश', mahesh: 'महेश', ganesh: 'गणेश', santosh: 'संतोष', manoj: 'मनोज',
  pramod: 'प्रमोद', vinod: 'विनोद', arvind: 'अरविंद', anil: 'अनिल', sunil: 'सुनील', sushil: 'सुशील', kamal: 'कमल',
  gopal: 'गोपाल', shyam: 'श्याम', mohan: 'मोहन', sohan: 'सोहन', ajay: 'अजय', vijay: 'विजय', sanjay: 'संजय', uday: 'उदय',
  ravi: 'रवि', kavi: 'कवि', aditi: 'अदिति', swati: 'स्वाति', smriti: 'स्मृति', shruti: 'श्रुति', kirti: 'कीर्ति', muni: 'मुनि', hari: 'हरि', mani: 'मणि',
  aarav: 'आरव', aditya: 'आदित्य', arjun: 'अर्जुन', vivek: 'विवेक', vikas: 'विकास', akash: 'आकाश', aakash: 'आकाश',
  pooja: 'पूजा', puja: 'पूजा', priya: 'प्रिया', neha: 'नेहा', anjali: 'अंजलि', kavita: 'कविता', sunita: 'सुनीता',
  anita: 'अनीता', savita: 'सविता', geeta: 'गीता', seema: 'सीमा', rekha: 'रेखा', asha: 'आशा', usha: 'उषा', meena: 'मीना',
  verma: 'वर्मा', varma: 'वर्मा', patel: 'पटेल', harsh: 'हर्ष', ayush: 'आयुष', piyush: 'पीयूष', subhash: 'सुभाष',
  ashutosh: 'आशुतोष', kritika: 'कृतिका', krish: 'कृष', rishi: 'ऋषि', ritu: 'ऋतु', ankit: 'अंकित', ankita: 'अंकिता',
  shivam: 'शिवम', shiv: 'शिव', satyam: 'सत्यम', aryan: 'आर्यन', ananya: 'अनन्या', kartik: 'कार्तिक', karan: 'करण',
  tarun: 'तरुण', varun: 'वरुण', arun: 'अरुण', tanya: 'तान्या', diya: 'दिया', riya: 'रिया', sakshi: 'साक्षी', nidhi: 'निधि',
  sarita: 'सरिता', mamta: 'ममता', manju: 'मंजू', saroj: 'सरोज', kiran: 'किरण', garima: 'गरिमा', aarti: 'आरती', arti: 'आरती',
    },
    words: {
      hai: 'है', hain: 'हैं', ho: 'हो', hona: 'होना', tha: 'था', thi: 'थी', the: 'थे', main: 'मैं', mein: 'में', me: 'में',
      ham: 'हम', hum: 'हम', aap: 'आप', tum: 'तुम', vah: 'वह', wah: 'वह', woh: 'वह', wo: 'वो', yah: 'यह', yeh: 'यह', ye: 'ये', ve: 'वे',
      ki: 'की', ka: 'का', ke: 'के', ko: 'को', se: 'से', par: 'पर', aur: 'और', ya: 'या', bhi: 'भी', hi: 'ही', to: 'तो', toh: 'तो', na: 'न',
      nahi: 'नहीं', nahin: 'नहीं', kya: 'क्या', kyon: 'क्यों', kyun: 'क्यों', kyonki: 'क्योंकि', kyunki: 'क्योंकि', kaise: 'कैसे', kab: 'कब',
      kahan: 'कहाँ', kaun: 'कौन', kitna: 'कितना', kitne: 'कितने', kitni: 'कितनी',
      ek: 'एक', do: 'दो', teen: 'तीन', char: 'चार', chaar: 'चार', panch: 'पाँच', paanch: 'पाँच', chhah: 'छह', saat: 'सात', aath: 'आठ', nau: 'नौ', das: 'दस',
      sab: 'सब', sabhi: 'सभी', kuchh: 'कुछ', kuch: 'कुछ', bahut: 'बहुत', apna: 'अपना', apne: 'अपने', apni: 'अपनी',
      is: 'इस', us: 'उस', in: 'इन', un: 'उन', iske: 'इसके', uske: 'उसके', iska: 'इसका', uska: 'उसका', inka: 'इनका', unka: 'उनका', jo: 'जो', jab: 'जब', tab: 'तब',
      yahan: 'यहाँ', wahan: 'वहाँ', vahan: 'वहाँ', ab: 'अब', phir: 'फिर', fir: 'फिर', lekin: 'लेकिन', agar: 'अगर', ji: 'जी',
      shri: 'श्री', shrimati: 'श्रीमती', kumari: 'कुमारी',
      path: 'पाठ', paath: 'पाठ', prashn: 'प्रश्न', prashna: 'प्रश्न', prashnon: 'प्रश्नों', uttar: 'उत्तर', uttaron: 'उत्तरों',
      chhatra: 'छात्र', chhatron: 'छात्रों', vidyarthi: 'विद्यार्थी', adhyay: 'अध्याय', abhyas: 'अभ्यास', abhyaas: 'अभ्यास', kaksha: 'कक्षा',
      vishay: 'विषय', ganit: 'गणित', vigyan: 'विज्ञान', vigyaan: 'विज्ञान', hindi: 'हिन्दी', angrezi: 'अंग्रेज़ी', sanskrit: 'संस्कृत', itihas: 'इतिहास',
      bhugol: 'भूगोल', shiksha: 'शिक्षा', shikshak: 'शिक्षक', pariksha: 'परीक्षा', ank: 'अंक',
      likhiye: 'लिखिए', likhie: 'लिखिए', likhen: 'लिखें', padhiye: 'पढ़िए', padhen: 'पढ़ें', padhe: 'पढ़े', padhna: 'पढ़ना',
      samjhaiye: 'समझाइए', samjhaie: 'समझाइए', bataiye: 'बताइए', bataie: 'बताइए', kijiye: 'कीजिए', kijie: 'कीजिए',
      karen: 'करें', kare: 'करे', karo: 'करो', karna: 'करना', kar: 'कर', gaya: 'गया', gayi: 'गई', gaye: 'गए', kiya: 'किया', liye: 'लिए', lie: 'लिए',
      dwara: 'द्वारा', sath: 'साथ', saath: 'साथ', beech: 'बीच', upar: 'ऊपर', neeche: 'नीचे', niche: 'नीचे', pahle: 'पहले', pehle: 'पहले', baad: 'बाद',
      din: 'दिन', saal: 'साल', varsh: 'वर्ष', samay: 'समय', udaharan: 'उदाहरण', uddeshya: 'उद्देश्य', mukhya: 'मुख्य', baaten: 'बातें', baatein: 'बातें',
      shabd: 'शब्द', arth: 'अर्थ', vakya: 'वाक्य', vaakya: 'वाक्य', nibandh: 'निबंध', kavita: 'कविता', kahani: 'कहानी', ghar: 'घर',
      pustak: 'पुस्तक', kitab: 'किताब', kitaab: 'किताब', sahi: 'सही', galat: 'गलत', sankhya: 'संख्या', bhinn: 'भिन्न', jod: 'जोड़', ghatana: 'घटाना',
      guna: 'गुणा', bhag: 'भाग', kshetrafal: 'क्षेत्रफल', parimap: 'परिमाप', ladka: 'लड़का', ladke: 'लड़के', achchha: 'अच्छा', achchhi: 'अच्छी', achchhe: 'अच्छे', accha: 'अच्छा', acchi: 'अच्छी', acche: 'अच्छे', padh: 'पढ़', krishna: 'कृष्ण', ram: 'राम', kamra: 'कमरा', samajh: 'समझ', ladki: 'लड़की', bada: 'बड़ा', badi: 'बड़ी', bade: 'बड़े',
    },
  },
}

/** The script a language is typed in, or null when it can't be typed with English letters (English itself). */
export function typingScriptOf(lang) {
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === lang)
  return l && l.code !== 'en' ? TYPING_SCRIPTS[l.script] ?? null : null
}

/** App languages that can be typed this way. */
export const typingLanguages = () => SUPPORTED_LANGUAGES.filter((l) => typingScriptOf(l.code))

/** "Kitaab" → "kitaab", "UDAY" → "uday": capitals for the whole word or only at its start are not sounds. */
const normal = (word) => (word.length > 1 && word === word.toUpperCase() ? word.toLowerCase() : /^[A-Z][a-z]+$/.test(word) ? word[0].toLowerCase() + word.slice(1) : word)

/** The word as sounds: [{ c: [offsets], nukta } | { v: 'AA' } | { m: offset }], or null when it has a letter we don't know. */
function sounds(word) {
  const out = []
  for (let i = 0; i < word.length;) {
    const rest = word.slice(i)
    const v = VOWELS.find(([s]) => rest.startsWith(s))
    const c = CONSONANTS.find(([s]) => rest.startsWith(s))
    const m = MARKS.find(([s]) => rest.startsWith(s))
    // the longer match wins ("ai" before "a", "kh" before "k")
    const pick = [v && { len: v[0].length, s: { v: v[1] } }, c && { len: c[0].length, s: { c: c[1], nukta: !!c[2] } }, m && { len: 1, s: { m: m[1] } }]
      .filter(Boolean).sort((a, b) => b.len - a.len || (('v' in b.s) - ('v' in a.s)))[0]
    if (!pick) return null
    out.push(pick.s)
    i += pick.len
  }
  return out
}

function write(list, script) {
  const ch = (off) => String.fromCodePoint(script.base + off)
  let s = ''
  for (let i = 0; i < list.length; i++) {
    const x = list[i]
    if (x.m != null) { s += ch(x.m); continue }
    if (x.v) {
      let v = x.v
      if (!script.shortEO && v === 'E') v = 'EE'
      if (!script.shortEO && v === 'O') v = 'OO'
      s += ch(VOWEL[v])
      continue
    }
    const next = list[i + 1]
    // न before a consonant of another sound group: the dot ं
    const afterVowel = !!list[i - 1]?.v
    if (afterVowel && !x.keepN && x.c.length === 1 && next?.c && ((x.c[0] === 0x28 && NASAL_DOT_BEFORE.has(next.c[0])) || (x.c[0] === 0x2e && M_DOT_BEFORE.has(next.c[0])))) { s += ch(ANUSVARA); continue }
    s += x.c.map((o, k) => ch(o) + (k < x.c.length - 1 ? ch(HALANT) : '')).join('')
    if (x.nukta && script.nukta) s += ch(NUKTA)
    if (next?.v) {
      let v = next.v
      if (!script.shortEO && v === 'E') v = 'EE'
      if (!script.shortEO && v === 'O') v = 'OO'
      if (v !== 'A') s += ch(MATRA[v])
      i++
      if (next.nasal) s += ch(ANUSVARA)
    } else if ((next?.c && !x.full) || (!next && script.finalHalant)) s += ch(HALANT)
  }
  return s
}

/** The word's sounds with the language's habits applied (a final "a" is आ in Hindi). */
function shaped(word, script, lang) {
  const key = normal(word)
  const list = sounds(key)
  if (!list) return null
  const last = list[list.length - 1]
  if (script.finalI === 'long' && list.length > 1 && last.v === 'I' && list[list.length - 2].c) list[list.length - 1] = { v: 'II', wasA: true }
  if (script.finalA === 'long' && !TYPING_LANGUAGES[lang]?.shortEnd?.test(key.toLowerCase()) && list.length > 1 && last.v === 'A' && list[list.length - 2].c) list[list.length - 1] = { v: 'AA', wasA: true }
  return list
}

/** One word typed in English letters, written in the language (null when it can't be, e.g. it has digits). */
export function transliterateWord(word, lang, { learned } = {}) {
  const script = typingScriptOf(lang)
  if (!script || !/^[A-Za-z]+$/.test(word ?? '')) return null
  const key = normal(word)
  if (learned?.[key]) return learned[key]
  const data = TYPING_LANGUAGES[lang]
  if (word.length === 1) return data?.letters?.[word.toLowerCase()] ?? null
  const known = key === key.toLowerCase() && (data?.words?.[key] ?? data?.names?.[key])
  if (known) return known
  const list = shaped(word, script, lang)
  return list ? write(list, script) : null
}

/**
 * Other ways the word may have been meant, best first, for the teacher to pick from: short a ↔ long ā, i ↔ ī, u ↔ ū,
 * t ↔ ṭ, d ↔ ḍ, n ↔ ṇ, a nasal end (हैं). The first entry is what transliterateWord gave.
 */
export function transliterateChoices(word, lang, { learned, max = 8 } = {}) {
  const script = typingScriptOf(lang)
  const first = transliterateWord(word, lang, { learned })
  if (!first || word.length === 1) return first ? [first] : []
  const base = shaped(word, script, lang)
  const out = new Set([first])
  const fromRule = write(base, script)
  out.add(fromRule)
  const add = (fn) => {
    const copy = base.map((x) => ({ ...x }))
    if (fn(copy) !== false) out.add(write(copy, script))
  }
  const swaps = { 0x24: 0x1f, 0x1f: 0x24, 0x25: 0x20, 0x20: 0x25, 0x26: 0x21, 0x21: 0x26, 0x27: 0x22, 0x22: 0x27, 0x28: 0x23, 0x23: 0x28, 0x36: 0x37 }
  const vowelPairs = { A: 'AA', AA: 'A', I: 'II', II: 'I', U: 'UU', UU: 'U' }
  // every short a after a consonant made long at once ("kitab" → किताब), then one change at a time
  add((l) => { let any = false; l.forEach((x, i) => { if (x.v === 'A' && l[i - 1]?.c) { x.v = 'AA'; any = true } }); return any })
  // consonants written in full, not joined ("ladka" → लडका, "kamra" → कमरा)
  if (script.fullLetters) add((l) => { let any = false; l.forEach((x, i) => { if (x.c && l[i + 1]?.c && !(x.c[0] === 0x28 && NASAL_DOT_BEFORE.has(l[i + 1].c[0]))) { x.full = true; any = true } }); return any })
  base.forEach((x, i) => {
    if (x.v && vowelPairs[x.v] && (base[i - 1]?.c || x.wasA)) add((l) => { l[i].v = vowelPairs[x.v] })
  })
  if (script.nukta) {
    const last = base[base.length - 1]
    if (last?.v && base[base.length - 2]?.c) add((l) => { l[l.length - 1].nasal = true }) // हैं, में
    if (last?.c?.length === 1 && last.c[0] === 0x28 && base[base.length - 2]?.v) add((l) => { l.pop(); const v = l[l.length - 1]; if (l[l.length - 2]?.c) v.nasal = true; else return false })
  }
  base.forEach((x, i) => {
    if (x.c?.length === 1 && swaps[x.c[0]] != null) add((l) => { l[i].c = [swaps[x.c[0]]] })
    if (x.c?.length === 1 && (x.c[0] === 0x28 || x.c[0] === 0x2e) && base[i + 1]?.c) add((l) => { l[i].keepN = true })
  })
  return [...out].filter(Boolean).slice(0, max)
}

/** The language's full stop, when it isn't "." (Hindi: ।). */
export const typingFullStop = (lang) => TYPING_LANGUAGES[lang]?.fullStop ?? null

/** Every run of English letters in `text` written in the language; the rest stays as typed ("R. K. sharma" → आर. के. शर्मा). */
export function transliterateText(text, lang, opts) {
  return String(text ?? '').replace(/[A-Za-z]+/g, (w) => transliterateWord(w, lang, opts) ?? w)
}
