import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import { confirmEmailLink, getCurrentUser } from '../../api/auth'
import { landingFor } from '../../catalog/nav'
import AuthShell from './AuthShell'

// One request per link, even when React runs the effect twice (StrictMode): a link works once.
const pending = new Map()
const confirmOnce = (token) => {
  if (!pending.has(token)) pending.set(token, confirmEmailLink(token))
  return pending.get(token)
}

/**
 * The "Confirm my email" link from the confirmation email (/verify-email#<token>). Works without
 * signing in — people often open it on their phone. The token is in the fragment, so it never
 * reaches a server log.
 */
export default function VerifyEmailPage() {
  const { t } = useTranslation('common')
  const [token] = useState(() => window.location.hash.replace(/^#/, ''))
  const [result, setResult] = useState(null) // { email } | { error }

  useEffect(() => {
    if (!token) { setResult({ error: t('auth.verifyEmail.missing') }); return }
    confirmOnce(token).then((r) => setResult({ email: r.email }), (err) => setResult({ error: err.message }))
  }, [token, t])

  const me = getCurrentUser()
  return (
    <AuthShell>
      {!result ? (
        <div className="h-24 rounded-xl bg-black/5 animate-pulse" />
      ) : result.error ? (
        <>
          <h2 className="font-display text-2xl font-semibold text-ink">{t('auth.verifyEmail.failedTitle')}</h2>
          <div role="alert" className="mt-4 text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{result.error}</div>
          <Link to={me ? '/me' : '/login'} className="inline-block mt-4 text-sm text-brand-600 font-medium hover:underline">{t(me ? 'auth.verifyEmail.toAccount' : 'auth.forgot.back')}</Link>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-10 h-10 text-success-600" />
          <h2 className="mt-3 font-display text-2xl font-semibold text-ink">{t('auth.verifyEmail.doneTitle')}</h2>
          <p className="text-ink-muted mt-1.5 text-sm">{t('auth.verifyEmail.done', { email: result.email })}</p>
          <Button to={me ? landingFor(me) : '/login'} size="lg" className="w-full mt-6">{t(me ? 'auth.verifyEmail.openApp' : 'auth.signIn')}</Button>
        </>
      )}
    </AuthShell>
  )
}
