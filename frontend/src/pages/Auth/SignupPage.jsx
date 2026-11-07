import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Check, MailCheck, Rocket } from 'lucide-react'
import { formatINR } from '@schoolgiant/shared'
import Button from '../../components/ui/Button'
import { FormField, Input, SegmentedControl } from '../../components/system'
import { resendSignupCode, signup, verifySignup } from '../../api/auth'
import { fetchPublicPlans } from '../../api/public'
import AuthShell from './AuthShell'

export default function SignupPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['public-plans'], queryFn: fetchPublicPlans })
  const plans = data?.plans ?? []
  const [cycle, setCycle] = useState('MONTHLY')
  const [planCode, setPlanCode] = useState('')
  // website: a field people never see — a bot that fills it in gets nothing created (backend routes/public.js)
  const [form, setForm] = useState({ institutionName: '', city: '', name: '', email: '', mobile: '', password: '', website: '' })
  const [challenge, setChallenge] = useState(null) // the email must be confirmed before the institution is created
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(null)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!planCode && plans.length) setPlanCode((plans.find((p) => p.highlight) ?? plans[0]).code)
  }, [plans, planCode])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setErrors({})
    setBusy(true)
    try {
      const res = await signup({ ...form, planCode, billingCycle: cycle })
      if (res.needsCode) { setChallenge(res); setCode(''); setNotice(null) }
      else navigate('/core/setup', { replace: true })
    } catch (err) {
      setError(err.message)
      setErrors(err.details?.fields ?? {})
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await verifySignup(challenge.challengeId, code.trim())
      navigate('/core/setup', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const resend = async () => {
    setError(null)
    try { setNotice(t('auth.code.resent', { sentTo: (await resendSignupCode(challenge.challengeId)).sentTo })) } catch (err) { setError(err.message) }
  }

  if (challenge) {
    return (
      <AuthShell>
        <button onClick={() => { setChallenge(null); setError(null) }} className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-6"><ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t('actions.back', 'Back')}</button>
        <h2 className="font-display text-2xl font-semibold text-ink">{t('auth.code.title')}</h2>
        <p className="text-ink-muted mt-1.5 text-sm">{t('auth.signup.codeSent', { sentTo: challenge.sentTo })}</p>
        <form onSubmit={submitCode} className="mt-7 space-y-4" noValidate>
          <FormField label={t('auth.code.label')} htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="tracking-[0.3em] text-lg" />
          </FormField>
          {notice && <p className="text-sm text-ink-muted">{notice}</p>}
          {error && <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error}</div>}
          <Button type="submit" size="lg" icon={MailCheck} loading={busy} disabled={code.length !== 6} className="w-full">{t('auth.signup.verifyCreate')}</Button>
        </form>
        <p className="mt-4 text-sm text-ink-muted text-center">
          {t('auth.code.noEmail')} <button type="button" onClick={resend} className="text-brand-600 font-medium hover:underline">{t('auth.code.resend')}</button>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell wide>
      <h2 className="font-display text-2xl font-semibold text-ink">{t('auth.signup.title')}</h2>
      <p className="text-ink-muted mt-1.5 text-sm">{t('auth.signup.intro')}</p>

      {data && !data.signupEnabled ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-6 text-sm text-ink-muted">{t('auth.signup.closed')}</div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid lg:grid-cols-5 gap-6" noValidate>
          <section className="lg:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-ink">{t('auth.signup.pickPlan')}</p>
              <SegmentedControl options={[{ value: 'MONTHLY', label: t('auth.signup.monthly') }, { value: 'YEARLY', label: t('auth.signup.yearly') }]} value={cycle} onChange={setCycle} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {isLoading && [0, 1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-black/5 animate-pulse" />)}
              {plans.map((p) => {
                const active = p.code === planCode
                const price = cycle === 'YEARLY' ? p.priceYearly / 12 : p.priceMonthly
                return (
                  <button type="button" key={p.code} onClick={() => setPlanCode(p.code)}
                    className={clsx('relative text-start rounded-xl border p-4 transition bg-surface', active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-border hover:border-brand-300')}>
                    {p.highlight && <span className="absolute -top-2.5 end-3 text-[10px] font-semibold uppercase tracking-wide bg-brand-500 text-white px-2 py-0.5 rounded-full">{t('auth.signup.popular')}</span>}
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold text-ink">{p.name}</span>
                      <span className={clsx('w-4 h-4 rounded-full border flex items-center justify-center', active ? 'bg-brand-500 border-brand-500' : 'border-ink-faint/50')}>{active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">{p.tagline}</p>
                    <p className="mt-3"><Trans t={t} i18nKey="auth.signup.pricePerMonth" values={{ price: formatINR(Math.round(price)) }} components={{ price: <span className="font-display text-xl font-semibold text-ink" />, unit: <span className="text-xs text-ink-faint" /> }} /></p>
                    <ul className="mt-2 space-y-1">
                      {p.features.slice(0, 3).map((f) => <li key={f} className="text-xs text-ink-muted flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-500 shrink-0" />{f}</li>)}
                    </ul>
                    <p className="mt-2 text-[11px] text-ink-faint">{p.limits.students ? t('auth.signup.planLimitsStudents', { modules: p.modules.length, users: p.limits.users, students: p.limits.students }) : t('auth.signup.planLimits', { modules: p.modules.length, users: p.limits.users })}</p>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="lg:col-span-2 space-y-3.5">
            <p className="text-sm font-medium text-ink">{t('auth.signup.yourInstitution')}</p>
            <FormField label={t('auth.signup.institutionName')} required error={errors.institutionName}>
              <Input value={form.institutionName} onChange={set('institutionName')} placeholder={t('auth.signup.institutionNamePlaceholder')} />
            </FormField>
            <FormField label={t('auth.signup.city')} error={errors.city}><Input value={form.city} onChange={set('city')} placeholder={t('auth.signup.cityPlaceholder')} /></FormField>
            <FormField label={t('auth.signup.yourName')} required error={errors.name}><Input value={form.name} onChange={set('name')} autoComplete="name" /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('auth.signup.workEmail')} required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></FormField>
              <FormField label={t('auth.signup.mobile')} required error={errors.mobile}><Input value={form.mobile} onChange={set('mobile')} autoComplete="tel" placeholder="+91" /></FormField>
            </div>
            <FormField label={t('auth.password')} required error={errors.password} hint={t('auth.signup.passwordRule')}>
              <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </FormField>
            <input type="text" name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -start-[9999px] w-px h-px opacity-0" />
            {error && <div role="alert" className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg px-3 py-2">{error}</div>}
            <Button type="submit" size="lg" icon={Rocket} loading={busy} disabled={!planCode} className="w-full">{t('auth.signup.create')}</Button>
            <p className="text-xs text-ink-faint">{t('auth.signup.adminNote')}</p>
            <p className="text-sm text-ink-muted"><Trans t={t} i18nKey="auth.signup.haveAccount" components={{ link: <Link to="/login" className="text-brand-600 font-medium hover:underline" /> }} /></p>
          </section>
        </form>
      )}
    </AuthShell>
  )
}
