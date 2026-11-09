// Attachments and discussion (E15): files and comments on any record — a student, a
// receipt, a staff record. Files are checked by their content, not their name, so only
// these types are kept.

export const FILE_MAX_MB = 15

export const FILE_TYPES = [
  { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG image' },
  { mime: 'image/png', ext: 'png', label: 'PNG image' },
  { mime: 'image/webp', ext: 'webp', label: 'WebP image' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', label: 'Word document' },
]

/** For <input type="file" accept=…>. */
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx'

export const FILE_CATEGORIES = [
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'ID_PROOF', label: 'ID proof (Aadhaar, APAAR, passport)' },
  { value: 'PREVIOUS_TC', label: 'Previous school’s TC' },
  { value: 'MARKSHEET', label: 'Mark sheet / report card' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'MEDICAL', label: 'Medical / fitness certificate' },
  { value: 'CASTE_INCOME', label: 'Caste / income certificate' },
  { value: 'PAYMENT_PROOF', label: 'Payment proof' },
  { value: 'HR_DOCUMENT', label: 'HR document / certificate' },
  { value: 'OTHER', label: 'Other' },
]
export const FILE_CATEGORY_LABEL = Object.fromEntries(FILE_CATEGORIES.map((c) => [c.value, c.label]))

/** Records that can carry files and comments. */
export const RECORD_TYPES = {
  student: 'Student',
  homework: 'Homework',
  notice: 'Notice',
  application: 'Admission application',
  employee: 'Staff record',
  candidate: 'Job candidate',
  library_title: 'Library e-book',
  school_event: 'Event (circular, form)',
  gallery_album: 'Photo album',
  accreditation_evidence: 'Accreditation evidence',
  placement_offer: 'Placement offer',
  expense: 'Expense',
  lms_item: 'Study material',
  chat_message: 'Staff chat message',
}

export const COMMENT_MAX = 2000
