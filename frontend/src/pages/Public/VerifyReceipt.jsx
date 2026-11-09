import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ShieldAlert, ShieldCheck } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import { verifyReceipt } from '../../api/scan'
import { useFormat } from '../../context/SettingsContext'
import AuthShell from '../Auth/AuthShell'

/**
 * The page a fee receipt's QR opens (/verify/receipt/<code>). No sign-in: anyone holding a receipt — a parent, an
 * auditor, the school's own office — checks it is genuine and not cancelled. Receipt number, date, amount and whose.
 */
export default function VerifyReceipt() {
  const { t } = useTranslation('scan')
  const { date } = useFormat()
  const { code } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['verify-receipt', code], queryFn: () => verifyReceipt(code), retry: false })
  return (
    <AuthShell>
      {isLoading ? <div className="h-32 rounded-xl bg-black/5 animate-pulse" /> : error ? (
        <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error.message}</div>
      ) : !data?.found ? (
        <>
          <CircleHelp className="w-10 h-10 text-amber-500" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('scan.receipt.notFoundTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('scan.receipt.notFound')}</p>
        </>
      ) : (
        <>
          {data.valid ? <ShieldCheck className="w-10 h-10 text-success-600" /> : <ShieldAlert className="w-10 h-10 text-danger-600" />}
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{data.valid ? t('scan.receipt.validTitle') : t('scan.receipt.cancelledTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t(data.valid ? 'scan.receipt.valid' : 'scan.receipt.cancelled', { school: data.institution.name ?? '' })}</p>
          <dl className="mt-4 rounded-lg border border-border p-4 text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-ink-muted">{t('scan.receipt.no')}</dt><dd className="font-mono text-ink">{data.receiptNo}</dd>
            <dt className="text-ink-muted">{t('scan.receipt.date')}</dt><dd className="text-ink">{date(data.date)}</dd>
            <dt className="text-ink-muted">{t('scan.receipt.amount')}</dt><dd className="font-semibold text-ink">{formatINR(data.amount)}</dd>
            {data.refunded > 0 && <><dt className="text-ink-muted">{t('scan.receipt.refunded')}</dt><dd className="text-ink">{formatINR(data.refunded)}</dd></>}
            {data.student && <><dt className="text-ink-muted">{t('scan.receipt.student')}</dt><dd className="text-ink">{data.student.name} · {data.student.admissionNo}</dd></>}
          </dl>
          <p className="text-xs text-ink-faint mt-3">{t('scan.receipt.compare')}</p>
        </>
      )}
    </AuthShell>
  )
}
