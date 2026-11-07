import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Phone } from 'lucide-react'

/**
 * Renders a phone number as a tap-to-call `tel:` link. On a phone it opens the
 * dialer; on a Mac/PC the OS hands it to a paired phone (iPhone via FaceTime,
 * Android via Phone Link). Empty numbers render as a dash.
 *
 *   <PhoneLink number={lead.phone} />
 */
export default function PhoneLink({ number, className }) {
  const { t } = useTranslation('ui')
  const shown = number?.trim()
  if (!shown) return <span className="text-ink-faint">—</span>

  // Dialers want digits only, keeping a leading + for the country code.
  const dial = shown.replace(/(?!^\+)[^\d]/g, '')

  return (
    <a
      href={`tel:${dial}`}
      title={t('ui.phone.call', { number: shown })}
      dir="ltr"
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        'inline-flex items-center gap-1 font-mono-num text-brand-700 hover:text-brand-800 hover:underline whitespace-nowrap',
        className,
      )}
    >
      <Phone className="w-3 h-3 shrink-0" />
      {shown}
    </a>
  )
}
