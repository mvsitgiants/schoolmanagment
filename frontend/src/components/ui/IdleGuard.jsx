import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../system'
import Button from './Button'
import { logout } from '../../api/auth'
import { setLogoutReason } from '../../api/client'
import { idleSeconds, markActive } from '../../utils/activity'

const WARN_SEC = 60

/**
 * Warns a minute before the idle sign-out and signs out when it passes. The limit comes from the
 * role (or the institution default) via /auth/me `idleMinutes`; idle time is shared by every tab, so
 * working in one keeps them all. The server enforces the same limit — this only makes it visible.
 */
export default function IdleGuard({ idleMinutes }) {
  const { t } = useTranslation('ui')
  const [left, setLeft] = useState(null) // seconds until sign-out, while warning
  const done = useRef(false)

  useEffect(() => {
    if (!idleMinutes) return undefined
    const limit = idleMinutes * 60
    const tick = () => {
      const remaining = limit - idleSeconds()
      if (remaining > 0) { setLeft(remaining <= WARN_SEC ? remaining : null); return }
      if (done.current) return
      done.current = true
      setLogoutReason(t('ui.idle.signedOut', { count: idleMinutes }))
      logout()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [idleMinutes, t])

  const stay = () => { markActive(); setLeft(null) }

  return (
    <Modal open={left !== null} onClose={stay} title={t('ui.idle.title')} size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => logout()}>{t('ui.idle.signOut')}</Button>
        <Button variant="primary" onClick={stay}>{t('ui.idle.stay')}</Button>
      </>}>
      <p className="text-sm text-ink-muted">{t('ui.idle.body', { count: left ?? WARN_SEC })}</p>
    </Modal>
  )
}
