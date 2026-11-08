// Communication hub: notices and circulars, one-off messages to families, parent–teacher chat.
// Messages go out through the outbox (Notification rules decide the wording and channels; the
// sender ticks the channels for a notice or a message). Families read notices and chat in the app.

export const NOTICE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
}

/** Who a notice or a message is for. */
export const AUDIENCE_KINDS = [
  { value: 'ALL', label: 'Whole school' },
  { value: 'CLASSES', label: 'Some classes' },
  { value: 'SECTIONS', label: 'Some sections' },
  { value: 'STUDENTS', label: 'Some students' },
]

export const NOTICE_CATEGORIES = ['General', 'Holiday', 'Event', 'Exam', 'Fees', 'Transport', 'Circular', 'Urgent']

/** The channels a sender may tick; the app always shows a published notice. */
export const SEND_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL']

/** SMS in India must match a DLT-registered template; keep one-off texts short. */
export const SMS_MAX = 300
export const CHAT_MAX = 1000

/** Who said it, in a chat. */
export const CHAT_SIDES = { FAMILY: 'FAMILY', STAFF: 'STAFF' }

/** A short summary of an audience, e.g. "Class 8, Class 9" — `labels` maps ids to names. */
export function audienceSummary(a, labels = {}) {
  if (!a || a.kind === 'ALL') return 'Whole school'
  const ids = a.kind === 'CLASSES' ? a.classIds : a.kind === 'SECTIONS' ? a.sectionIds : a.studentIds
  const names = (ids ?? []).map((id) => labels[id]).filter(Boolean)
  if (a.kind === 'STUDENTS') return `${(ids ?? []).length} student(s)`
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ') || '—'
}
