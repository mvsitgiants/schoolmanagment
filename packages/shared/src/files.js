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
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', label: 'Excel sheet' },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', label: 'PowerPoint slides' },
  { mime: 'video/mp4', ext: 'mp4', label: 'MP4 video' },
  { mime: 'video/webm', ext: 'webm', label: 'WebM video' },
]

/** For <input type="file" accept=…>. */
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.mp4,.webm'

export const FILE_CATEGORIES = [
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'ID_PROOF', label: 'ID proof (Aadhaar, APAAR, passport)' },
  { value: 'PARENT_ID_PROOF', label: 'Parent’s ID proof (Aadhaar, PAN, voter ID)' },
  { value: 'ADDRESS_PROOF', label: 'Address proof' },
  { value: 'PREVIOUS_TC', label: 'Previous school’s TC' },
  { value: 'CHARACTER_CERTIFICATE', label: 'Character certificate' },
  { value: 'MARKSHEET', label: 'Mark sheet / report card' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'MEDICAL', label: 'Medical / fitness certificate' },
  { value: 'CASTE_INCOME', label: 'Caste / income certificate' },
  { value: 'PAYMENT_PROOF', label: 'Payment proof' },
  { value: 'HR_DOCUMENT', label: 'HR document / certificate' },
  { value: 'OTHER', label: 'Other' },
]
export const FILE_CATEGORY_LABEL = Object.fromEntries(FILE_CATEGORIES.map((c) => [c.value, c.label]))

/** Cards with two sides (Aadhaar, ID cards): each photo says which side it is. */
export const FILE_SIDES = [
  { value: 'FRONT', label: 'Front' },
  { value: 'BACK', label: 'Back' },
]
export const TWO_SIDED_CATEGORIES = ['ID_PROOF', 'PARENT_ID_PROOF', 'ADDRESS_PROOF']

/** A personal document's check by the office: the original seen and matching. */
export const FILE_VERIFY_STATUS = {
  PENDING: { label: 'Not checked yet', tone: 'neutral' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Not accepted', tone: 'danger' },
}

/** Records whose files are personal documents, so each file says what kind it is (certificate, ID, mark sheet…). Other records' files (lesson plans, homework, notices…) have no kind. */
export const DOCUMENT_RECORD_TYPES = ['student', 'employee', 'candidate', 'application', 'admission_form']

/** Records that can carry files and comments. */
export const RECORD_TYPES = {
  student: 'Student',
  homework: 'Homework',
  notice: 'Notice',
  application: 'Admission application',
  admission_form: 'Admission form filled by a family',
  class_kit: 'Books & uniform list',
  employee: 'Staff record',
  candidate: 'Job candidate',
  library_title: 'Library e-book',
  school_event: 'Event (circular, form)',
  gallery_album: 'Photo album',
  accreditation_evidence: 'Accreditation evidence',
  placement_offer: 'Placement offer',
  expense: 'Expense',
  syllabus_topic: 'Syllabus topic',
  lesson_plan: 'Lesson plan',
  lms_item: 'Study material',
  chat_message: 'Staff chat message',
  scholarship_doc: 'Scholarship document',
  doc_folder: 'Library folder',
}

export const COMMENT_MAX = 2000
