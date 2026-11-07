import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Check } from 'lucide-react'
import { FormField, Input, Modal, SkeletonRows } from '../system'
import Button from './Button'
import { fetchOtherInstitutions, switchInstitution, verifyLoginCode } from '../../api/auth'
import { landingFor } from '../../catalog/nav'

/**
 * Move to another institution where your email has a login: pick it, enter that login's password
 * (and its emailed code if its roles ask for one). The page reloads into the new institution, so
 * nothing from this one is left on screen.
 */
export default function SwitchInstitutionModal({ open, onClose }) {
  const { t } = useTranslation('ui')
  const { data: institutions = [], isLoading } = useQuery({ queryKey: ['other-institutions'], queryFn: fetchOtherInstitutions, enabled: open })
  const [picked, setPicked] = useState(null)
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const close = () => { setPicked(null); setPassword(''); setChallenge(null); setCode(''); setError(null); onClose() }
  const go = (me) => window.location.assign(landingFor(me))
  const submit = async (e) => {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (challenge) go(await verifyLoginCode(challenge.challengeId, code.trim()))
      else {
        const res = await switchInstitution(picked, password)
        if (res.needsCode) setChallenge(res)
        else go(res)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const ready = challenge ? code.length === 6 : picked && password

  return (
    <Modal open={open} onClose={close} size="sm" title={t('ui.switchInstitution.title')}
      footer={<>
        <Button variant="secondary" onClick={close}>{t('ui.common.cancel')}</Button>
        <Button loading={busy} disabled={!ready} onClick={submit}>{t(challenge ? 'ui.switchInstitution.verify' : 'ui.switchInstitution.switch')}</Button>
      </>}>
      <form onSubmit={submit} className="space-y-4">
        {challenge ? (
          <FormField label={t('ui.switchInstitution.code')} hint={t('ui.switchInstitution.codeSent', { sentTo: challenge.sentTo })}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
          </FormField>
        ) : (
          <>
            {isLoading ? <SkeletonRows rows={2} /> : !institutions.length ? (
              <p className="text-sm text-ink-muted">{t('ui.switchInstitution.none')}</p>
            ) : (
              <ul className="space-y-2">
                {institutions.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => setPicked(h.id)} className={clsx('w-full flex items-center gap-3 p-3 rounded-lg border text-start transition', picked === h.id ? 'border-brand-500 bg-brand-50/50' : 'border-border hover:border-brand-300')}>
                      <span className="w-8 h-8 rounded-md bg-bg border border-border flex items-center justify-center shrink-0 overflow-hidden">
                        {h.logoUrl ? <img src={h.logoUrl} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 className="w-4 h-4 text-ink-faint" />}
                      </span>
                      <span className="flex-1 text-sm font-medium text-ink truncate">{h.name}</span>
                      {picked === h.id && <Check className="w-4 h-4 text-brand-600" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {picked && (
              <FormField label={t('ui.switchInstitution.password')} hint={t('ui.switchInstitution.passwordHint')}>
                <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </FormField>
            )}
          </>
        )}
        {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
