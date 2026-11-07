// Web fonts for the Indic scripts and Urdu. Each family is fetched from Google Fonts only when
// its language becomes active (a <link> is added to <head> once and kept), so English users
// download none of them. index.css picks the family per :lang() — see the "Script fonts" block.

const FAMILIES = {
  hi: 'Noto+Sans+Devanagari:wght@400;500;600;700',
  mr: 'Noto+Sans+Devanagari:wght@400;500;600;700',
  bn: 'Noto+Sans+Bengali:wght@400;500;600;700',
  gu: 'Noto+Sans+Gujarati:wght@400;500;600;700',
  pa: 'Noto+Sans+Gurmukhi:wght@400;500;600;700',
  kn: 'Noto+Sans+Kannada:wght@400;500;600;700',
  ml: 'Noto+Sans+Malayalam:wght@400;500;600;700',
  or: 'Noto+Sans+Oriya:wght@400;500;600;700',
  ta: 'Noto+Sans+Tamil:wght@400;500;600;700',
  te: 'Noto+Sans+Telugu:wght@400;500;600;700',
  ur: 'Noto+Nastaliq+Urdu:wght@400;500;600;700',
}

/** Adds the stylesheet for `code`'s script font if it isn't on the page yet. */
export function applyLanguageFont(code) {
  if (typeof document === 'undefined') return
  const family = FAMILIES[code]
  if (!family) return
  const id = `hx-font-${family.split(':')[0]}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`
  document.head.appendChild(link)
}
