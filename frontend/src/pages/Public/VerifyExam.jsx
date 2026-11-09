import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import AuthShell from '../Auth/AuthShell'

const verifyExam = async (code) => (await api.get(`/v1/public/verify/exam/${encodeURIComponent(code)}`)).data.data

/**
 * The page a hall ticket's or report card's QR opens (/verify/exam/<code>). No sign-in: an exam centre checks the
 * candidate, another school checks a report card. The result shows only once the school has published it.
 */
export default function VerifyExam() {
  const { t } = useTranslation('scan')
  const { code } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['verify-exam', code], queryFn: () => verifyExam(code), retry: false })
  return (
    <AuthShell>
      {isLoading ? <div className="h-32 rounded-xl bg-black/5 animate-pulse" /> : error ? (
        <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error.message}</div>
      ) : !data?.found ? (
        <>
          <CircleHelp className="w-10 h-10 text-amber-500" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('scan.exam.notFoundTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('scan.exam.notFound')}</p>
        </>
      ) : (
        <>
          <ShieldCheck className="w-10 h-10 text-success-600" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('scan.exam.validTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('scan.exam.valid', { school: data.institution.name ?? '' })}</p>
          <dl className="mt-4 rounded-lg border border-border p-4 text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-ink-muted">{t('scan.exam.student')}</dt><dd className="text-ink font-medium">{data.student.name}{data.student.admissionNo ? ` · ${data.student.admissionNo}` : ''}</dd>
            {data.student.class && <><dt className="text-ink-muted">{t('scan.exam.class')}</dt><dd className="text-ink">{data.student.class}</dd></>}
            <dt className="text-ink-muted">{t('scan.exam.exam')}</dt><dd className="text-ink">{data.exam.name}</dd>
            <dt className="text-ink-muted">{t('scan.exam.result')}</dt>
            <dd className="text-ink">{data.result ? <b>{t('scan.exam.resultLine', { pct: data.result.pct ?? '—', grade: data.result.grade ?? '—' })}</b> : <span className="text-ink-faint">{t('scan.exam.notPublished')}</span>}</dd>
          </dl>
          <p className="text-xs text-ink-faint mt-3">{t('scan.exam.compare')}</p>
        </>
      )}
    </AuthShell>
  )
}
