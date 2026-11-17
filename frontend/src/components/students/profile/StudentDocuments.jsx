import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderCheck } from 'lucide-react'
import { DEFAULT_ADMISSION_DOCS } from '@schoolgiant/shared'
import { SectionCard, openDocumentViewer, usePrompt } from '../../system'
import AdmissionDocuments, { missingNow } from '../AdmissionDocuments'
import { deleteFile, downloadFile, fetchFiles, uploadFile, verifyFile } from '../../../api/files'
import { fetchAcademicLookup } from '../../../api/academics'
import { useSnackbar } from '../../../context/SnackbarContext'

/**
 * Student 360 › Documents: the campus's admission checklist with what is in — birth certificate, Aadhaar front and back,
 * TC, character certificate … — and the office's check of each against the original (verified / not accepted, who and
 * when). Documents that came later are added here, as a file or a photo with a caption.
 */
export default function StudentDocuments({ s, canEdit }) {
  const { t } = useTranslation('students')
  const qc = useQueryClient()
  const prompt = usePrompt()
  const { showError, showSuccess } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const key = ['files', 'student', s.id]
  const { data: files = [] } = useQuery({ queryKey: key, queryFn: () => fetchFiles('student', s.id) })
  const { data: lookup } = useQuery({ queryKey: ['academic-lookup'], queryFn: fetchAcademicLookup })
  const campus = lookup?.branches?.find((b) => b.id === s.branchId) ?? (s.branchId ? null : lookup?.branches?.[0])
  const checklist = campus?.admissionDocs ?? DEFAULT_ADMISSION_DOCS
  const items = files.map((f) => ({ ...f, key: f.id }))
  const missing = missingNow(checklist.map((d) => ({ ...d, when: 'NOW' })), items) // every listed document, for the count
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const run = async (fn) => { setBusy(true); try { await fn(); refresh() } catch (e) { showError(e.message) } finally { setBusy(false) } }

  const view = (it) => openDocumentViewer({
    name: it.fileName, contentType: it.contentType, load: () => downloadFile(it.id),
    download: async () => {
      const { data } = await downloadFile(it.id)
      const url = URL.createObjectURL(data)
      const a = Object.assign(document.createElement('a'), { href: url, download: it.fileName || 'file' })
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    },
  })
  const verify = async (it, status) => {
    let note
    if (status === 'REJECTED') {
      note = await prompt({ title: t('students.docs.rejectTitle', { name: it.title || it.fileName }), label: t('students.docs.rejectReason'), placeholder: t('students.docs.rejectPlaceholder'), required: true, confirmLabel: t('students.docs.markRejected'), tone: 'danger' })
      if (!note) return
    }
    await run(async () => { await verifyFile(it.id, status, note); if (status === 'VERIFIED') showSuccess(t('students.docs.verifiedDone')) })
  }
  const remove = async (it) => {
    const reason = await prompt({ title: t('students.docs.removeTitle', { name: it.title || it.fileName }), label: t('students.docs.removeReason'), required: true, confirmLabel: t('students.docs.remove'), tone: 'danger' })
    if (reason) await run(() => deleteFile(it.id, reason))
  }

  return (
    <SectionCard icon={FolderCheck} title={t('students.docs.title')} count={items.length || null}
      hint={missing.length ? t('students.docs.pendingCount', { count: missing.length }) : t('students.docs.allIn')}>
      <AdmissionDocuments checklist={checklist} items={items} busy={busy} readOnly={!canEdit}
        onAdd={(file, meta) => run(() => uploadFile('student', s.id, file, meta))}
        onRemove={canEdit ? remove : undefined} onView={view} onVerify={canEdit ? verify : undefined} />
    </SectionCard>
  )
}
