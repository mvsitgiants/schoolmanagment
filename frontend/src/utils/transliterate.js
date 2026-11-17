// English letters → Devanagari, the way people type Hindi on a phone ("uday" → उदय, "raahul" → राहुल).
// For the "Name in हिन्दी" boxes: staff type the name the way it sounds; each word turns into the script on space
// or when they leave the box. Rules first, then a short list of common name words the rules get wrong.
//
//   a aa(A) i ee/ii(I) u oo/uu(U) e ai o au   ·  k kh g gh ch chh j jh  t th d dh n  p ph f b bh m  y r l v/w  sh s h
//   capitals inside a word = the hard sounds: T ट  Th ठ  D ड  Dh ढ  N ण  Sh ष   ·   ksh क्ष  gy ज्ञ  x क्स  z ज़  q क़
//   a single letter (an initial, "R. K.") is written as it is said: आर. के.

const SCRIPTS = { Devanagari: true }

/** Whether names in this language (a SUPPORTED_LANGUAGES row) can be typed in English letters. */
export const canTransliterate = (language) => !!SCRIPTS[language?.script]

const VOWELS = [
  ['aa', 'आ', 'ा'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ou', 'औ', 'ौ'], ['ee', 'ई', 'ी'], ['ii', 'ई', 'ी'],
  ['oo', 'ऊ', 'ू'], ['uu', 'ऊ', 'ू'], ['A', 'आ', 'ा'], ['I', 'ई', 'ी'], ['U', 'ऊ', 'ू'], ['E', 'ए', 'े'], ['O', 'ओ', 'ो'],
  ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो'],
]
const CONSONANTS = [
  ['ksh', 'क्ष'], ['chh', 'छ'], ['shh', 'ष'],
  ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['Th', 'ठ'], ['Dh', 'ढ'], ['th', 'थ'], ['dh', 'ध'],
  ['ph', 'फ'], ['bh', 'भ'], ['Sh', 'ष'], ['sh', 'श'], ['gy', 'ज्ञ'],
  ['k', 'क'], ['g', 'ग'], ['c', 'क'], ['j', 'ज'], ['T', 'ट'], ['D', 'ड'], ['N', 'ण'], ['t', 'त'], ['d', 'द'], ['n', 'न'],
  ['p', 'प'], ['f', 'फ़'], ['b', 'ब'], ['m', 'म'], ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'],
  ['s', 'स'], ['h', 'ह'], ['x', 'क्स'], ['q', 'क़'], ['z', 'ज़'],
]
// before these, n / m join the next letter (अन्ना, सम्मान) instead of becoming the dot (संजय, चंपा)
const N_JOINS = new Set(['n', 'm', 'y', 'v', 'w', 'r', 'h'])
const M_DOT = new Set(['p', 'ph', 'b', 'bh'])

const LETTERS = {
  a: 'ए', b: 'बी', c: 'सी', d: 'डी', e: 'ई', f: 'एफ़', g: 'जी', h: 'एच', i: 'आई', j: 'जे', k: 'के', l: 'एल', m: 'एम',
  n: 'एन', o: 'ओ', p: 'पी', q: 'क्यू', r: 'आर', s: 'एस', t: 'टी', u: 'यू', v: 'वी', w: 'डब्ल्यू', x: 'एक्स', y: 'वाई', z: 'ज़ेड',
}

// Common name words as they are written in Hindi, where the English spelling hides a long vowel or a hard sound.
const WORDS = {
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
  aarav: 'आरव', aditya: 'आदित्य', arjun: 'अर्जुन', vivek: 'विवेक', vikas: 'विकास', akash: 'आकाश', aakash: 'आकाश',
  pooja: 'पूजा', puja: 'पूजा', priya: 'प्रिया', neha: 'नेहा', anjali: 'अंजलि', kavita: 'कविता', sunita: 'सुनीता',
  anita: 'अनीता', savita: 'सविता', geeta: 'गीता', seema: 'सीमा', rekha: 'रेखा', asha: 'आशा', usha: 'उषा', meena: 'मीना',
  verma: 'वर्मा', varma: 'वर्मा', patel: 'पटेल', harsh: 'हर्ष', ayush: 'आयुष', piyush: 'पीयूष', subhash: 'सुभाष',
  ashutosh: 'आशुतोष', kritika: 'कृतिका', krish: 'कृष', rishi: 'ऋषि', ritu: 'ऋतु', ankit: 'अंकित', ankita: 'अंकिता',
  shivam: 'शिवम', shiv: 'शिव', satyam: 'सत्यम', aryan: 'आर्यन', ananya: 'अनन्या', kartik: 'कार्तिक', karan: 'करण',
  tarun: 'तरुण', varun: 'वरुण', arun: 'अरुण', tanya: 'तान्या', diya: 'दिया', riya: 'रिया', sakshi: 'साक्षी', nidhi: 'निधि',
  sarita: 'सरिता', mamta: 'ममता', manju: 'मंजू', saroj: 'सरोज', kiran: 'किरण', garima: 'गरिमा', aarti: 'आरती', arti: 'आरती',
}

/** One word of English letters in Devanagari. */
function word(w) {
  if (w.length === 1) return LETTERS[w.toLowerCase()]
  const lower = w.toLowerCase()
  if (WORDS[lower]) return WORDS[lower]
  // "Uday" / "UDAY" are just capitalised; capitals inside a word ("paanDey") mean the hard sounds
  const s = w === w.toUpperCase() ? lower : w[0].toLowerCase() + w.slice(1)
  const tokens = []
  for (let i = 0; i < s.length;) {
    const v = VOWELS.find(([k]) => s.startsWith(k, i))
    const c = !v && CONSONANTS.find(([k]) => s.startsWith(k, i))
    const hit = v ? { type: 'V', key: v[0], full: v[1], sign: v[2] } : c ? { type: 'C', key: c[0], dev: c[1] } : { type: 'X', dev: s[i] }
    tokens.push(hit)
    i += hit.key?.length ?? 1
  }
  // names ending in -ndra keep the short end (महेन्द्र); other -a endings are long (शर्मा, गरिमा, प्रिया)
  const shortEnd = /ndra$/.test(lower)
  let out = ''
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    const next = tokens[i + 1]
    if (tk.type === 'V') { out += tk.full; continue }
    if (tk.type === 'X') { out += tk.dev; continue }
    const afterVowel = tokens[i - 1]?.type === 'V'
    if (afterVowel && next?.type === 'C' && ((tk.key === 'n' && !N_JOINS.has(next.key)) || (tk.key === 'm' && M_DOT.has(next.key)))) {
      out += 'ं'
      continue
    }
    out += tk.dev
    if (next?.type === 'C') out += '्'
    else if (next?.type === 'V') {
      const last = i + 2 === tokens.length
      out += next.key === 'a' && last && i > 0 && !shortEnd ? 'ा' : next.sign
      i++
    }
  }
  return out
}

/** Every run of English letters in `text` written in the language's script; the rest stays as typed. */
export function transliterate(text, language) {
  if (!canTransliterate(language)) return text
  return String(text ?? '').replace(/[A-Za-z]+/g, word)
}

/** Whether there is anything in English letters left to turn. */
export const hasLatin = (text) => /[A-Za-z]/.test(String(text ?? ''))
