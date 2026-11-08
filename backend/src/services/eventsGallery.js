import { Attachment } from '../models/engines.js'
import { GalleryAlbum, SchoolEvent } from '../models/events.js'
import { audit } from '../platform/audit.js'
import { clean, isOid } from '../platform/db.js'
import { badRequest, notFound } from '../platform/errors.js'
import { readStream } from '../platform/storage.js'
import { audienceLabels, familyAudience } from './events.js'

// The photo gallery (Events › Gallery): albums — from an event or on their own — whose photos are files on the album
// (files engine, record type gallery_album; the web app shrinks them before upload). A published album is shown in the
// family app to the families it is for.

const PHOTO = /^image\//
const photosOf = (albumIds) => Attachment.find({ entityType: 'gallery_album', entityId: { $in: albumIds.map(String) }, 'deleted.at': null, mime: PHOTO }).sort({ createdAt: 1 }).select('entityId fileName size mime createdAt').lean()
const photoOut = (x) => ({ id: String(x._id), name: x.fileName, size: x.size, mime: x.mime, at: x.createdAt })

const albumOut = (a, photos, label) => {
  const mine = photos.filter((p) => p.entityId === String(a._id))
  const cover = mine.find((p) => String(p._id) === String(a.coverFileId)) ?? mine[0]
  return { ...clean(a), eventId: a.eventId ? String(a.eventId) : null, classIds: a.classIds.map(String), sectionIds: a.sectionIds.map(String), branchIds: a.branchIds.map(String), coverFileId: cover ? String(cover._id) : null, photos: mine.length, audienceLabel: label?.(a) }
}

export async function listAlbums() {
  const rows = await GalleryAlbum.find().sort({ date: -1, createdAt: -1 }).limit(500).lean()
  const [photos, label] = await Promise.all([photosOf(rows.map((r) => r._id)), audienceLabels(rows)])
  return rows.map((a) => albumOut(a, photos, label))
}

export async function getAlbum(id) {
  const a = isOid(id) ? await GalleryAlbum.findById(id).lean() : null
  if (!a) throw notFound('Album')
  const [photos, label, ev] = await Promise.all([photosOf([a._id]), audienceLabels([a]), a.eventId ? SchoolEvent.findById(a.eventId).select('title').lean() : null])
  return { ...albumOut(a, photos, label), eventTitle: ev?.title ?? null, photoList: photos.map(photoOut) }
}

export async function saveAlbum(id, input, auth, req) {
  if (input.audience === 'CLASSES' && !input.classIds?.length) throw badRequest('Some details need fixing.', { fields: { classIds: 'Pick the classes' } })
  if (input.audience === 'SECTIONS' && !input.sectionIds?.length) throw badRequest('Some details need fixing.', { fields: { sectionIds: 'Pick the sections' } })
  if (input.eventId && !await SchoolEvent.exists({ _id: input.eventId })) throw badRequest('Some details need fixing.', { fields: { eventId: 'Pick an event' } })
  const a = id ? await GalleryAlbum.findById(id) : new GalleryAlbum({ createdBy: auth.user?.name })
  if (!a) throw notFound('Album')
  for (const k of ['title', 'date', 'description', 'audience', 'classIds', 'sectionIds', 'branchIds', 'published']) if (input[k] !== undefined) a[k] = input[k]
  if (input.eventId !== undefined) a.eventId = input.eventId || undefined
  if (input.coverFileId !== undefined) a.coverFileId = input.coverFileId || undefined
  if (a.audience !== 'CLASSES') a.classIds = []
  if (a.audience !== 'SECTIONS') a.sectionIds = []
  await a.save()
  await audit({ action: id ? 'UPDATE' : 'CREATE', module: 'events', entityType: 'gallery_album', entityId: String(a._id), entityName: a.title, summary: `${id ? 'Changed' : 'Made'} the album ${a.title}${input.published === true ? ' (shown to families)' : ''}` }, req)
  return getAlbum(String(a._id))
}

/** Remove an album and its photos (the photos go to the files bin, like any deleted file). */
export async function deleteAlbum(id, auth, req) {
  const a = isOid(id) ? await GalleryAlbum.findById(id).lean() : null
  if (!a) throw notFound('Album')
  const r = await Attachment.updateMany({ entityType: 'gallery_album', entityId: String(a._id), 'deleted.at': null }, { $set: { deleted: { at: new Date(), by: auth.user?.name, reason: 'Album removed' } } })
  await GalleryAlbum.deleteOne({ _id: a._id })
  await audit({ action: 'DELETE', module: 'events', entityType: 'gallery_album', entityId: String(a._id), entityName: a.title, summary: `Removed the album ${a.title} (${r.modifiedCount} photos)` }, req)
  return { deleted: true }
}

/** Files engine: who sees and adds an album's photos. */
export async function albumRecord(id) {
  if (!isOid(id)) return null
  const a = await GalleryAlbum.findById(id).select('title').lean()
  return a ? { name: a.title, canAdd: true } : null
}

// ───────────────────────────────────────────────────────── the family app

export async function albumsForStudent(s) {
  const rows = await GalleryAlbum.find({ ...familyAudience(s), audience: { $ne: 'STAFF' } }).sort({ date: -1, createdAt: -1 }).limit(100).lean()
  const photos = await photosOf(rows.map((r) => r._id))
  return rows.map((a) => albumOut(a, photos)).filter((a) => a.photos > 0).map(({ id, title, date, description, coverFileId, photos: n }) => ({ id, title, date: date ?? null, description: description ?? null, coverFileId, photos: n }))
}

export async function albumForStudent(s, albumId) {
  const a = isOid(albumId) ? await GalleryAlbum.findOne({ _id: albumId, ...familyAudience(s), audience: { $ne: 'STAFF' } }).lean() : null
  if (!a) throw notFound('Album')
  const photos = await photosOf([a._id])
  return { id: String(a._id), title: a.title, date: a.date ?? null, description: a.description ?? null, photos: photos.map(photoOut) }
}

export async function photoForStudent(s, albumId, fileId) {
  const a = isOid(albumId) ? await GalleryAlbum.findOne({ _id: albumId, ...familyAudience(s), audience: { $ne: 'STAFF' } }).select('_id').lean() : null
  if (!a || !isOid(fileId)) throw notFound('Photo')
  const file = await Attachment.findOne({ _id: fileId, entityType: 'gallery_album', entityId: String(a._id), 'deleted.at': null, mime: PHOTO }).lean()
  if (!file) throw notFound('Photo')
  return { file, stream: readStream(file.storageKey) }
}
