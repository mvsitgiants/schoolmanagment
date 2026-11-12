// Old Hindi PDFs typed in the Kruti Dev font (common in UP Board and government material) hold Latin letters that only
// look Hindi in that font: copied out they read like "fgUnh". This turns that text into real Hindi (Unicode).
// The glyph table is the standard Kruti Dev 010 map, as published in @anthro-ai/krutidev-unicode (ISC licence); the
// reordering steps below (ि written before its letter, the र् reph written after it) are our own.

// [Kruti Dev, Unicode], applied in this order (longer sequences first)
const TABLE = [
  ["ñ","॰"], ["Q+Z","QZ+"], ["sas","sa"], ["aa","a"], [")Z","र्द्ध"], ["ZZ","Z"],
  ["‘","\""], ["’","\""], ["“","'"], ["”","'"], ["å","०"], ["ƒ","१"],
  ["„","२"], ["…","३"], ["†","४"], ["‡","५"], ["ˆ","६"], ["‰","७"],
  ["Š","८"], ["‹","९"], ["¶+","फ़्"], ["d+","क़"], ["[+k","ख़"], ["[+","ख़्"],
  ["x+","ग़"], ["T+","ज़्"], ["t+","ज़"], ["M+","ड़"], ["<+","ढ़"], ["Q+","फ़"],
  [";+","य़"], ["j+","ऱ"], ["u+","ऩ"], ["Ùk","त्त"], ["Ù","त्त्"], ["ä","क्त"],
  ["–","दृ"], ["—","कृ"], ["é","न्न"], ["™","न्न्"], ["=kk","=k"], ["f=k","f="],
  ["à","ह्न"], ["á","ह्य"], ["â","हृ"], ["ã","ह्म"], ["ºz","ह्र"], ["º","ह्"],
  ["í","द्द"], ["{k","क्ष"], ["{","क्ष्"], ["=","त्र"], ["«","त्र्"], ["Nî","छ्य"],
  ["Vî","ट्य"], ["Bî","ठ्य"], ["Mî","ड्य"], ["<î","ढ्य"], ["|","द्य"], ["K","ज्ञ"],
  ["}","द्व"], ["J","श्र"], ["Vª","ट्र"], ["Mª","ड्र"], ["<ªª","ढ्र"], ["Nª","छ्र"],
  ["Ø","क्र"], ["Ý","फ्र"], ["nzZ","र्द्र"], ["æ","द्र"], ["ç","प्र"], ["Á","प्र"],
  ["xz","ग्र"], ["#","रु"], [":","रू"], ["v‚","ऑ"], ["vks","ओ"], ["vkS","औ"],
  ["vk","आ"], ["v","अ"], ["b±","ईं"], ["Ã","ई"], ["bZ","ई"], ["b","इ"],
  ["m","उ"], ["Å","ऊ"], [",s","ऐ"], [",","ए"], ["_","ऋ"], ["ô","क्क"],
  ["d","क"], ["Dk","क"], ["D","क्"], ["[k","ख"], ["[","ख्"], ["x","ग"],
  ["Xk","ग"], ["X","ग्"], ["Ä","घ"], ["?k","घ"], ["?","घ्"], ["³","ङ"],
  ["pkS","चै"], ["p","च"], ["Pk","च"], ["P","च्"], ["N","छ"], ["t","ज"],
  ["Tk","ज"], ["T","ज्"], [">","झ"], ["÷","झ्"], ["¥","ञ"], ["ê","ट्ट"],
  ["ë","ट्ठ"], ["V","ट"], ["B","ठ"], ["ì","ड्ड"], ["ï","ड्ढ"], ["M+","ड़"],
  ["<+","ढ़"], ["M","ड"], ["<","ढ"], [".k","ण"], [".","ण्"], ["r","त"],
  ["Rk","त"], ["R","त्"], ["Fk","थ"], ["F","थ्"], [")","द्ध"], ["n","द"],
  ["/k","ध"], ["/","ध्"], ["Ë","ध्"], ["è","ध"], ["u","न"], ["Uk","न"],
  ["U","न्"], ["i","प"], ["Ik","प"], ["I","प्"], ["Q","फ"], ["¶","फ्"],
  ["c","ब"], ["Ck","ब"], ["C","ब्"], ["Hk","भ"], ["H","भ्"], ["e","म"],
  ["Ek","म"], ["E","म्"], [";","य"], ["¸","य्"], ["j","र"], ["y","ल"],
  ["Yk","ल"], ["Y","ल्"], ["G","ळ"], ["o","व"], ["Ok","व"], ["O","व्"],
  ["'k","श"], ["'","श्"], ["\"k","ष"], ["\"","ष्"], ["l","स"], ["Lk","स"],
  ["L","स्"], ["g","ह"], ["È","ीं"], ["saz","्रें"], ["z","्र"], ["Ì","द्द"],
  ["Í","ट्ट"], ["Î","ट्ठ"], ["Ï","ड्ड"], ["Ñ","कृ"], ["Ò","भ"], ["Ó","्य"],
  ["Ô","ड्ढ"], ["Ö","झ्"], ["Ø","क्र"], ["Ù","त्त्"], ["Ük","श"], ["Ü","श्"],
  ["‚","ॉ"], ["kas","ों"], ["ks","ो"], ["kS","ौ"], ["¡k","ाँ"], ["ak","kं"],
  ["k","ा"], ["ah","ीं"], ["h","ी"], ["aq","ुं"], ["q","ु"], ["aw","ूं"],
  ["¡w","ूँ"], ["w","ू"], ["`","ृ"], ["̀","ृ"], ["as","ें"], ["±s","s±"],
  ["s","े"], ["aS","ैं"], ["S","ै"], ["aª","्रं"], ["ª","्र"], ["fa","ंf"],
  ["a","ं"], ["¡","ँ"], ["%",":"], ["W","ॅ"], ["•","ऽ"], ["·","ऽ"],
  ["∙","ऽ"], ["·","ऽ"], ["~j","्र"], ["~","्"], ["\\","?"], ["+","़"],
  ["^","‘"], ["*","’"], ["Þ","“"], ["ß","”"], ["(",";"], ["¼","("],
  ["½",")"], ["À","}"], ["¾","="], ["A","।"], ["-","."], ["&","-"],
  ["&","µ"], ["μ","-"], ["Œ","॰"], ["]",","], ["~ ","् "], ["@","/"],
  ["®","ैं"],
]

const I = 'ि' // ि
const HALANT = '्' // ्
const REPH = 'र्' // र्
// vowel signs (and independent vowels) that can stand between a letter and a reph mark
const SIGNS = new Set([...'अआइईउऊएऐओऔािीुूृेैोौंःँॅ'])
const MATRAS = [...'ािीुूृेैोौंःँॅ']
const replaceAll = (s, a, b) => s.split(a).join(b)

/** Put each ि after the letter it was typed before (and after a whole conjunct such as स्त → स्ति). */
function placeI(text, mark, sign) {
  let out = text.replace(new RegExp(`${mark}(.)`, 'gsu'), `$1${sign}`)
  for (let prev = ''; prev !== out;) { prev = out; out = out.replace(new RegExp(`${sign}${HALANT}(.)`, 'gsu'), `${HALANT}$1${sign}`) }
  return out
}

/** Move each reph (Z, typed after the letter and its signs) in front of that letter, with any conjunct before it. */
function placeReph(text) {
  let out = text
  for (let i = out.indexOf('Z'); i >= 0; i = out.indexOf('Z')) {
    let start = i - 1
    while (start > 0 && SIGNS.has(out[start])) start--
    while (start >= 2 && out[start - 1] === HALANT) start -= 2
    if (start < 0) start = 0
    out = out.slice(0, start) + REPH + out.slice(start, i) + out.slice(i + 1)
  }
  return out
}

/** Kruti Dev text → Hindi (Unicode). */
export function krutiToUnicode(input) {
  let text = String(input ?? '')
  text = replaceAll(text, ' ª', 'ª')
  text = replaceAll(text, ' ~j', '~j')
  text = replaceAll(text, ' z', 'z')
  for (const [a, b] of TABLE) text = replaceAll(text, a, b)
  text = replaceAll(text, '±', 'Zं') // ±
  text = replaceAll(text, 'Æ', `${REPH}f`) // Æ
  text = placeI(text, 'f', I)
  text = replaceAll(text, 'Ç', 'fa') // Ç
  text = replaceAll(text, '¯', 'fa') // ¯
  text = replaceAll(text, 'É', `${REPH}fa`) // É
  text = placeI(text.replace(/fa/g, '\u0001'), '\u0001', `${I}ं`)
  text = replaceAll(text, 'Ê', 'ीZ') // Ê
  text = replaceAll(text, `${HALANT}Z`, 'Z')
  text = placeReph(text)
  // a space, comma or halant can't come just before a vowel sign
  for (const m of MATRAS) {
    text = replaceAll(text, ` ${m}`, m)
    text = replaceAll(text, `,${m}`, `${m},`)
    text = replaceAll(text, `${HALANT}${m}`, m)
  }
  text = replaceAll(text, `${HALANT}${HALANT}र`, `${HALANT}र`)
  text = replaceAll(text, `${HALANT}र${HALANT}`, `र${HALANT}`)
  text = replaceAll(text, `${HALANT}${HALANT}`, HALANT)
  text = replaceAll(text, `${HALANT} `, ' ')
  return text
}

// words that are everywhere in Hindi, as they look when Kruti Dev text is copied out: है, में, के, की, का, और, से, कि, भी, यह, इस, को
const KRUTI_WORDS = new Set(['gS', 'esa', 'ds', 'dh', 'dk', 'vkSj', 'ls', 'fd', 'Hkh', ';g', 'bl', 'dks', 'rFkk', 'gSa', 'Fkk', 'FkhA', 'gSA'])

/** Does this copied-out text look like Kruti Dev (Latin letters standing for Hindi)? */
export function looksLikeKruti(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  if (words.length < 8 || /[ऀ-ॿ]/.test(text)) return false
  const hits = words.filter((w) => KRUTI_WORDS.has(w.replace(/[.,;:!?)(]+$/g, ''))).length
  return hits / words.length > 0.06
}
