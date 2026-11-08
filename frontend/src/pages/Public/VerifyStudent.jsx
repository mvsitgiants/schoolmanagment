import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleHelp, ShieldAlert, ShieldCheck } from 'lucide-react'
import { verifyStudentCard } from '../../api/students'
import AuthShell from '../Auth/AuthShell'

/**
 * The page a student ID card's QR opens (/verify/student/<code>). No sign-in: a gate, an exam centre or a bus checks the
 * holder studies at the school now. Only the name and class — what the card itself shows.
 */
export default function VerifyStudent() {
  const { t } = useTranslation('students')
  const { code } = useParams()
  const { data, isLoading, error } = useQuery({ queryKey: ['verify-student', code], queryFn: () => verifyStudentCard(code), retry: false })
  return (
    <AuthShell>
      {isLoading ? <div className="h-32 rounded-xl bg-black/5 animate-pulse" /> : error ? (
        <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error.message}</div>
      ) : !data?.found ? (
        <>
          <CircleHelp className="w-10 h-10 text-amber-500" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('students.verifyCard.notFoundTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('students.verifyCard.notFound')}</p>
        </>
      ) : (
        <>
          {data.valid ? <ShieldCheck className="w-10 h-10 text-success-600" /> : <ShieldAlert className="w-10 h-10 text-danger-600" />}
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{data.valid ? t('students.verifyCard.validTitle') : t('students.verifyCard.invalidTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{data.valid ? t('students.verifyCard.valid', { name: data.name, school: data.institution.name }) : t('students.verifyCard.invalid', { name: data.name, school: data.institution.name })}</p>
          {data.valid && data.class && <p className="mt-4 rounded-lg border border-border p-4 text-sm"><span className="text-ink-muted">{t('students.verifyCard.class')}: </span><b className="text-ink">{data.class}</b></p>}
          <p className="text-xs text-ink-faint mt-3">{t('students.verifyCard.compare')}</p>
        </>
      )}
    </AuthShell>
  )
}
