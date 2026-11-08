import { dayDiff, loanState } from '@schoolgiant/shared'
import { Attachment } from '../models/engines.js'
import { LibraryFine, LibraryLoan, LibraryTitle } from '../models/library.js'
import { isOid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { getSettings } from '../platform/settings.js'
import { readStream } from '../platform/storage.js'
import { today } from './library.js'
import { fineSoFar } from './libraryDesk.js'
import { need, studentFor } from './portal.js'

// The family app › Library: the child's books out (and when they are due), what was read before, fines to pay, and
// the e-library — the e-books and links the library has put up for families (all, or the child's class).

const ebookFilter = (s) => ({ active: true, forFamilies: true, $or: [{ classIds: { $exists: false } }, { classIds: { $size: 0 } }, ...(s.classId ? [{ classIds: s.classId }] : [])] })

export async function libraryFor(f, id) {
  need(f, 'LIBRARY')
  const s = studentFor(f, id)
  const [t, settings] = await Promise.all([today(), getSettings('library')])
  const [out, past, fines, ebooks] = await Promise.all([
    LibraryLoan.find({ studentId: s._id, status: 'ISSUED' }).sort({ dueOn: 1 }).lean(),
    LibraryLoan.find({ studentId: s._id, status: { $ne: 'ISSUED' } }).sort({ returnedOn: -1 }).limit(20).lean(),
    LibraryFine.find({ studentId: s._id, status: 'OPEN' }).sort({ date: -1 }).lean(),
    LibraryTitle.find(ebookFilter(s)).sort({ title: 1 }).limit(300).lean(),
  ])
  const files = await Attachment.find({ entityType: 'library_title', entityId: { $in: ebooks.map((e) => String(e._id)) }, 'deleted.at': null }).select('entityId fileName size mime').lean()
  return {
    out: out.map((l) => {
      const state = loanState(l, t)
      return { id: String(l._id), title: l.title, accessionNo: l.accessionNo, issuedOn: l.issuedOn, dueOn: l.dueOn, state, daysLate: state === 'OVERDUE' ? dayDiff(l.dueOn, t) : 0, fineSoFar: state === 'OVERDUE' ? fineSoFar(l, t, settings) : 0, daysLeft: state === 'ISSUED' ? dayDiff(t, l.dueOn) : 0 }
    }),
    past: past.map((l) => ({ id: String(l._id), title: l.title, issuedOn: l.issuedOn, returnedOn: l.returnedOn ?? null, status: l.status })),
    fines: fines.map((x) => ({ id: String(x._id), reason: x.reason, title: x.title ?? null, amount: x.amount, date: x.date, days: x.days ?? null })),
    owed: fines.reduce((n, x) => n + x.amount, 0),
    ebooks: ebooks.map((e) => ({
      id: String(e._id), title: e.title, authors: e.authors ?? [], category: e.category ?? null, description: e.description ?? null, url: e.ebookUrl ?? null,
      files: files.filter((x) => x.entityId === String(e._id)).map((x) => ({ id: String(x._id), name: x.fileName, size: x.size, mime: x.mime })),
    })).filter((e) => e.url || e.files.length),
  }
}

/** An e-book's file, for a family whose child may see it. */
export async function ebookFile(f, id, titleId, fileId) {
  need(f, 'LIBRARY')
  const s = studentFor(f, id)
  const t = isOid(titleId) ? await LibraryTitle.findOne({ _id: titleId, ...ebookFilter(s) }).select('_id').lean() : null
  if (!t || !isOid(fileId)) throw notFound('File')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'library_title', entityId: String(t._id), 'deleted.at': null }).lean()
  if (!file) throw notFound('File')
  return { file, stream: readStream(file.storageKey) }
}
