import clsx from 'clsx'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Fingerprint, KeyRound, Laptop, LogOut, MailCheck, PenLine, ShieldCheck, Smartphone } from 'lucide-react'
import { SCOPE_LABELS, modulesTouched } from '@schoolgiant/shared'
import { FormField, Input, SectionCard, SkeletonRows, StatusPill, Tag } from '../../components/system'
import Button from '../../components/ui/Button'
import { changePassword, confirmEmailVerify, fetchSessions, logoutAll, setTwoStep, signOutSession, startEmailVerify, syncCurrentUser } from '../../api/auth'
import { Switch } from '../../components/app/Controls'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { Info, InfoGrid, TOUCH } from './shared'

/**
 * The login itself, not the staff record: what the role lets you do, the password, the
 * signing PIN clinicians sign with, the attendance kiosk PIN (staff with an HR record), and
 * where you are signed in. Always on the workspace —
 * a login with no staff record still has a password to change and sessions to end.
 */

const device = (ua = '', t) => {
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua)
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : t('me.account.browser')
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return { mobile, label: os ? t('me.account.deviceOn', { browser, os }) : browser }
}

function PasswordPanel() {
  const { t } = useTranslation('me')
  const { showSuccess, showError } = useSnackbar()
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (pw.next !== pw.confirm) { showError(t('me.account.passwordsDontMatch')); return }
    setBusy(true)
    try {
      showSuccess(await changePassword(pw.current, pw.next))
      setPw({ current: '', next: '', confirm: '' })
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SectionCard icon={KeyRound} title={t('me.account.changePassword')} hint={t('me.account.changePasswordSub')}>
      <form onSubmit={submit} className="space-y-3">
        <FormField label={t('me.account.currentPassword')}><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></FormField>
        <FormField label={t('me.account.newPassword')} hint={t('me.account.newPasswordHint')}><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></FormField>
        <FormField label={t('me.account.repeatNewPassword')}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></FormField>
        <Button type="submit" loading={busy} disabled={!pw.current || !pw.next} className={TOUCH}>{t('me.account.changePassword')}</Button>
      </form>
    </SectionCard>
  )
}

/** Confirm the sign-in email, and the optional code at every sign-in (a role may require it). */
function SignInSecurityPanel({ me }) {
  const { t } = useTranslation('me')
  const { showSuccess, showError } = useSnackbar()
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const u = me?.user ?? {}
  const canEmail = !!me?.features?.email
  const run = async (fn) => {
    setBusy(true)
    try { await fn() } catch (err) { showError(err.message) } finally { setBusy(false) }
  }
  const send = () => run(async () => { setChallenge(await startEmailVerify()); setCode('') })
  const confirm = (e) => {
    e.preventDefault()
    run(async () => { await confirmEmailVerify(challenge.challengeId, code.trim()); setChallenge(null); showSuccess(t('me.account.emailConfirmed')) })
  }
  const toggle = (on) => run(async () => { await setTwoStep(on); showSuccess(t(on ? 'me.account.twoStepOn' : 'me.account.twoStepOff')) })

  return (
    <SectionCard icon={MailCheck} title={t('me.account.signInSecurity')} hint={t('me.account.signInSecuritySub')}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink truncate">{u.email}</p>
            <p className="text-xs text-ink-muted mt-0.5">{t(u.emailVerified ? 'me.account.emailVerifiedHint' : 'me.account.emailUnverifiedHint')}</p>
          </div>
          <StatusPill tone={u.emailVerified ? 'success' : 'neutral'}>{t(u.emailVerified ? 'me.account.emailVerified' : 'me.account.emailUnverified')}</StatusPill>
        </div>
        {!u.emailVerified && canEmail && (challenge ? (
          <form onSubmit={confirm} className="space-y-3">
            <FormField label={t('me.account.emailCode')} hint={t('me.account.emailCodeSent', { sentTo: challenge.sentTo })}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={code.length !== 6} className={TOUCH}>{t('me.account.confirmEmail')}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={send} className={TOUCH}>{t('me.account.sendNewCode')}</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" icon={MailCheck} loading={busy} onClick={send} className={TOUCH}>{t('me.account.sendEmailCode')}</Button>
        ))}
        <div className="flex items-start justify-between gap-4 pt-4 border-t border-border">
          <div>
            <p className="text-sm font-medium text-ink">{t('me.account.twoStep')}</p>
            <p className="text-xs text-ink-muted mt-0.5">{t(u.twoStepRequired ? 'me.account.twoStepRequired' : 'me.account.twoStepHint')}</p>
          </div>
          <Switch checked={!!u.twoStep || !!u.twoStepRequired} disabled={busy || u.twoStepRequired || !canEmail || (!u.emailVerified && !u.twoStep)} onChange={toggle} label={t('me.account.twoStep')} />
        </div>
        {!canEmail && <p className="text-xs text-ink-faint">{t('me.account.noPlatformEmail')}</p>}
      </div>
    </SectionCard>
  )
}

function AccessPanel({ me }) {
  const { t } = useTranslation('me')
  const modules = me?.fullAccess ? me.enabledModules?.length : modulesTouched(me?.permissions ?? []).length
  const scope = me?.fullAccess ? 'ALL' : me?.dataScopes?.default
  return (
    <SectionCard icon={ShieldCheck} title={t('me.account.myAccess')} hint={t('me.account.myAccessSub')}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1.5">
          {(me?.roles ?? []).map((r) => <Tag key={r.id}>{r.name}</Tag>)}
          {!me?.roles?.length && <span className="text-sm text-ink-faint">{t('me.account.noRole')}</span>}
        </div>
        <InfoGrid>
          <Info label={t('me.account.access')} value={me?.fullAccess ? t('me.account.fullAccess') : t('me.account.permissions', { count: me?.permissions?.length ?? 0 })} />
          <Info label={t('me.account.modules')} value={String(modules ?? 0)} />
          <Info label={t('me.account.recordsYouSee')} value={scope && SCOPE_LABELS[scope] ? t(`me.account.scopes.${scope}`, { defaultValue: SCOPE_LABELS[scope] }) : t('me.account.perModule')} />
          <Info label={t('me.account.institution')} value={me?.tenant?.name} />
          <Info label={t('me.account.signInEmail')} value={me?.user?.email} />
          <Info label={t('me.account.mobile')} value={me?.user?.mobile} />
        </InfoGrid>
      </div>
    </SectionCard>
  )
}

function SessionsPanel() {
  const { t } = useTranslation('me')
  const { dateTime } = useFormat()
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const [ending, setEnding] = useState(null)
  const { data: sessions = [], isLoading } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions })
  const signOut = async (id) => {
    setEnding(id)
    try {
      await signOutSession(id)
      showSuccess(t('me.account.deviceSignedOut'))
      qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (e) {
      showError(e.message)
    } finally {
      setEnding(null)
    }
  }
  return (
    <SectionCard icon={Laptop} title={t('me.account.signedIn')} hint={isLoading ? t('ui.common.loading') : t('me.account.sessions', { count: sessions.length })}
      actions={sessions.length > 1 && <Button size="sm" variant="secondary" icon={LogOut} className={TOUCH} onClick={logoutAll}>{t('me.account.signOutEverywhere')}</Button>} flush>
      {isLoading && <div className="py-3"><SkeletonRows rows={2} /></div>}
      <ul className="divide-y divide-border">
        {sessions.map((s) => {
          const d = device(s.userAgent, t)
          const Icon = d.mobile ? Smartphone : Laptop
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-ink-muted shrink-0"><Icon className="w-4 h-4" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{d.label}</p>
                <p className="text-xs text-ink-faint truncate">{t('me.account.lastActive', { when: dateTime(s.lastUsedAt) })}{s.ip ? ` · ${s.ip}` : ''}</p>
              </div>
              {s.current
                ? <StatusPill tone="success">{t('me.account.thisDevice')}</StatusPill>
                : <Button size="sm" variant="ghost" className={TOUCH} loading={ending === s.id} onClick={() => signOut(s.id)}>{t('me.account.signOutDevice')}</Button>}
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

export default function AccountTab({ me }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <AccessPanel me={me} />
        <PasswordPanel />
      </div>
      <SignInSecurityPanel me={me} />
      <SessionsPanel />
    </div>
  )
}
