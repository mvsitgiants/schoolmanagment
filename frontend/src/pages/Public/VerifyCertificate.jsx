import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ShieldAlert, ShieldCheck } from 'lucide-react'
import { verifyCertificate } from '../../api/certificates'
import { useFormat } from '../../context/SettingsContext'
import AuthShell from '../Auth/AuthShell'

/**
 * The page a certificate's QR opens (/verify/<code>). No sign-in: a passport office, bank or another
 * school checks the certificate is genuine and not cancelled. It shows only what the paper itself shows.
 */
export default function VerifyCertificate() {
  const { t } = useTranslation('certificates')
  const { code } = useParams()
  const { date } = useFormat()
  const { data, isLoading, error } = useQuery({ queryKey: ['verify-certificate', code], queryFn: () => verifyCertificate(code), retry: false })

  return (
    <AuthShell>
      {isLoading ? <div className="h-32 rounded-xl bg-black/5 animate-pulse" /> : error ? (
        <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error.message}</div>
      ) : !data?.found ? (
        <>
          <CircleHelp className="w-10 h-10 text-amber-500" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('certificates.verify.notFoundTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('certificates.verify.notFound', { code })}</p>
        </>
      ) : (
        <>
          {data.valid ? <ShieldCheck className="w-10 h-10 text-success-600" /> : <ShieldAlert className="w-10 h-10 text-danger-600" />}
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{data.valid ? t('certificates.verify.validTitle') : t('certificates.verify.cancelledTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{data.valid ? t('certificates.verify.valid', { institution: data.institution.name }) : t('certificates.verify.cancelled', { institution: data.institution.name, date: data.cancelledAt ? date(String(data.cancelledAt).slice(0, 10)) : '—' })}</p>
          <dl className="mt-5 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm rounded-lg border border-border p-4">
            <dt className="text-ink-muted">{t('certificates.verify.certificate')}</dt><dd className="font-medium text-ink">{t(`certificates.kinds.${data.kind}.label`, data.kindLabel)}</dd>
            <dt className="text-ink-muted">{t('certificates.verify.no')}</dt><dd className="font-mono-num text-ink">{data.certificateNo}</dd>
            <dt className="text-ink-muted">{t('certificates.verify.issued')}</dt><dd className="text-ink">{date(data.issueDate)}</dd>
            <dt className="text-ink-muted">{t('certificates.verify.name')}</dt><dd className="font-medium text-ink">{data.name}</dd>
            {data.class && <><dt className="text-ink-muted">{t('certificates.verify.class')}</dt><dd className="text-ink">{data.class}</dd></>}
            {data.event && <><dt className="text-ink-muted">{t('certificates.verify.event')}</dt><dd className="text-ink">{data.event}</dd></>}
            <dt className="text-ink-muted">{t('certificates.verify.institution')}</dt><dd className="text-ink">{[data.institution.name, data.institution.city].filter(Boolean).join(', ')}</dd>
          </dl>
          <p className="text-xs text-ink-faint mt-3">{t('certificates.verify.compare')}</p>
        </>
      )}
    </AuthShell>
  )
}
