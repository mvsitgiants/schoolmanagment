// Student ID card (STUDENT_ID_CARD): the model its template sees, for one or many students at once — ported from the
// hospital's staff ID card (documents/idCard.js there). The data comes from services/students.js studentIdCards (scope,
// photos, the card settings, the institution's contact block); this turns it into what a card prints: checked pictures,
// a QR of the card's public check link (/verify/student/<code>: any phone shows whether the holder studies here now),
// a barcode of the admission number (library and gate scanners), the card colours and the fields switched on
// (Settings › Students › Student ID card).
import bwipjs from 'bwip-js'
import { PHOTO_DATA_URL, STUDENT_ID_CARD_FIELDS, settingDefaults } from '@schoolgiant/shared'
import { config } from '../config.js'
import { qrSvg } from './engine.js'

const DEFAULTS = settingDefaults('students')

const photoOf = (v) => (typeof v === 'string' && PHOTO_DATA_URL.test(v) ? v : null)
const logoOf = (v) => (typeof v === 'string' && (PHOTO_DATA_URL.test(v) || /^(https?:\/\/|\/)[^\s"'<>]*$/i.test(v)) ? v : null)

const HEX = /^#[0-9a-fA-F]{6}$/
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const mix = (hex, to, amount) => `#${rgb(hex).map((v, i) => Math.round(v + (rgb(to)[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`
const luminance = (hex) => { const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

/** The card colour and the shades the design uses. `ink`: text on the colour (dark on a pale colour). */
export function cardTheme(color) {
  const c = HEX.test(color ?? '') ? color : '#0E7C86'
  const light = luminance(c) > 0.5
  return { color: c, dark: mix(c, '#000000', 0.32), deep: mix(c, '#000000', 0.55), tint: mix(c, '#FFFFFF', 0.9), soft: mix(c, '#FFFFFF', 0.75), ink: light ? '#12141C' : '#FFFFFF', light }
}

const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
function barcodeUrl(text) {
  try {
    return svgUrl(bwipjs.toSVG({ bcid: 'code128', text: String(text), height: 10, includetext: false, scale: 2 }).replace('<svg ', '<svg preserveAspectRatio="none" '))
  } catch {
    return null
  }
}

/** The public check link a card's QR carries — never the bare admission number (those run in sequence). */
const verifyUrlOf = (code) => (typeof code === 'string' && /^[A-Z0-9]{8,14}$/.test(code) ? `${config.appUrl}/verify/student/${code}` : null)
const initials = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
/** A card text left at the English default prints its translation (null here); anything else as entered. */
const own = (value, key) => { const v = String(value ?? '').trim(); return v === DEFAULTS[key] ? null : v }

const FIELD_FLAG = { PHOTO: 'photo', ROLL: 'roll', DOB: 'dob', BLOOD_GROUP: 'bloodGroup', GUARDIAN: 'guardian', GUARDIAN_PHONE: 'guardianPhone', ADDRESS: 'address', VALID_UNTIL: 'validUntil', QR: 'qr' }

/** The STUDENT_ID_CARD model from `studentIdCards` data: `{ students, settings, institution, today, validUntil }`. */
export function studentIdCardModel(raw) {
  const s = { ...Object.fromEntries(Object.entries({ orientation: 'idCardOrientation', title: 'idCardTitle', color: 'idCardColor', fields: 'idCardFields', back: 'idCardBack', backText: 'idCardBackText', returnText: 'idCardReturnText', signatory: 'idCardSignatory' }).map(([k, key]) => [k, DEFAULTS[key]])), ...Object.fromEntries(Object.entries(raw.settings ?? {}).filter(([, v]) => v !== undefined && v !== null)) }
  const h = raw.institution ?? {}
  const theme = cardTheme(HEX.test(s.color ?? '') ? s.color : h.color)
  const fields = (Array.isArray(s.fields) ? s.fields : DEFAULTS.idCardFields).filter((f) => STUDENT_ID_CARD_FIELDS.some((x) => x.value === f))
  const show = Object.fromEntries(Object.entries(FIELD_FLAG).map(([f, flag]) => [flag, fields.includes(f)]))
  const today = /^\d{4}-\d{2}-\d{2}$/.test(raw.today ?? '') ? raw.today : new Date().toISOString().slice(0, 10)
  const backText = own(s.backText, 'idCardBackText')
  const returnText = own(s.returnText, 'idCardReturnText')
  const all = Array.isArray(raw.students) ? raw.students : []
  const current = all.filter((x) => x.status === 'ACTIVE')
  const orientation = s.orientation === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT'
  return {
    institution: { name: h.name ?? '', logoUrl: logoOf(h.logoUrl), color: theme.color, address: h.address ?? '', phone: h.phone ?? '', email: h.email ?? '', website: h.website ?? '' },
    settings: {
      orientation, landscape: orientation === 'LANDSCAPE',
      title: own(s.title, 'idCardTitle') || null, color: theme.color, fields, show, back: s.back !== false,
      backText: backText || '', backTextStandard: backText === null, returnText: returnText || '', returnTextStandard: returnText === null,
      signatory: own(s.signatory, 'idCardSignatory') || null,
      issued: today, validUntil: show.validUntil ? raw.validUntil ?? null : null, year: raw.yearName ?? null,
    },
    theme,
    students: current.map((x) => {
      const verifyUrl = verifyUrlOf(x.cardCode)
      return {
        id: x.id, name: x.name, admissionNo: x.admissionNo, class: x.class || '', rollNo: x.rollNo || '', dob: x.dob || '', bloodGroup: x.bloodGroup || '',
        guardian: x.guardian || '', guardianRelation: x.guardianRelation || '', guardianPhone: x.guardianPhone || '', address: x.address || '',
        photo: photoOf(x.photo), initials: initials(x.name), verifyUrl,
        qrImage: show.qr && verifyUrl ? svgUrl(qrSvg(verifyUrl, 20)) : null,
        barcodeImage: barcodeUrl(x.admissionNo),
      }
    }),
    skipped: all.length - current.length,
  }
}

/** The card's way round comes from its paper once one is chosen (an upright or a sideways card). */
export function withPaper(model, paper) {
  const orientation = paper === 'CARD_LANDSCAPE' ? 'LANDSCAPE' : paper === 'CARD_PORTRAIT' ? 'PORTRAIT' : model.settings.orientation
  return { ...model, settings: { ...model.settings, orientation, landscape: orientation === 'LANDSCAPE' } }
}
