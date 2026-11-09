import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ShieldAlert, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import { useFormat } from '../../context/SettingsContext'
import AuthShell from '../Auth/AuthShell'

const verifyTc = async (code) => (await api.get(`/v1/public/verify/tc/${encodeURIComponent(code)}`)).data.data

/** The page a transfer certificate's QR opens (/verify/tc/<code>): the next school checks it is genuine and valid. */
export default function VerifyTc() {
  const { t } = useTranslation('scan')
  const { date } = useFormat()
  const { code } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['verify-tc', code], queryFn: () => verifyTc(code), retry: false })
  return (
    <AuthShell>
      {isLoading ? <div className="h-32 rounded-xl bg-black/5 animate-pulse" /> : error ? (
        <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error.message}</div>
      ) : !data?.found ? (
        <>
          <CircleHelp className="w-10 h-10 text-amber-500" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('scan.tc.notFoundTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('scan.tc.notFound')}</p>
        </>
      ) : (
        <>
          {data.valid ? <ShieldCheck className="w-10 h-10 text-success-600" /> : <ShieldAlert className="w-10 h-10 text-danger-600" />}
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{data.valid ? t('scan.tc.validTitle') : t('scan.tc.cancelledTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t(data.valid ? 'scan.tc.valid' : 'scan.tc.cancelled', { school: data.institution.name ?? '' })}</p>
          <dl className="mt-4 rounded-lg border border-border p-4 text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {data.tcNo && <><dt className="text-ink-muted">{t('scan.tc.no')}</dt><dd className="font-mono text-ink">{data.tcNo}</dd></>}
            <dt className="text-ink-muted">{t('scan.tc.student')}</dt><dd className="text-ink font-medium">{data.student.name}{data.student.admissionNo ? ` · ${data.student.admissionNo}` : ''}</dd>
            {data.student.dob && <><dt className="text-ink-muted">{t('scan.tc.dob')}</dt><dd className="text-ink">{date(data.student.dob)}</dd></>}
            <dt className="text-ink-muted">{t('scan.tc.leaving')}</dt><dd className="text-ink">{date(data.leavingDate)}</dd>
            {data.issuedAt && <><dt className="text-ink-muted">{t('scan.tc.issued')}</dt><dd className="text-ink">{date(data.issuedAt)}</dd></>}
          </dl>
          <p className="text-xs text-ink-faint mt-3">{t('scan.tc.compare')}</p>
        </>
      )}
    </AuthShell>
  )
}
