import { useTranslation } from 'react-i18next'
import { Award, Camera, FileText, Plus, Printer } from 'lucide-react'
import { TC_STATUS } from '@schoolgiant/shared'
import { Attachments, CodeBadge, ColorChip, SectionCard, StatusPill } from '../../system'
import Button from '../../ui/Button'
import StudentPhoto from '../StudentPhoto'
import { hasPermission } from '../../../api/auth'
import { printDocument } from '../../print/printDocument'
import { useFormat } from '../../../context/SettingsContext'
import { Quiet, SectionError, broken, list, useLabels } from './kit'

/** Student 360 › Documents: the photo, the files kept on the record, certificates issued and transfer certificates. */
export default function DocumentsTab({ s, o, canEdit }) {
  const { t } = useTranslation('students')
  const L = useLabels()
  const { date } = useFormat()
  const certs = o?.certificates
  const canPrintCert = hasPermission('certificates.issue.print') || hasPermission('certificates.register.view')
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SectionCard icon={Camera} title={t('students.photo.title')} hint={t('students.photo.hint')}>
        <StudentPhoto studentId={s.id} name={s.name} canEdit={canEdit || hasPermission('students.id-cards.print')} />
      </SectionCard>
      <div className="flex min-w-0 flex-col gap-6">
        {/* Attachments draws its own card (title, upload, the list) */}
        <Attachments entityType="student" entityId={s.id} label={t('students.profile.documents.files')} canAdd={canEdit || hasPermission('students.admit.create')} />
        {certs && (
          <SectionCard icon={Award} title={t('students.profile.documents.certificates')} count={broken(certs) ? null : list(certs).length || null} flush
            actions={hasPermission('certificates.issue.create') && s.status !== 'LEFT' && <Button size="sm" variant="ghost" className="-my-1" icon={Plus} to={`/certificates/issue?student=${s.id}`}>{t('students.profile.documents.issue')}</Button>}>
            {broken(certs) ? <SectionError /> : list(certs).length === 0 ? <Quiet icon={Award} title={t('students.profile.documents.noCertificates')} /> : (
              <ul className="divide-y divide-border">
                {certs.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <ColorChip label={L.certKind(c.kind, c.kindLabel)} seed={`cert-${c.kind}`} className="max-w-[50%]" />
                    <span className="min-w-0 flex-1">
                      <CodeBadge>{c.certificateNo}</CodeBadge>
                      <span className="ms-2 text-[11px] text-ink-faint">{date(c.issueDate)}{c.purpose ? ` · ${c.purpose}` : ''}</span>
                    </span>
                    {c.status !== 'ISSUED' && <StatusPill tone="neutral">{t(`certificates:certificates.status.${c.status}`, c.status)}</StatusPill>}
                    {canPrintCert && c.status === 'ISSUED' && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.profile.documents.print')} title={t('students.profile.documents.print')} onClick={() => printDocument('CERTIFICATE', c.id)} />}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
        <SectionCard icon={FileText} title={t('students.profile.tcs')} count={s.tcs.length || null} flush>
          {s.tcs.length === 0 ? <p className="px-4 py-4 text-sm text-ink-faint">{t('students.profile.noTcs')}</p> : (
            <ul className="divide-y divide-border">
              {s.tcs.map((tc) => (
                <li key={tc.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono-num text-sm text-ink">{tc.tcNo ?? t('students.transfer.draft')}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{date(tc.leavingDate)} · {tc.reasonLabel}</span>
                  </span>
                  <StatusPill tone={TC_STATUS[tc.status]?.tone}>{t(`students.transfer.status.${tc.status}`, tc.statusLabel)}</StatusPill>
                  {hasPermission('students.transfer.print') && <Button size="sm" variant="ghost" icon={Printer} aria-label={t('students.transfer.print')} title={t('students.transfer.print')} onClick={() => printDocument('TRANSFER_CERTIFICATE', tc.id)} />}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
