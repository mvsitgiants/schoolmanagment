import { FILE_CATEGORY_LABEL } from '@schoolgiant/shared'
import { Attachment } from '../models/engines.js'
import { isOid } from '../platform/db.js'
import { notFound } from '../platform/errors.js'
import { readStream } from '../platform/storage.js'
import { need, studentFor } from './portal.js'

// The family app › Documents (feature DOCUMENTS): the child's own papers the school holds — given at admission, on
// the student record, sent for scholarships — so the family can see what is already there and stops sending it again.
// Only originals of the child's own papers (never the school's internal files); each opened inline or downloaded.

const OWN_PAPERS = ['student', 'scholarship_doc']

const filter = (s) => ({ studentId: s._id, entityType: { $in: OWN_PAPERS }, linkOf: null, 'deleted.at': null })

export async function familyDocuments(f, studentId) {
  need(f, 'DOCUMENTS')
  const s = studentFor(f, studentId)
  const rows = await Attachment.find(filter(s)).sort({ createdAt: -1 }).limit(200).lean()
  return rows.map((a) => ({
    id: String(a._id), fileName: a.fileName, contentType: a.mime, size: a.size, title: a.title ?? null, side: a.side ?? null,
    category: a.category, categoryLabel: FILE_CATEGORY_LABEL[a.category] ?? a.category,
    checked: a.verification?.status === 'VERIFIED', at: a.createdAt,
  }))
}

export async function familyDocumentFile(f, studentId, fileId) {
  need(f, 'DOCUMENTS')
  const s = studentFor(f, studentId)
  const file = isOid(fileId) ? await Attachment.findOne({ ...filter(s), _id: fileId }).lean() : null
  if (!file) throw notFound('Document')
  return { file, stream: readStream(file.storageKey) }
}
