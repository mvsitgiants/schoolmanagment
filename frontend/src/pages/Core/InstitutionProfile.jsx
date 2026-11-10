import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, Check, Palette, Trash2, Upload } from 'lucide-react'
import { FormField, Input, PageContainer, PageHeader, Panel, Select, VerifiedBadge } from '../../components/system'
import Button from '../../components/ui/Button'
import { BrandMark } from '../../components/ui/Sidebar'
import { fetchSettings, saveSettings } from '../../api/core'
import { hasPermission, syncCurrentUser } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { IMAGE_TYPES, shrinkImage } from '../../utils/shrinkImage'
import { deriveBrandRamp } from '../../utils/brandRamp'

const SWATCHES = ['#0E7C86', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#16A34A', '#0F172A']
const LOGO_MAX_BYTES = 300 * 1024 // longest side ≤ 512 px — see utils/shrinkImage

/** Upload (or paste a link to) the institution logo, with a preview. */
function LogoField({ value, onChange, disabled, error, hint, t }) {
  const input = useRef(null)
  const [problem, setProblem] = useState(null)
  const uploaded = typeof value === 'string' && value.startsWith('data:')
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) { setProblem(t('admin.institutionProfile.logoTypeError')); return }
    const data = await shrinkImage(file, { maxSide: 512, maxBytes: LOGO_MAX_BYTES }).catch(() => null)
    if (!data) { setProblem(t('admin.institutionProfile.logoTooBig')); return }
    setProblem(null)
    onChange(data)
  }
  return (
    <FormField label={t('admin.institutionProfile.logoUrl')} error={problem || error} hint={hint}>
      <div className="flex items-center gap-3">
        <span className="w-14 h-14 shrink-0 rounded-lg border border-border bg-bg flex items-center justify-center overflow-hidden">
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 className="w-5 h-5 text-ink-faint" />}
        </span>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={pick} />
          <Button size="sm" variant="secondary" icon={Upload} disabled={disabled} onClick={() => input.current?.click()}>
            {value ? t('admin.institutionProfile.replaceLogo') : t('admin.institutionProfile.uploadLogo')}
          </Button>
          {value && <Button size="sm" variant="ghost" icon={Trash2} disabled={disabled} onClick={() => { setProblem(null); onChange('') }}>{t('admin.institutionProfile.removeLogo')}</Button>}
        </div>
      </div>
      <Input
        className="mt-2"
        value={uploaded ? '' : value ?? ''}
        placeholder={uploaded ? t('admin.institutionProfile.logoUploaded') : t('admin.institutionProfile.logoOrLink')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </FormField>
  )
}

// Menu colours: three deep shades of the brand colour (so the menu always belongs to it — the
// active-item highlights are lighter brand tints, which need a dark ground), plus neutrals.
const NEUTRAL_SIDEBARS = ['#0B1220', '#1F2937', '#FFFFFF']
const BRAND_SIDEBAR_STOPS = ['900', '800', '700']
const toHex = (rgb) => '#' + rgb.split(' ').map((c) => Number(c).toString(16).padStart(2, '0')).join('').toUpperCase()
const brandSidebars = (primary) => {
  const ramp = deriveBrandRamp(primary || '#0E7C86')
  return ramp ? BRAND_SIDEBAR_STOPS.map((s) => toHex(ramp[s])) : []
}
const sameColour = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

export default function InstitutionProfile() {
  const { t } = useTranslation('admin')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings })
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const { showSuccess, showError } = useSnackbar()
  const canEdit = hasPermission('core.profile.edit')

  useEffect(() => { if (data && !form) setForm(data) }, [data, form])

  const save = useMutation({
    mutationFn: () => {
      const { id, slug, verification, ...body } = form
      return saveSettings(body)
    },
    // Write the saved profile back to the cache too — `dirty` compares against it, and a stale copy
    // left the old colour there, so picking it again after a save looked unchanged and Save stayed off.
    onSuccess: async (d) => { qc.setQueryData(['settings'], d); setForm(d); setErrors({}); await syncCurrentUser(); showSuccess(t('admin.institutionProfile.saved')) },
    onError: (e) => { setErrors(e.response?.data?.details?.fields ?? {}); showError(e.message) },
  })

  if (isLoading || !form) return <PageContainer><div className="h-96 rounded-xl bg-black/5 animate-pulse" /></PageContainer>
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  // A menu shade taken from the brand colour follows it when the brand colour changes.
  const setPrimary = (c) => setForm((f) => {
    const i = brandSidebars(f.primaryColor).findIndex((x) => sameColour(x, f.sidebarColor))
    return { ...f, primaryColor: c, ...(i >= 0 && { sidebarColor: brandSidebars(c)[i] }) }
  })
  const menuSwatch = (c) => (
    <button key={c} type="button" disabled={!canEdit} onClick={() => set('sidebarColor')(c)} className="w-7 h-7 rounded-md border-2 transition" style={{ background: c, borderColor: sameColour(form.sidebarColor || '#0B1220', c) ? accent : '#E4E7EC' }} aria-label={c} />
  )
  const dirty = JSON.stringify(form) !== JSON.stringify(data)
  // the shade the app actually uses — a very light pick is darkened so white text stays readable
  const accent = `rgb(${(deriveBrandRamp(form.primaryColor || '#0E7C86') ?? { 500: '14 124 134' })[500]})`
  const field = (k, label, { hint, ...props } = {}) => (
    <FormField label={label} error={errors[k]} hint={hint}>
      <Input value={form[k] ?? ''} onChange={set(k)} disabled={!canEdit} {...props} />
    </FormField>
  )

  return (
    <PageContainer>
      <PageHeader icon={Building2} title={t('admin.institutionProfile.title')} subtitle={t('admin.institutionProfile.subtitle')}
        actions={canEdit && <Button icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('admin.institutionProfile.saveChanges')}</Button>} />
      <div className="grid xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 space-y-6">
          <Panel title={t('admin.institutionProfile.identity')}
            subtitle={data.verification ? t('admin.institutionProfile.verifiedHint') : t('admin.institutionProfile.notVerifiedHint')}
            actions={data.verification && <VerifiedBadge label={t('admin.institutionProfile.verified')} title={t('admin.institutionProfile.verifiedHint')} />}>
            <div className="grid sm:grid-cols-2 gap-4">
              {field('name', t('admin.institutionProfile.fields.name'))}
              {field('legalName', t('admin.institutionProfile.fields.legalName'))}
              {field('registrationNo', t('admin.institutionProfile.fields.registrationNo'))}
              {field('affiliationNo', t('admin.institutionProfile.fields.affiliationNo'))}
              {field('udiseCode', t('admin.institutionProfile.fields.udiseCode'))}
              {field('board', t('admin.institutionProfile.fields.board'), { hint: t('admin.institutionProfile.fields.boardHint') })}
              {field('schoolCode', t('admin.institutionProfile.fields.schoolCode'), { hint: t('admin.institutionProfile.fields.schoolCodeHint') })}
              {field('trustName', t('admin.institutionProfile.fields.trustName'), { hint: t('admin.institutionProfile.fields.trustNameHint') })}
              {field('reg80G', t('admin.institutionProfile.fields.reg80G'), { hint: t('admin.institutionProfile.fields.reg80GHint') })}
              {field('gstin', 'GSTIN', { maxLength: 15 })}
              {field('pan', 'PAN', { maxLength: 10 })}
            </div>
          </Panel>
          <Panel title={t('admin.institutionProfile.contact')}>
            <div className="grid sm:grid-cols-2 gap-4">
              {field('phone', t('admin.institutionProfile.fields.phone'))}
              {field('email', t('admin.institutionProfile.fields.email'))}
              {field('website', t('admin.institutionProfile.fields.website'))}
              <div className="sm:col-span-2">{field('addressLine', t('admin.institutionProfile.fields.address'))}</div>
              {field('city', t('admin.institutionProfile.fields.city'))}
              {field('state', t('admin.institutionProfile.fields.state'))}
              {field('pincode', t('admin.institutionProfile.fields.pincode'))}
              {field('country', t('admin.institutionProfile.fields.country'))}
            </div>
          </Panel>
          <Panel title={t('admin.institutionProfile.regional')}>
            <div className="grid sm:grid-cols-3 gap-4">
              <FormField label={t('admin.institutionProfile.dateFormat')}><Select value={form.dateFormat} disabled={!canEdit} onChange={set('dateFormat')}>{['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => <option key={f}>{f}</option>)}</Select></FormField>
              <FormField label={t('admin.institutionProfile.timezone')}><Select value={form.timezone} disabled={!canEdit} onChange={set('timezone')}>{['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kathmandu', 'Asia/Dhaka', 'Africa/Nairobi', 'Europe/London'].map((z) => <option key={z}>{z}</option>)}</Select></FormField>
              <FormField label={t('admin.institutionProfile.currency')}><Select value={form.currency} disabled={!canEdit} onChange={set('currency')}>{['INR', 'AED', 'SGD', 'NPR', 'BDT', 'KES', 'USD'].map((c) => <option key={c}>{c}</option>)}</Select></FormField>
            </div>
          </Panel>
        </div>

        <Panel title={t('admin.institutionProfile.branding')} actions={<Palette className="w-4 h-4 text-ink-faint" />}>
          <div className="space-y-4">
            <LogoField value={form.logoUrl} onChange={set('logoUrl')} disabled={!canEdit} error={errors.logoUrl} hint={t('admin.institutionProfile.logoHint')} t={t} />
            <FormField label={t('admin.institutionProfile.brandColour')}>
              <div className="flex flex-wrap gap-2 items-center">
                {SWATCHES.map((c) => <button key={c} type="button" disabled={!canEdit} onClick={() => setPrimary(c)} className="w-7 h-7 rounded-full border-2 transition" style={{ background: c, borderColor: (form.primaryColor || '#0E7C86').toLowerCase() === c.toLowerCase() ? '#12141C' : 'transparent' }} aria-label={c} />)}
                <input type="color" disabled={!canEdit} value={form.primaryColor || '#0E7C86'} onChange={(e) => setPrimary(e.target.value)} className="w-9 h-8 rounded cursor-pointer border border-border" aria-label={t('admin.institutionProfile.customColour')} />
              </div>
            </FormField>
            <FormField label={t('admin.institutionProfile.menuColour')}>
              <div className="flex flex-wrap gap-2 items-center">
                {brandSidebars(form.primaryColor).map(menuSwatch)}
                <span className="w-px h-6 bg-border mx-1" aria-hidden />
                {NEUTRAL_SIDEBARS.map(menuSwatch)}
                <input type="color" disabled={!canEdit} value={form.sidebarColor || '#0B1220'} onChange={(e) => set('sidebarColor')(e.target.value.toUpperCase())} className="w-9 h-8 rounded cursor-pointer border border-border" aria-label={t('admin.institutionProfile.customColour')} />
              </div>
              <p className="text-xs text-ink-faint mt-1">{t('admin.institutionProfile.menuColourHint', 'The first three are shades of your brand colour and follow it when it changes.')}</p>
            </FormField>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{t('admin.institutionProfile.preview')}</p>
              <div className="rounded-lg overflow-hidden border border-border flex h-32">
                <div className="w-28 p-2.5 space-y-2" style={{ background: form.sidebarColor || '#0B1220' }}>
                  <div className="flex items-center gap-1.5"><BrandMark brand={{ companyName: form.name || 'H', logoUrl: form.logoUrl }} size="h-6 w-6" /></div>
                  {[0, 1, 2].map((i) => <div key={i} className="h-2 rounded" style={{ background: i === 0 ? accent : 'rgba(255,255,255,0.15)', width: `${80 - i * 15}%` }} />)}
                </div>
                <div className="flex-1 bg-bg p-3 space-y-2">
                  <div className="h-2.5 w-24 rounded bg-ink/70" />
                  <div className="h-2 w-32 rounded bg-black/10" />
                  <span className="inline-block mt-2 text-[10px] px-2 py-1 rounded text-white" style={{ background: accent }}>{t('admin.institutionProfile.primaryButton')}</span>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-border bg-white p-3">
                <div className="flex items-center gap-2 pb-2 border-b-2" style={{ borderColor: accent }}>
                  <BrandMark brand={{ companyName: form.name || 'H', logoUrl: form.logoUrl }} size="h-7 w-7" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink truncate">{form.legalName || form.name}</p>
                    <p className="text-[10px] text-ink-muted truncate">{[form.addressLine, form.city].filter(Boolean).join(', ') || t('admin.institutionProfile.fields.address')} · {form.phone || t('admin.institutionProfile.fields.phone')}</p>
                  </div>
                </div>
                <p className="text-[10px] text-ink-faint mt-1.5">{t('admin.institutionProfile.letterhead')}</p>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </PageContainer>
  )
}
