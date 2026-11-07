import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Copy, CreditCard, Mail, Megaphone, MessageSquareText, PlugZap, Radio, Send, Settings2, ShieldCheck, UserPlus } from 'lucide-react'
import { FormField, Input, Note, PageContainer, PageHeader, Panel, SegmentedControl, StatusPill, Textarea } from '../../components/system'
import Button from '../../components/ui/Button'
import { Switch } from '../../components/app/Controls'
import { fetchPlatformSettings, registerPlatformAbdmBridge, savePlatformSettings, sendPlatformTestEmail, sendPlatformTestSms, testPlatformAbdm } from '../../api/superadmin'
import { getCurrentUser } from '../../api/auth'
import { apiUrl } from '../../api/client'
import { useSnackbar } from '../../context/SnackbarContext'

const COMPANY = ['name', 'legalName', 'gstin', 'stateCode', 'address', 'supportEmail', 'supportPhone']
const EMAIL = ['host', 'port', 'secure', 'user', 'pass', 'fromName', 'fromEmail', 'replyTo']
const RAZORPAY = ['keyId', 'keySecret', 'webhookSecret']
const ABDM = ['mode', 'clientId', 'clientSecret', 'cmId']
const SMS = ['provider', 'senderId', 'authKey', 'route', 'otpTemplateId', 'otpText']
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? (k === 'secure' ? false : k === 'port' ? null : k === 'provider' ? 'NONE' : '')]))

/** One settings section with its own Save: tracks its fields, saves only them, shows field errors. */
function useSection(data, section, keys) {
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { t } = useTranslation('superadmin')
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const saved = data ? pick(data[section], keys) : null
  // reset to what is saved only when this section's saved values change, so saving another
  // section never wipes unsaved edits here
  const savedKey = JSON.stringify(saved)
  useEffect(() => { if (savedKey !== 'null') setForm(JSON.parse(savedKey)) }, [savedKey])
  const save = useMutation({
    mutationFn: () => savePlatformSettings({ [section]: form }),
    onSuccess: (next) => { setErrors({}); qc.setQueryData(['sa-settings'], next); showSuccess(t('superadmin.settings.saved')) },
    onError: (e) => {
      const fields = e.response?.data?.details?.fields ?? {}
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(`${section}.`, ''), v])))
      showError(e.message)
    },
  })
  const dirty = !!form && JSON.stringify(form) !== savedKey
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  return { form, set, errors, save, dirty }
}

function CompanyPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const { form, set, errors, save, dirty } = useSection(data, 'company', COMPANY)
  if (!form) return null
  const field = (k, props = {}) => (
    <FormField label={t(`superadmin.settings.company.${k}`)} error={errors[k]}>
      <Input value={form[k]} onChange={set(k)} {...props} />
    </FormField>
  )
  return (
    <Panel icon={Building2} title={t('superadmin.settings.company.title')} subtitle={t('superadmin.settings.company.subtitle')}
      actions={<Button size="sm" icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {field('name')}
        {field('legalName')}
        {field('gstin', { maxLength: 15 })}
        {field('stateCode', { maxLength: 2, inputMode: 'numeric' })}
        <div className="sm:col-span-2">
          <FormField label={t('superadmin.settings.company.address')} error={errors.address}>
            <Textarea rows={2} value={form.address} onChange={set('address')} />
          </FormField>
        </div>
        {field('supportEmail', { type: 'email' })}
        {field('supportPhone', { inputMode: 'tel' })}
      </div>
    </Panel>
  )
}

function EmailPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { form, set, errors, save, dirty } = useSection(data, 'email', EMAIL)
  const [to, setTo] = useState(() => getCurrentUser()?.user?.email ?? '')
  const test = useMutation({
    mutationFn: () => sendPlatformTestEmail(to),
    onSuccess: (next) => { qc.setQueryData(['sa-settings'], next); showSuccess(t('superadmin.settings.email.testSent', { to })) },
    onError: (e) => showError(e.message),
  })
  if (!form) return null
  const configured = !!(data.email?.host && data.email?.fromEmail)
  const status = data.emailReady
    ? <StatusPill tone="success">{t('superadmin.settings.email.working')}</StatusPill>
    : <StatusPill tone={configured ? 'warning' : 'neutral'}>{t(configured ? 'superadmin.settings.email.untested' : 'superadmin.settings.email.notSet')}</StatusPill>
  const field = (k, props = {}) => (
    <FormField label={t(`superadmin.settings.email.${k}`)} error={errors[k]}>
      <Input value={form[k] ?? ''} onChange={set(k)} {...props} />
    </FormField>
  )
  return (
    <Panel icon={Mail} title={t('superadmin.settings.email.title')} subtitle={t('superadmin.settings.email.subtitle')}
      actions={<>{status}<Button size="sm" icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        {field('host', { placeholder: 'smtp.example.com' })}
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <FormField label={t('superadmin.settings.email.port')} error={errors.port}>
            <Input type="number" inputMode="numeric" value={form.port ?? ''} placeholder={form.secure ? '465' : '587'} onChange={(e) => set('port')(e.target.value ? Number(e.target.value) : null)} />
          </FormField>
          <label className="flex items-center gap-2 h-10 text-sm text-ink">
            <Switch checked={!!form.secure} onChange={set('secure')} label={t('superadmin.settings.email.secure')} /> {t('superadmin.settings.email.secure')}
          </label>
        </div>
        {field('user', { autoComplete: 'off' })}
        {field('pass', { type: 'password', autoComplete: 'new-password', placeholder: data.email?.passSet ? t('superadmin.settings.email.passKept') : '' })}
        {field('fromName', { placeholder: data.company?.name || '' })}
        {field('fromEmail', { type: 'email' })}
        {field('replyTo', { type: 'email' })}
      </div>
      <div className="mt-5 pt-4 border-t border-border">
        <p className="text-sm font-medium text-ink">{t('superadmin.settings.email.testTitle')}</p>
        <p className="text-xs text-ink-muted mt-0.5">{t(dirty ? 'superadmin.settings.email.saveFirst' : 'superadmin.settings.email.testHint')}</p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <Input type="email" className="sm:flex-1" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('superadmin.settings.email.testTo')} />
          <Button variant="secondary" icon={Send} loading={test.isPending} disabled={dirty || !configured || !to} onClick={() => test.mutate()}>{t('superadmin.settings.email.sendTest')}</Button>
        </div>
      </div>
    </Panel>
  )
}

/**
 * The platform's SMS account: one-time codes (portal sign-in, online booking, the kiosk) for
 * institutions that haven't connected their own. MSG91 with a DLT-registered code template.
 */
function SmsPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { form, set, errors, save, dirty } = useSection(data, 'sms', SMS)
  const [to, setTo] = useState('')
  const test = useMutation({
    mutationFn: () => sendPlatformTestSms(to),
    onSuccess: (next) => { qc.setQueryData(['sa-settings'], next); showSuccess(t('superadmin.settings.sms.testSent', 'Test SMS sent to {{to}}.', { to })) },
    onError: (e) => showError(e.message),
  })
  if (!form) return null
  const saved = data.sms ?? {}
  const status = data.smsReady
    ? <StatusPill tone="success">{t(saved.provider === 'TEST' ? 'superadmin.settings.sms.testMode' : 'superadmin.settings.email.working', saved.provider === 'TEST' ? 'Test mode' : undefined)}</StatusPill>
    : <StatusPill tone={saved.provider && saved.provider !== 'NONE' ? 'warning' : 'neutral'}>{t(saved.provider && saved.provider !== 'NONE' ? 'superadmin.settings.email.untested' : 'superadmin.settings.email.notSet')}</StatusPill>
  const providers = [
    { value: 'NONE', label: t('superadmin.settings.sms.none', 'Not set') },
    { value: 'MSG91', label: 'MSG91' },
    ...(data.testModeAllowed || form.provider === 'TEST' ? [{ value: 'TEST', label: t('superadmin.settings.sms.test', 'Test (nothing sent)') }] : []),
  ]
  return (
    <Panel icon={MessageSquareText} title={t('superadmin.settings.sms.title', 'Text messages (SMS)')}
      subtitle={t('superadmin.settings.sms.subtitle', 'Sends one-time codes — patient portal sign-in, online booking, the check-in kiosk — for institutions that haven’t connected their own SMS account. An institution’s own account always comes first.')}
      actions={<>{status}<Button size="sm" icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button></>}>
      <SegmentedControl value={form.provider} onChange={set('provider')} options={providers} />
      {form.provider === 'TEST' && <Note tone="info" className="mt-4">{t('superadmin.settings.sms.testNote', 'Test mode: nothing leaves the server and the code shows on the patient’s screen. Not available in production.')}</Note>}
      {form.provider === 'MSG91' && (
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <FormField label={t('superadmin.settings.sms.authKey', 'MSG91 auth key')} error={errors.authKey}>
            <Input type="password" autoComplete="new-password" value={form.authKey} onChange={set('authKey')} placeholder={saved.authKeySet ? t('superadmin.settings.email.passKept') : ''} />
          </FormField>
          <FormField label={t('superadmin.settings.sms.senderId', 'Sender id')} error={errors.senderId} hint={t('superadmin.settings.sms.senderHint', 'Six letters, as approved on DLT')}>
            <Input value={form.senderId} onChange={(e) => set('senderId')(e.target.value.toUpperCase())} maxLength={6} placeholder="HSAMDN" autoComplete="off" />
          </FormField>
          <FormField label={t('superadmin.settings.sms.templateId', 'DLT template id for the code')} error={errors.otpTemplateId}>
            <Input inputMode="numeric" value={form.otpTemplateId} onChange={set('otpTemplateId')} autoComplete="off" />
          </FormField>
          <FormField label={t('superadmin.settings.sms.route', 'Route')} error={errors.route} hint={t('superadmin.settings.sms.routeHint', '4 = transactional (the usual one)')}>
            <Input value={form.route} onChange={set('route')} placeholder="4" maxLength={10} />
          </FormField>
        </div>
      )}
      {form.provider !== 'NONE' && (
        <div className="mt-4">
          <FormField label={t('superadmin.settings.sms.text', 'Code message')} error={errors.otpText}
            hint={t('superadmin.settings.sms.textHint', 'Must match the DLT template word for word. {{code}}, {{institution}} and {{minutes}} are filled in. Empty: the standard text below.')}>
            <Textarea rows={2} value={form.otpText} onChange={set('otpText')} placeholder={saved.defaultText} />
          </FormField>
        </div>
      )}
      {form.provider !== 'NONE' && (
        <div className="mt-5 pt-4 border-t border-border">
          <p className="text-sm font-medium text-ink">{t('superadmin.settings.sms.testTitle', 'Send a test SMS')}</p>
          <p className="text-xs text-ink-muted mt-0.5">{dirty ? t('superadmin.settings.email.saveFirst') : t('superadmin.settings.sms.testHint', 'Sends a sample code with the saved settings. Institutions use platform SMS once a test has gone through.')}</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <Input type="tel" inputMode="numeric" className="sm:flex-1" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('superadmin.settings.sms.testTo', 'Mobile number')} aria-label={t('superadmin.settings.sms.testTo', 'Mobile number')} />
            <Button variant="secondary" icon={Send} loading={test.isPending} disabled={dirty || to.replace(/\D/g, '').length < 10} onClick={() => test.mutate()}>{t('superadmin.settings.email.sendTest')}</Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function PaymentsPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const { showSuccess } = useSnackbar()
  const { form, set, errors, save, dirty } = useSection(data, 'razorpay', RAZORPAY)
  if (!form) return null
  // where Razorpay sends payment events (Dashboard › Webhooks): order.paid, payment.captured, payment_link.paid
  const hook = new URL(apiUrl('/v1/hooks/platform/razorpay'), window.location.origin).href
  const copy = async () => { try { await navigator.clipboard.writeText(hook); showSuccess(t('superadmin.settings.payments.copied')) } catch { /* no clipboard access */ } }
  return (
    <Panel icon={CreditCard} title={t('superadmin.settings.payments.title')} subtitle={t('superadmin.settings.payments.subtitle')}
      actions={<><StatusPill tone={data.paymentsReady ? 'success' : 'neutral'}>{t(data.paymentsReady ? 'superadmin.settings.payments.ready' : 'superadmin.settings.email.notSet')}</StatusPill><Button size="sm" icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label={t('superadmin.settings.payments.keyId')} error={errors.keyId}>
          <Input value={form.keyId} onChange={set('keyId')} placeholder="rzp_live_…" autoComplete="off" />
        </FormField>
        <FormField label={t('superadmin.settings.payments.keySecret')} error={errors.keySecret}>
          <Input type="password" autoComplete="new-password" value={form.keySecret} onChange={set('keySecret')} placeholder={data.razorpay?.keySecretSet ? t('superadmin.settings.email.passKept') : ''} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={t('superadmin.settings.payments.webhookSecret')} error={errors.webhookSecret} hint={t('superadmin.settings.payments.webhookHint')}>
            <Input type="password" autoComplete="new-password" value={form.webhookSecret} onChange={set('webhookSecret')} placeholder={data.razorpay?.webhookSecretSet ? t('superadmin.settings.email.passKept') : ''} />
          </FormField>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-2 flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-xs text-ink-muted">{hook}</code>
        <Button size="sm" variant="ghost" icon={Copy} onClick={copy}>{t('superadmin.settings.payments.copy')}</Button>
      </div>
    </Panel>
  )
}

/** The platform's ABDM integrator account: every institution links its facility (HIP id) under it. */
function AbdmPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const { form, set, errors, save, dirty } = useSection(data, 'abdm', ABDM)
  const [result, setResult] = useState(null)
  const test = useMutation({
    mutationFn: testPlatformAbdm,
    onSuccess: (r) => { setResult(r); qc.setQueryData(['sa-settings'], r.settings) },
    onError: (e) => showError(e.message),
  })
  const bridge = useMutation({
    mutationFn: registerPlatformAbdmBridge,
    onSuccess: () => showSuccess(t('superadmin.settings.abdm.registered')),
    onError: (e) => showError(e.message),
  })
  if (!form) return null
  // where ABDM sends link tokens and link results, for every institution
  const hook = new URL(apiUrl('/v1/hooks/abdm'), window.location.origin).href
  const copy = async () => { try { await navigator.clipboard.writeText(hook); showSuccess(t('superadmin.settings.payments.copied')) } catch { /* no clipboard access */ } }
  const configured = !!(data.abdm?.clientId && data.abdm?.clientSecretSet)
  const status = data.abdm?.verifiedAt
    ? <StatusPill tone="success">{t('superadmin.settings.abdm.connected')}</StatusPill>
    : <StatusPill tone={configured ? 'warning' : 'neutral'}>{t(configured ? 'superadmin.settings.email.untested' : 'superadmin.settings.email.notSet')}</StatusPill>
  return (
    <Panel icon={ShieldCheck} title={t('superadmin.settings.abdm.title')} subtitle={t('superadmin.settings.abdm.subtitle')}
      actions={<>{status}<Button size="sm" icon={Check} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button></>}>
      <div className="space-y-4">
        <SegmentedControl options={[{ value: 'SANDBOX', label: t('superadmin.settings.abdm.sandbox') }, { value: 'LIVE', label: t('superadmin.settings.abdm.live') }]} value={form.mode || 'SANDBOX'} onChange={set('mode')} />
        {form.mode === 'LIVE' && <Note tone="warning">{t('superadmin.settings.abdm.liveWarning')}</Note>}
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('superadmin.settings.abdm.clientId')} error={errors.clientId}>
            <Input value={form.clientId} onChange={set('clientId')} placeholder="SBX_…" autoComplete="off" />
          </FormField>
          <FormField label={t('superadmin.settings.abdm.clientSecret')} error={errors.clientSecret}>
            <Input type="password" autoComplete="new-password" value={form.clientSecret} onChange={set('clientSecret')} placeholder={data.abdm?.clientSecretSet ? t('superadmin.settings.email.passKept') : ''} />
          </FormField>
          <FormField label={t('superadmin.settings.abdm.cmId')} hint={t('superadmin.settings.abdm.cmIdHint')} error={errors.cmId}>
            <Input value={form.cmId} onChange={set('cmId')} placeholder={form.mode === 'LIVE' ? 'abdm' : 'sbx'} autoComplete="off" />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={PlugZap} loading={test.isPending} disabled={dirty || !configured} title={dirty ? t('superadmin.settings.email.saveFirst') : undefined} onClick={() => test.mutate()}>{t('superadmin.settings.abdm.test')}</Button>
        </div>
        {result && <Note tone={result.ok ? 'success' : 'danger'}>{result.message}</Note>}
      </div>
      <div className="mt-5 pt-4 border-t border-border">
        <p className="text-sm font-medium text-ink">{t('superadmin.settings.abdm.callbackTitle')}</p>
        <p className="text-xs text-ink-muted mt-0.5">{t('superadmin.settings.abdm.callbackHint')}</p>
        <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-xs text-ink-muted">{hook}</code>
          <Button size="sm" variant="ghost" icon={Copy} onClick={copy}>{t('superadmin.settings.payments.copy')}</Button>
        </div>
        <Button size="sm" variant="secondary" icon={Radio} className="mt-3" loading={bridge.isPending} disabled={dirty || !configured} onClick={() => bridge.mutate()}>{t('superadmin.settings.abdm.register')}</Button>
      </div>
    </Panel>
  )
}

/** ISO time → the value a datetime-local field shows (in this browser's time zone). */
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(+d - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }

/** The banner on the sign-in page and every signed-in screen (planned maintenance, news). */
function NoticePanel({ data }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showSuccess, showError } = useSnackbar()
  const saved = { message: data.notice?.message ?? '', tone: data.notice?.tone ?? 'info', active: !!data.notice?.active, until: localInput(data.notice?.until) }
  const savedKey = JSON.stringify(saved)
  const [form, setForm] = useState(saved)
  useEffect(() => { setForm(JSON.parse(savedKey)) }, [savedKey])
  const save = useMutation({
    mutationFn: () => savePlatformSettings({ notice: { ...form, until: form.until ? new Date(form.until).toISOString() : null } }),
    onSuccess: (next) => { qc.setQueryData(['sa-settings'], next); qc.invalidateQueries({ queryKey: ['platform-notice'] }); showSuccess(t('superadmin.settings.saved')) },
    onError: (e) => showError(e.message),
  })
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
  return (
    <Panel icon={Megaphone} title={t('superadmin.settings.notice.title')} subtitle={t('superadmin.settings.notice.subtitle')}
      actions={<><StatusPill tone={data.notice?.active ? 'warning' : 'neutral'}>{t(data.notice?.active ? 'superadmin.settings.notice.showing' : 'superadmin.settings.notice.off')}</StatusPill><Button size="sm" icon={Check} loading={save.isPending} disabled={JSON.stringify(form) === savedKey || (form.active && !form.message.trim())} onClick={() => save.mutate()}>{t('superadmin.settings.save')}</Button></>}>
      <div className="space-y-4">
        <FormField label={t('superadmin.settings.notice.message')} hint={t('superadmin.settings.notice.messageHint')}>
          <Textarea rows={2} maxLength={300} value={form.message} onChange={set('message')} placeholder={t('superadmin.settings.notice.placeholder')} />
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label={t('superadmin.settings.notice.tone')}>
            <SegmentedControl options={[{ value: 'info', label: t('superadmin.settings.notice.info') }, { value: 'warning', label: t('superadmin.settings.notice.warning') }]} value={form.tone} onChange={set('tone')} />
          </FormField>
          <FormField label={t('superadmin.settings.notice.until')} hint={t('superadmin.settings.notice.untilHint')}>
            <Input type="datetime-local" value={form.until} onChange={set('until')} />
          </FormField>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 h-10 text-sm text-ink">{t('superadmin.settings.notice.show')} <Switch checked={form.active} onChange={set('active')} label={t('superadmin.settings.notice.show')} /></label>
      </div>
    </Panel>
  )
}

function SignupPanel({ data }) {
  const { t } = useTranslation('superadmin')
  const qc = useQueryClient()
  const { showError } = useSnackbar()
  const toggle = useMutation({
    mutationFn: (on) => savePlatformSettings({ signupEnabled: on }),
    onSuccess: (next) => qc.setQueryData(['sa-settings'], next),
    onError: (e) => showError(e.message),
  })
  return (
    <Panel icon={UserPlus} title={t('superadmin.settings.signup.title')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink">{t('superadmin.settings.signup.label')}</p>
          <p className="text-xs text-ink-muted mt-0.5">{t('superadmin.settings.signup.hint')}</p>
        </div>
        <Switch checked={!!data.signupEnabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} label={t('superadmin.settings.signup.label')} />
      </div>
    </Panel>
  )
}

/** Platform owner settings: who the platform is, how it sends email and takes payment, its ABDM account, whether anyone can sign up. */
export default function PlatformSettings() {
  const { t } = useTranslation('superadmin')
  const { data, isLoading } = useQuery({ queryKey: ['sa-settings'], queryFn: fetchPlatformSettings })
  return (
    <PageContainer>
      <PageHeader icon={Settings2} title={t('superadmin.settings.title')} subtitle={t('superadmin.settings.subtitle')} />
      {isLoading || !data ? (
        <div className="h-96 rounded-xl bg-black/5 animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div className="flex flex-col gap-6">
            <EmailPanel data={data} />
            {!data.emailReady && <Note tone="info">{t('superadmin.settings.email.why')}</Note>}
            <SmsPanel data={data} />
          </div>
          <div className="flex flex-col gap-6">
            <CompanyPanel data={data} />
            <PaymentsPanel data={data} />
            <AbdmPanel data={data} />
            <NoticePanel data={data} />
            <SignupPanel data={data} />
          </div>
        </div>
      )}
    </PageContainer>
  )
}
