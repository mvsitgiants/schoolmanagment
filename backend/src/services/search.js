import { sectionLabel } from '@schoolgiant/shared'
import { ClassLevel, Section } from '../models/academics.js'
import { Application, Enquiry } from '../models/admissions.js'
import { FeePayment } from '../models/fees.js'
import { Visitor } from '../models/frontOffice.js'
import { Employee } from '../models/hrms.js'
import { StoreAsset } from '../models/inventory.js'
import { LibraryCopy, LibraryTitle } from '../models/library.js'
import { Student, studentName } from '../models/students.js'
import { Vehicle } from '../models/transport.js'
import { on } from './dashboard.js'

// The header search box: records across the modules this person may open — students, parents, staff, receipts,
// enquiries, applications, books, assets, vehicles, visitors. Each hit carries the screen that owns it (`path`).
// Screens themselves are matched in the browser (GlobalSearch.jsx); this is only records.

const PER_KIND = 5
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every word typed must appear in one of `fields` (any order): "ira sha" finds Ira Sharma. */
function words(q, fields) {
  const ws = q.split(/\s+/).filter(Boolean).slice(0, 4)
  return { $and: ws.map((w) => ({ $or: fields.map((f) => ({ [f]: { $regex: esc(w), $options: 'i' } })) })) }
}
const starts = (field, q) => ({ [field]: { $regex: `^${esc(q)}`, $options: 'i' } })

async function classesOf(sectionIds) {
  const ids = [...new Set(sectionIds.filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const secs = await Section.find({ _id: { $in: ids } }).select('classId name').lean()
  const classes = await ClassLevel.find({ _id: { $in: secs.map((s) => s.classId) } }).select('name code').lean()
  return new Map(secs.map((s) => [String(s._id), sectionLabel(classes.find((c) => String(c._id) === String(s.classId)), s, { short: true })]))
}

async function students(q, digits, auth) {
  if (!on(auth, 'students', 'students.directory.view', 'students.profile.view')) return []
  const or = [words(q, ['firstName', 'middleName', 'lastName']), starts('admissionNo', q)]
  if (digits) or.push({ mobile: { $regex: digits } }, { 'guardians.mobile': { $regex: digits } })
  else or.push(words(q, ['guardians.name']))
  const rows = await Student.find({ $or: or }).select('firstName middleName lastName admissionNo sectionId status guardians').sort({ status: 1, firstName: 1 }).limit(PER_KIND * 2).lean()
  const cls = await classesOf(rows.map((s) => s.sectionId))
  const re = new RegExp(digits || esc(q.split(/\s+/)[0]), 'i')
  const out = []
  for (const s of rows) {
    const path = `/students/profile/${s._id}`
    const named = re.test(studentName(s)) || re.test(s.admissionNo) || (digits && re.test(s.mobile ?? ''))
    // matched on a parent: show the parent, and whose parent they are
    const g = !named && s.guardians?.find((x) => re.test(digits ? x.mobile ?? '' : x.name ?? ''))
    if (g) out.push({ kind: 'GUARDIAN', id: `${s._id}-${g._id}`, title: g.name, subtitle: [g.relation && g.relation.charAt(0) + g.relation.slice(1).toLowerCase(), studentName(s), cls.get(String(s.sectionId)), g.mobile].filter(Boolean).join(' · '), path })
    else out.push({ kind: 'STUDENT', id: String(s._id), title: studentName(s), subtitle: [cls.get(String(s.sectionId)), s.admissionNo].filter(Boolean).join(' · '), status: s.status === 'ACTIVE' ? null : s.status, path })
  }
  return out.slice(0, PER_KIND * 2)
}

async function staff(q, digits, auth) {
  if (!on(auth, 'hrms', 'hrms.employees.view')) return []
  const or = [words(q, ['name']), starts('employeeCode', q), starts('email', q)]
  if (digits) or.push({ mobile: { $regex: digits } })
  const rows = await Employee.find({ $or: or }).select('name employeeCode designation status').sort({ name: 1 }).limit(PER_KIND).lean()
  return rows.map((e) => ({ kind: 'STAFF', id: String(e._id), title: e.name, subtitle: [e.designation, e.employeeCode].filter(Boolean).join(' · '), status: e.status && e.status !== 'ACTIVE' ? e.status : null, path: `/hrms/employees/${e._id}` }))
}

async function receipts(q, auth) {
  if (!on(auth, 'fees', 'fees.collect.view') || q.length < 3 || /\s/.test(q)) return []
  const rows = await FeePayment.find({ $or: [starts('receiptNo', q), { receiptNo: { $regex: `${esc(q)}$`, $options: 'i' } }] }).select('receiptNo studentId amount date status').sort({ at: -1 }).limit(PER_KIND).lean()
  const ss = await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName middleName lastName').lean()
  return rows.map((r) => {
    const s = ss.find((x) => String(x._id) === String(r.studentId))
    return { kind: 'RECEIPT', id: String(r._id), title: r.receiptNo, subtitle: [s && studentName(s), r.date].filter(Boolean).join(' · '), amount: r.amount, status: r.status === 'VALID' ? null : r.status, path: `/fees/collect?student=${r.studentId}` }
  })
}

async function admissions(q, digits, auth) {
  const out = []
  const search = (no) => `?search=${encodeURIComponent(no)}`
  if (on(auth, 'admissions', 'admissions.enquiries.view')) {
    const or = [words(q, ['childName', 'parentName']), starts('enquiryNo', q)]
    if (digits) or.push({ mobile: { $regex: digits } })
    const rows = await Enquiry.find({ $or: or }).select('enquiryNo childName parentName stage').sort({ createdAt: -1 }).limit(PER_KIND).lean()
    out.push(...rows.map((e) => ({ kind: 'ENQUIRY', id: String(e._id), title: e.childName, subtitle: [e.enquiryNo, e.parentName].filter(Boolean).join(' · '), status: e.stage, path: `/admissions/enquiries${search(e.enquiryNo)}` })))
  }
  if (on(auth, 'admissions', 'admissions.applications.view')) {
    const or = [words(q, ['child.firstName', 'child.lastName', 'parent.name']), starts('applicationNo', q)]
    if (digits) or.push({ 'parent.mobile': { $regex: digits } })
    const rows = await Application.find({ $or: or }).select('applicationNo child parent status').sort({ createdAt: -1 }).limit(PER_KIND).lean()
    out.push(...rows.map((a) => ({ kind: 'APPLICATION', id: String(a._id), title: [a.child?.firstName, a.child?.lastName].filter(Boolean).join(' '), subtitle: [a.applicationNo, a.parent?.name].filter(Boolean).join(' · '), status: a.status, path: `/admissions/applications${search(a.applicationNo)}` })))
  }
  return out
}

async function books(q, auth) {
  if (!on(auth, 'library', 'library.catalogue.view')) return []
  const copy = /\s/.test(q) ? null : await LibraryCopy.findOne(starts('accessionNo', q)).select('titleId accessionNo').lean()
  const rows = await LibraryTitle.find({ $or: [words(q, ['title', 'authors']), starts('isbn', q), ...(copy ? [{ _id: copy.titleId }] : [])] }).select('title authors isbn').sort({ title: 1 }).limit(PER_KIND).lean()
  return rows.map((b) => ({ kind: 'BOOK', id: String(b._id), title: b.title, subtitle: [b.authors?.join(', '), copy && String(copy.titleId) === String(b._id) ? copy.accessionNo : b.isbn].filter(Boolean).join(' · '), path: `/library/catalogue?search=${encodeURIComponent(b.title)}` }))
}

async function assets(q, auth) {
  if (!on(auth, 'inventory', 'inventory.assets.view')) return []
  const rows = await StoreAsset.find({ $or: [words(q, ['name']), starts('assetTag', q), starts('serialNo', q)] }).select('assetTag name location roomName status').sort({ assetTag: 1 }).limit(PER_KIND).lean()
  return rows.map((a) => ({ kind: 'ASSET', id: String(a._id), title: a.name, subtitle: [a.assetTag, a.roomName || a.location].filter(Boolean).join(' · '), path: `/inventory/assets?search=${encodeURIComponent(a.assetTag)}` }))
}

async function vehicles(q, auth) {
  if (!on(auth, 'transport', 'transport.vehicles.view')) return []
  const compact = q.replace(/[\s-]/g, '')
  const rows = await Vehicle.find({ $or: [{ regNo: { $regex: esc(compact).split('').join('[\\s-]?'), $options: 'i' } }, words(q, ['driver.name'])] }).select('regNo type driver').limit(PER_KIND).lean()
  return rows.map((v) => ({ kind: 'VEHICLE', id: String(v._id), title: v.regNo, subtitle: [v.type, v.driver?.name].filter(Boolean).join(' · '), path: '/transport/vehicles' }))
}

async function visitors(q, digits, auth) {
  if (!on(auth, 'frontoffice', 'frontoffice.visitors.view')) return []
  const or = [words(q, ['name'])]
  if (digits) or.push({ mobile: { $regex: digits } })
  const rows = await Visitor.find({ $or: or }).select('name mobile date purpose hostName').sort({ inAt: -1 }).limit(PER_KIND).lean()
  return rows.map((v) => ({ kind: 'VISITOR', id: String(v._id), title: v.name, subtitle: [v.date, v.hostName].filter(Boolean).join(' · '), path: `/frontoffice/visitors?search=${encodeURIComponent(v.mobile || v.name)}&date=${v.date}` }))
}

/** Records matching what was typed, grouped by kind in a fixed order (people first). */
export async function globalSearch(raw, auth) {
  const q = String(raw ?? '').trim().slice(0, 60)
  if (q.length < 2) return []
  // a phone number: at least 4 digits typed, spaces and dashes ignored
  const digits = /^[\d\s+-]+$/.test(q) && q.replace(/\D/g, '').length >= 4 ? q.replace(/\D/g, '').slice(-10) : null
  const groups = await Promise.all([
    students(q, digits, auth), staff(q, digits, auth), receipts(q, auth), admissions(q, digits, auth),
    digits ? [] : books(q, auth), digits ? [] : assets(q, auth), digits ? [] : vehicles(q, auth), visitors(q, digits, auth),
  ])
  return groups.flat()
}
