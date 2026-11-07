import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, KeyRound, Send } from 'lucide-react'
import Button from '../../components/ui/Button'
import { FormField, Input } from '../../components/system'
import { forgotPassword, resetPassword } from '../../api/auth'
import AuthShell from './AuthShell'

/**
 * Forgotten password: an emailed code to a confirmed address, then a new password. Every
 * institution login on that email gets it, and every device is signed out. Without a confirmed
 * email the administrator resets it (Users › Reset password).
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.email ?? '')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setError(null)
    setBusy(true)
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const send = (e) => { e?.preventDefault(); run(async () => { setChallenge(await forgotPassword(email.trim())); setCode('') }) }
  const reset = (e) => {
    e?.preventDefault()
    run(async () => {
      const res = await resetPassword(challenge.challengeId, code.trim(), password)
      navigate('/login', { replace: true, state: { notice: res.message } })
    })
  }
  const mismatch = confirm.length > 0 && confirm !== password
  const alert = error && <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error}</div>

  return (
    <AuthShell>
      <Link to="/login" className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-6"><ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t('auth.forgot.back')}</Link>
      <h2 className="font-display text-2xl font-semibold text-ink">{t('auth.forgot.title')}</h2>
      {!challenge ? (
        <>
          <p className="text-ink-muted mt-1.5 text-sm">{t('auth.forgot.intro')}</p>
          <form onSubmit={send} className="mt-7 space-y-4" noValidate>
            <FormField label={t('auth.email', 'Email')} htmlFor="email">
              <Input id="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} />
            </FormField>
            {alert}
            <Button type="submit" size="lg" icon={Send} loading={busy} disabled={!email} className="w-full">{t('auth.forgot.send')}</Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-ink-muted mt-1.5 text-sm">{t('auth.forgot.sent', { sentTo: challenge.sentTo })}</p>
          <form onSubmit={reset} className="mt-7 space-y-4" noValidate>
            <FormField label={t('auth.code.label')} htmlFor="code">
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="tracking-[0.3em] text-lg" />
            </FormField>
            <FormField label={t('auth.forgot.newPassword')} htmlFor="password" hint={t('auth.forgot.rule')}>
              <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField label={t('auth.forgot.confirm')} htmlFor="confirm" error={mismatch ? t('auth.forgot.mismatch') : null}>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </FormField>
            {alert}
            <Button type="submit" size="lg" icon={KeyRound} loading={busy} disabled={code.length !== 6 || password.length < 8 || password !== confirm} className="w-full">{t('auth.forgot.save')}</Button>
          </form>
          <p className="mt-4 text-sm text-ink-muted text-center">
            {t('auth.code.noEmail')} <button type="button" onClick={send} className="text-brand-600 font-medium hover:underline">{t('auth.code.resend')}</button>
          </p>
        </>
      )}
    </AuthShell>
  )
}
