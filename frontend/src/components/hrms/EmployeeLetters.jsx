import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileCheck2, Printer, Upload } from 'lucide-react'
import { FILE_ACCEPT, FILE_MAX_MB } from '@schoolgiant/shared'
import { Panel, Tag } from '../system'
import Button from '../ui/Button'
import { fetchFiles, uploadFile } from '../../api/files'
import { printDocument } from '../print/printDocument'
import { useFormat } from '../../context/SettingsContext'
import { useSnackbar } from '../../context/SnackbarContext'

/**
 * The Letters tab: every HR paper printed for this person — which, its reference, who printed it and when — with
 * "Print again", and the signed copy: upload the scan and it is kept in their Files as an HR document, named after
 * the letter, so the row shows it is on file.
 */
export default function EmployeeLetters({ emp, canUpload, canSeeFiles, onShowFiles }) {
  const { t } = useTranslation('hrms')
  const qc = useQueryClient()
  const { dateTime } = useFormat()
  const { showSuccess, showError } = useSnackbar()
  const input = useRef(null)
  const [target, setTarget] = useState(null) // the letter whose signed copy is being uploaded
  const [busy, setBusy] = useState(null)
  const files = useQuery({ queryKey: ['files', 'employee', emp.id], queryFn: () => fetchFiles('employee', emp.id), enabled: canSeeFiles })
  const letters = emp.letters ?? []
  const docLabel = (doc) => t(`hrms.letters.docs.${doc}`)
  const signedTitle = (l) => `${t('hrms.letters.signedPrefix')} ${docLabel(l.doc)}${l.ref ? ` — ${l.ref}` : ''}`
  const onFile = new Set((files.data ?? []).map((f) => f.title))

  const pick = (l) => { setTarget(l); input.current?.click() }
  const upload = async (file) => {
    if (!file || !target) return
    if (file.size > FILE_MAX_MB * 1024 * 1024) { showError(t('hrms.letters.tooBig', { max: FILE_MAX_MB })); return }
    const key = `${target.doc}-${target.at}`
    setBusy(key)
    try {
      await uploadFile('employee', emp.id, file, { category: 'HR_DOCUMENT', title: signedTitle(target) })
      qc.invalidateQueries({ queryKey: ['files', 'employee', emp.id] })
      showSuccess(t('hrms.letters.uploaded'))
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(null); setTarget(null)
    }
  }

  return (
    <Panel title={t('hrms.letters.title')} icon={Printer} subtitle={t('hrms.letters.subtitle')}>
      <input ref={input} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(ev) => { upload(ev.target.files?.[0]); ev.target.value = '' }} />
      {!letters.length ? <p className="text-sm text-ink-muted">{t('hrms.letters.none')}</p> : (
        <ul className="divide-y divide-border -my-2">
          {letters.map((l) => {
            const key = `${l.doc}-${l.at}`
            const signed = onFile.has(signedTitle(l))
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {docLabel(l.doc)}
                    {signed && <Tag tone="success" icon={FileCheck2}>{t('hrms.letters.signedOnFile')}</Tag>}
                  </span>
                  <span className="block text-xs text-ink-muted">{[l.ref, dateTime(l.at), l.by && t('hrms.letters.by', { name: l.by })].filter(Boolean).join(' · ')}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" icon={Printer} onClick={() => printDocument(l.doc, emp.id)}>{t('hrms.letters.printAgain')}</Button>
                  {signed && canSeeFiles && <Button size="sm" variant="ghost" onClick={onShowFiles}>{t('hrms.letters.seeCopy')}</Button>}
                  {!signed && canUpload && <Button size="sm" variant="secondary" icon={Upload} loading={busy === key} onClick={() => pick(l)}>{t('hrms.letters.uploadSigned')}</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
