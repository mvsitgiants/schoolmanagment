// Staff ID card (STAFF_ID_CARD): the CR80 card for employees, many at once from Staff & HR › Staff — the same look as
// the student card (documents/studentIdCard.js cardTheme): photo, name, designation, department, employee code, blood
// group, mobile, emergency contact, valid until and the Principal's signature; the back has the return address, a QR
// and a barcode of the employee code (gate and library scanners). Staff records hold no photo yet, so the card shows the
// initials in the photo box for a photo to be pasted.
import bwipjs from 'bwip-js'
import { EMPLOYEE_CATEGORIES, settingDefaults } from '@schoolgiant/shared'
import { Employee } from '../models/hrms.js'
import { Tenant } from '../models/platform.js'
import { Department } from '../models/tenant.js'
import { AppError, notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { institutionNow } from '../platform/time.js'
import { employeeScope } from '../services/hrmsCommon.js'
import { currentYear } from '../services/academics.js'
import { qrSvg } from './engine.js'
import { cardTheme } from './studentIdCard.js'

const STUDENT_DEFAULTS = settingDefaults('students')
const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const initials = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
const logoOf = (v) => (typeof v === 'string' && /^(data:image\/(png|jpeg|webp|svg\+xml);base64,|https?:\/\/|\/)[^\s"'<>]*$/i.test(v) ? v : null)
function barcodeUrl(text) {
  try {
    return svgUrl(bwipjs.toSVG({ bcid: 'code128', text: String(text), height: 10, includetext: false, scale: 2 }).replace('<svg ', '<svg preserveAspectRatio="none" '))
  } catch {
    return null
  }
}

/** What the staff card prints for each of `ids` (in the caller's Staff & HR scope, in the order asked). */
export async function staffIdCards(ids, auth) {
  const [rows, students, tenant, year, now] = await Promise.all([
    Employee.find({ _id: { $in: ids }, ...employeeScope(auth) }).select('employeeCode name designation departmentId category bloodGroup mobile emergencyContact status joiningDate').lean(),
    getSettings('students'),
    Tenant.findById(auth.tenantId).select('name profile').lean(),
    currentYear(),
    institutionNow(),
  ])
  const deps = new Map((await Department.find({ _id: { $in: rows.map((r) => r.departmentId).filter(Boolean) } }).select('name').lean()).map((d) => [String(d._id), d.name]))
  const byId = new Map(rows.map((r) => [String(r._id), r]))
  const p = tenant?.profile ?? {}
  return {
    staff: ids.map((id) => byId.get(String(id))).filter(Boolean).map((e) => ({
      id: String(e._id), code: e.employeeCode, name: e.name, designation: e.designation || EMPLOYEE_CATEGORIES.find((c) => c.value === e.category)?.label || '',
      department: deps.get(String(e.departmentId)) ?? '', bloodGroup: e.bloodGroup ?? '', mobile: e.mobile ?? '', status: e.status,
      emergency: e.emergencyContact?.phone ? { name: e.emergencyContact.name ?? '', relation: e.emergencyContact.relation ?? '', phone: e.emergencyContact.phone } : null,
    })),
    // the card colour and signatory follow the student card (Settings › Students), so both cards match
    settings: { color: students.idCardColor, signatory: students.idCardSignatory },
    institution: {
      name: tenant?.name ?? '', logoUrl: p.logoUrl || null, color: p.primaryColor || null,
      address: [p.addressLine, p.city, [p.state, p.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: p.phone || null, email: p.email || null, website: p.website || null,
    },
    today: now.date, validUntil: year?.endDate ?? null, yearName: year?.name ?? null,
  }
}

/** The STAFF_ID_CARD model: `{ staff[], settings, theme, institution }`; staff who have left are skipped. */
export function staffIdCardModel(raw) {
  const h = raw.institution ?? {}
  const color = /^#[0-9a-fA-F]{6}$/.test(raw.settings?.color ?? '') ? raw.settings.color : h.color
  const theme = cardTheme(color)
  const all = Array.isArray(raw.staff) ? raw.staff : []
  const current = all.filter((x) => x.status !== 'EXITED')
  const signatory = String(raw.settings?.signatory ?? '').trim()
  return {
    institution: { name: h.name ?? '', logoUrl: logoOf(h.logoUrl), address: h.address ?? '', phone: h.phone ?? '', email: h.email ?? '', website: h.website ?? '' },
    settings: { signatory: signatory && signatory !== STUDENT_DEFAULTS.idCardSignatory ? signatory : null, issued: raw.today ?? null, validUntil: raw.validUntil ?? null, year: raw.yearName ?? null },
    theme,
    staff: current.map((x) => ({
      ...x, initials: initials(x.name),
      // the QR carries what a gate scanner or a phone needs to tell who this is: code, name, institution
      qrImage: svgUrl(qrSvg(`${x.code} · ${x.name} · ${h.name ?? ''}`, 20)),
      barcodeImage: barcodeUrl(x.code),
    })),
    skipped: all.length - current.length,
  }
}

export const STAFF_DOCS = {
  // ── Staff ID cards: many employees at once (GET /documents/STAFF_ID_CARD?ids=…), front and back per person.
  STAFF_ID_CARD: {
    perms: ['hrms.employees.view'],
    many: true,
    load: async (ids, auth) => {
      const d = await staffIdCards((Array.isArray(ids) ? ids : [ids]).map(String), auth)
      if (!d.staff.length) throw notFound('Staff record')
      if (d.staff.every((x) => x.status === 'EXITED')) throw new AppError(409, 'No ID cards to print — everyone picked has left.', { code: 'NO_CARDS' })
      return d
    },
    model: staffIdCardModel,
    title: (m) => (m.staff.length === 1 ? `ID card · ${m.staff[0].name}` : `Staff ID cards (${m.staff.length})`),
    sample: async () => (await Employee.findOne({ status: { $ne: 'EXITED' } }).sort({ updatedAt: -1 }).select('_id').lean())?._id,
    variables: [
      'institution.name, institution.logoUrl, institution.address, institution.phone, institution.email, institution.website',
      'settings.signatory (empty: Principal) · settings.issued · settings.validUntil · settings.year',
      'theme {color, dark, deep, tint, soft, ink, light}',
      'staff[] {code, name, designation, department, bloodGroup, mobile, emergency {name, relation, phone}, initials, qrImage, barcodeImage}',
    ],
  },
}
