import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Modal, Note } from '../system'
import { fetchPunchCode } from '../../api/scan'
import QrCode from './QrCode'

const REFRESH_MS = 30_000 // a new code twice a minute; each is good for 90 seconds, so a photo of it soon stops working

/** My workspace › the staff member's own attendance code, shown at a staff gate scanner instead of a card. */
export default function PunchCodeModal({ onClose }) {
  const { t } = useTranslation('scan')
  const { data, error, dataUpdatedAt } = useQuery({ queryKey: ['punch-code'], queryFn: fetchPunchCode, refetchInterval: REFRESH_MS, gcTime: 0, staleTime: 0, retry: false })
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  const left = Math.max(0, Math.ceil((dataUpdatedAt + REFRESH_MS - now) / 1000))
  return (
    <Modal open onClose={onClose} size="sm" title={t('scan.punch.title')}>
      {error ? <Note tone="warning">{error.message}</Note> : (
        <div className="flex flex-col items-center gap-3 text-center">
          <QrCode value={data?.code} size={240} label={t('scan.punch.title')} className="rounded-xl bg-white p-2 border border-border" />
          {data && <p className="text-xs text-ink-faint tabular-nums">{t('scan.punch.refreshesIn', { s: left })}</p>}
          <p className="text-sm text-ink-muted">{t('scan.punch.hint')}</p>
        </div>
      )}
    </Modal>
  )
}
