import { addDaysYmd, mobile10 } from '@schoolgiant/shared'
import { badRequest } from '../platform/errors.js'
import { familyCalendarItems, familyReply, today } from './events.js'
import { albumForStudent, albumsForStudent, photoForStudent } from './eventsGallery.js'
import { familyBook, familyCancel, ptmForStudent } from './eventsPtm.js'
import { need, studentFor } from './portal.js'

// The family app's calendar, meetings and photos (feature EVENTS): each call checks the feature and that the student
// is the family's, then hands over to the module's services.

/** The guardian signed in: the one whose number they signed in with (else the primary one). */
const guardianOf = (f, s) => {
  const me = mobile10(f.session?.mobile)
  const g = (s.guardians ?? []).find((x) => me && mobile10(x.mobile) === me) ?? (s.guardians ?? []).find((x) => x.isPrimary) ?? s.guardians?.[0]
  return { name: g?.name || 'Family', mobile: g?.mobile || f.session?.mobile }
}
const student = (f, id) => { need(f, 'EVENTS'); return studentFor(f, id) }

export async function familyCalendar(f, id, { from, to }) {
  const s = student(f, id)
  const t = await today()
  const start = from || t
  const end = to || addDaysYmd(start, 90)
  if (end < start || end > addDaysYmd(start, 400)) throw badRequest('Ask for up to a year at a time.')
  return { from: start, to: end, today: t, items: await familyCalendarItems(s, { from: start, to: end }) }
}
export const familyEventReply = async (f, id, eventId, body) => { const s = student(f, id); return familyReply(s, eventId, body, guardianOf(f, s).name) }
export const familyMeetings = async (f, id) => ptmForStudent(student(f, id))
export const familyMeetingBook = async (f, id, sessionId, body) => { const s = student(f, id); return familyBook(s, sessionId, body, guardianOf(f, s)) }
export const familyMeetingCancel = async (f, id, bookingId) => familyCancel(student(f, id), bookingId)
export const familyAlbums = async (f, id) => albumsForStudent(student(f, id))
export const familyAlbum = async (f, id, albumId) => albumForStudent(student(f, id), albumId)
export const familyPhoto = async (f, id, albumId, fileId) => photoForStudent(student(f, id), albumId, fileId)
