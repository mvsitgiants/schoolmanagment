import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Printer, Smartphone } from 'lucide-react'
import { FAMILY_FEATURES, FAMILY_PROFILE_FIELDS } from '@schoolgiant/shared'
import { Note, PageContainer, PageHeader, Panel, SegmentedControl } from '../../components/system'
import Button from '../../components/ui/Button'
import { fetchAppLink, fetchAppSettings, saveAppSettings } from '../../api/family'
import { getCurrentUser, hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'

// sign-in; what each section shows is set below, section by section
const TOGGLES = ['enabled', 'studentLogins']

/** A section's place: everyone, parents only, or hidden. Fees, marks and chat keep their own on/off setting. */
function accessOf(f, s) {
  if ((f.setting && s?.[f.setting] === false) || (s?.hiddenSections ?? []).includes(f.value)) return 'HIDDEN'
  return (s?.parentOnlySections ?? []).includes(f.value) ? 'PARENTS' : 'ALL'
}
function accessPatch(f, s, to) {
  const hidden = new Set(s.hiddenSections ?? [])
  const parents = new Set(s.parentOnlySections ?? [])
  hidden.delete(f.value)
  parents.delete(f.value)
  if (to === 'PARENTS') parents.add(f.value)
  if (to === 'HIDDEN' && !f.setting) hidden.add(f.value)
  return { hiddenSections: [...hidden], parentOnlySections: [...parents], ...(f.setting && { [f.setting]: to !== 'HIDDEN' }) }
}

/** Section by section: who sees it in the app (parents and students, parents only, nobody). */
function SectionsPanel({ settings, canEdit, save, enabledModules }) {
  const { t } = useTranslation('portal')
  const off = !settings.enabled
  const opts = [
    { value: 'ALL', label: settings.studentLogins ? t('portal.access.all') : t('portal.access.shown') },
    ...(settings.studentLogins ? [{ value: 'PARENTS', label: t('portal.access.parents') }] : []),
    { value: 'HIDDEN', label: t('portal.access.hidden') },
  ]
  return (
    <Panel title={t('portal.access.title')} subtitle={t('portal.access.hint')} flush>
      <ul className="divide-y divide-border">
        {FAMILY_FEATURES.map((f) => {
          const moduleOn = enabledModules.has(f.module)
          const cur = accessOf(f, settings)
          return (
            <li key={f.value} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className={`block text-sm ${moduleOn ? 'text-ink' : 'text-ink-faint'}`}>{t(`portal.features.${f.value}`, f.label)}</span>
                {!moduleOn && <span className="block text-[11px] text-ink-faint">{t('portal.settings.moduleOff')}</span>}
              </span>
              {moduleOn && (
                <SegmentedControl value={cur === 'PARENTS' && !settings.studentLogins ? 'ALL' : cur} options={opts}
                  onChange={(to) => { if (canEdit && !off && to !== cur) save.mutate(accessPatch(f, settings, to)) }} />
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** The child's details on the app's profile, and staff phone numbers. */
function DetailsPanel({ settings, canEdit, save }) {
  const { t } = useTranslation('portal')
  const shown = new Set(settings.profileFields ?? FAMILY_PROFILE_FIELDS.map((f) => f.value))
  const toggle = (v, on) => { const next = new Set(shown); if (on) next.add(v); else next.delete(v); save.mutate({ profileFields: FAMILY_PROFILE_FIELDS.map((f) => f.value).filter((x) => next.has(x)) }) }
  const box = 'mt-0.5 rounded border-border text-brand-500 focus:ring-brand-500'
  return (
    <Panel title={t('portal.details.title')} subtitle={t('portal.details.hint')}>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {FAMILY_PROFILE_FIELDS.map((f) => (
          <label key={f.value} className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
            <input type="checkbox" className={box} checked={shown.has(f.value)} disabled={!canEdit || save.isPending || (f.value === 'GUARDIAN_MOBILE' && !shown.has('GUARDIANS'))} onChange={(e) => toggle(f.value, e.target.checked)} />
            {t(`portal.details.fields.${f.value}`, f.label)}
          </label>
        ))}
      </div>
      <label className="mt-4 pt-3 border-t border-border flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" className={box} checked={settings.staffPhones !== false} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate({ staffPhones: e.target.checked })} />
        <span>
          <span className="block text-sm text-ink">{t('portal.details.staffPhones')}</span>
          <span className="block text-xs text-ink-muted">{t('portal.details.staffPhonesHint')}</span>
        </span>
      </label>
    </Panel>
  )
}

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
        <div className="space-y-4 min-w-0">
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
          <Note className="mt-4">{t('portal.settings.signInHint')}</Note>
        </Panel>
        {settings && <SectionsPanel settings={settings} canEdit={canEdit} save={save} enabledModules={enabledModules} />}
        {settings && <DetailsPanel settings={settings} canEdit={canEdit} save={save} />}
        </div>
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
