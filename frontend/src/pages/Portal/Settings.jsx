import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Printer, Smartphone } from 'lucide-react'
import { FAMILY_FEATURES } from '@schoolgiant/shared'
import { Note, PageContainer, PageHeader, Panel } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAppLink, fetchAppSettings, saveAppSettings } from '../../api/family'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

const TOGGLES = ['enabled', 'studentLogins', 'showFees', 'showMarks', 'chat']

/** App settings: switch the family app on, choose what it shows, and hand families its address. */
export default function PortalSettings() {
  const { t } = useTranslation('portal')
  const ts = useTranslation('settings').t
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { data: settings, isLoading } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings })
  const { data: link } = useQuery({ queryKey: ['app-link'], queryFn: fetchAppLink })
  const canEdit = hasPermission('portal.settings.edit')
  const enabledModules = new Set(getCurrentUser()?.enabledModules ?? [])
  const save = useMutation({
    mutationFn: (patch) => saveAppSettings(patch),
    onSuccess: (d) => { qc.setQueryData(['app-settings'], d); showSuccess(t('portal.settings.saved')) },
    onError: (e) => showError(e.message),
  })
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); showSuccess(t('portal.settings.copied')) } catch { showError(link.url) } }
  const printPoster = () => {
    const w = window.open('', '_blank', 'width=640,height=800')
    if (!w) return
    const doc = w.document
    doc.title = t('portal.poster.title')
    const box = doc.createElement('div')
    box.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:40px'
    const h = doc.createElement('h1'); h.textContent = t('portal.poster.title'); h.style.fontSize = '28px'
    const p = doc.createElement('p'); p.textContent = t('portal.poster.steps'); p.style.cssText = 'font-size:18px;line-height:1.5;max-width:480px;margin:12px auto'
    const qr = doc.createElement('div'); qr.innerHTML = link.qr // server-made SVG of the app address
    const u = doc.createElement('p'); u.textContent = link.url; u.style.cssText = 'font-family:monospace;font-size:16px;margin-top:16px'
    box.append(h, p, qr, u)
    doc.body.append(box)
    setTimeout(() => w.print(), 300)
  }

  return (
    <PageContainer>
      <PageHeader icon={Smartphone} title={t('portal.settings.title')} subtitle={t('portal.settings.subtitle')} />
      <div className="grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
        <Panel title={t('portal.settings.what')}>
          {isLoading || !settings ? <p className="text-sm text-ink-faint">{t('portal.loading')}</p> : (
            <div className="divide-y divide-border">
              {TOGGLES.map((k) => (
                <label key={k} className="flex items-start gap-3 py-3 cursor-pointer">
                  <input type="checkbox" checked={!!settings[k]} disabled={!canEdit || save.isPending || (k !== 'enabled' && !settings.enabled)}
                    onChange={(e) => save.mutate({ [k]: e.target.checked })} className="mt-1 rounded border-border text-brand-500 focus:ring-brand-500" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{ts(`settings.defs.portal.${k}.label`)}</span>
                    {ts(`settings.defs.portal.${k}.help`, { defaultValue: '' }) && <span className="block text-xs text-ink-muted">{ts(`settings.defs.portal.${k}.help`)}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('portal.settings.shows')}</p>
            <ul className="space-y-1 text-sm">
              {FAMILY_FEATURES.map((f) => {
                const on = enabledModules.has(f.module) && (!f.setting || settings?.[f.setting] !== false)
                return <li key={f.value} className={on ? 'text-ink' : 'text-ink-faint line-through'}>{t(`portal.features.${f.value}`, f.label)}{!enabledModules.has(f.module) ? ` — ${t('portal.settings.moduleOff')}` : ''}</li>
              })}
            </ul>
          </div>
          <Note className="mt-4">{t('portal.settings.signInHint')}</Note>
        </Panel>
        <Panel title={t('portal.settings.address')}>
          {link ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto w-40 [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: link.qr }} />
              <p className="font-mono-num text-xs text-ink break-all">{link.url}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>{t('portal.settings.copy')}</Button>
                <Button size="sm" variant="secondary" icon={Printer} onClick={printPoster}>{t('portal.settings.poster')}</Button>
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline px-2"><ExternalLink size={14} />{t('portal.settings.open')}</a>
              </div>
              {!settings?.enabled && <Note tone="warning">{t('portal.settings.offNote')}</Note>}
            </div>
          ) : <p className="text-sm text-ink-faint">{t('portal.loading')}</p>}
        </Panel>
      </div>
    </PageContainer>
  )
}
