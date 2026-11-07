import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import Button from '../components/ui/Button'

export default function NotFound() {
  const { t } = useTranslation('common')
  return (
    <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center gap-3 px-4">
      <span className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center"><Compass className="w-5 h-5 text-ink-faint" /></span>
      <p className="font-display text-xl font-semibold text-ink">{t('notFound.title', { defaultValue: 'Page not found' })}</p>
      <p className="text-sm text-ink-muted max-w-sm">{t('notFound.description', { defaultValue: 'The link may be old, or the page moved. Use the menu or search ( / ) to find what you need.' })}</p>
      <Button to="/" variant="secondary">{t('notFound.goHome', { defaultValue: 'Go home' })}</Button>
    </div>
  )
}
