import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import Button from '../../components/ui/Button'
import { FormField, Input } from '../../components/system'
import { acceptInvite, checkInvite } from '../../api/auth'
import { landingFor } from '../../catalog/nav'
import AuthShell from './AuthShell'

/**
 * The emailed invite link (/accept-invite#<token>): choose your password and you're in. The
 * token is in the fragment, so it never reaches a server log or a Referer header.
 */
export default function AcceptInvitePage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [token] = useState(() => window.location.hash.replace(/^#/, ''))
  const [invite, setInvite] = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [paused, setPaused] = useState(null)

  useEffect(() => {
    if (!token) { setError(t('auth.invite.missing')); return }
    checkInvite(token).then(setInvite, (err) => setError(err.message))
  }, [token, t])

  const submit = async (e) => {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await acceptInvite(token, password)
      if (res.signedIn) navigate(landingFor(res.me), { replace: true })
      else setPaused(res.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const mismatch = confirm.length > 0 && confirm !== password
  const alert = error && <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error}</div>

  return (
    <AuthShell>
      <h2 className="font-display text-2xl font-semibold text-ink">{invite ? t('auth.invite.title', { institution: invite.institution }) : t('auth.invite.titlePlain')}</h2>
      {paused ? (
        <p className="mt-4 text-sm text-ink-muted">{paused}</p>
      ) : invite ? (
        <>
          <p className="text-ink-muted mt-1.5 text-sm">{t('auth.invite.intro', { name: invite.name, email: invite.email })}</p>
          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <FormField label={t('auth.forgot.newPassword')} htmlFor="password" hint={t('auth.forgot.rule')}>
              <Input id="password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField label={t('auth.forgot.confirm')} htmlFor="confirm" error={mismatch ? t('auth.forgot.mismatch') : null}>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </FormField>
            {alert}
            <Button type="submit" size="lg" icon={KeyRound} loading={busy} disabled={password.length < 8 || password !== confirm} className="w-full">{t('auth.invite.save')}</Button>
          </form>
        </>
      ) : (
        <div className="mt-6 space-y-4">
          {alert || <div className="h-24 rounded-xl bg-black/5 animate-pulse" />}
          {error && <Link to="/login" className="inline-block text-sm text-brand-600 font-medium hover:underline">{t('auth.forgot.back')}</Link>}
        </div>
      )}
    </AuthShell>
  )
}
