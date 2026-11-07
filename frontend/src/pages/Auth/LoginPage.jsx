import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowBigUp, ArrowRight, Building2, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, MailCheck, ShieldCheck } from 'lucide-react'
import { getCurrentUser, getRememberedEmail, login, resendLoginCode, setRememberedEmail, verifyLoginCode } from '../../api/auth'
import { takeLogoutReason } from '../../api/client'
import { landingFor } from '../../catalog/nav'
import LanguageSelector from '../../components/ui/LanguageSelector'
import NoticeBanner from '../../components/ui/NoticeBanner'
import AuthMark from './AuthMark'
import { KeyModules, ProductPeek } from '../../components/auth/LoginShowcase'

const DEMO = [
  { label: 'Platform owner', email: 'owner@schoolgiant.test', password: 'Owner@123', hint: 'SaaS console' },
  { label: 'City Care · Admin', email: 'mvsitgiants@gmail.com', password: 'Admin@123', hint: 'paid Institution plan' },
  { label: 'Sunrise · Admin', email: 'admin@sunrise.test', password: 'Admin@123', hint: 'new trial, 1 role' },
  { label: 'Front desk', email: 'priya.frontdesk@citycare.test', password: 'Demo@123', hint: 'limited role' },
  { label: 'Staff nurse', email: 'mary.nurse@citycare.test', password: 'Demo@123', hint: 'vitals station' },
  { label: 'Doctor', email: 'dr.kavya@citycare.test', password: 'Demo@123', hint: 'OPD · signing PIN 1357' },
  { label: 'Cashier', email: 'suresh.cash@citycare.test', password: 'Demo@123', hint: 'billing counter' },
  { label: 'Billing manager', email: 'meena.billing@citycare.test', password: 'Demo@123', hint: 'bills, tariffs, day-end' },
  { label: 'Lab technician', email: 'imran.lab@citycare.test', password: 'Demo@123', hint: 'collection, results' },
  { label: 'Pathologist', email: 'dr.neha@citycare.test', password: 'Demo@123', hint: 'verify · PIN 1357' },
  { label: 'Pharmacist', email: 'deepa.pharma@citycare.test', password: 'Demo@123', hint: 'Rx queue, counter' },
  { label: 'Radiologist', email: 'dr.vikram@citycare.test', password: 'Demo@123', hint: 'reports · PIN 1357' },
  { label: 'Housekeeping', email: 'rekha.hk@citycare.test', password: 'Demo@123', hint: 'bed turnaround' },
  { label: 'Dietician', email: 'divya.diet@citycare.test', password: 'Demo@123', hint: 'diets, kitchen' },
  { label: 'Store keeper', email: 'ravi.store@citycare.test', password: 'Demo@123', hint: 'ward indents' },
  { label: 'ER doctor', email: 'dr.nikhil@citycare.test', password: 'Demo@123', hint: 'emergency' },
  { label: 'OT nurse', email: 'grace.ot@citycare.test', password: 'Demo@123', hint: 'theatre list' },
  { label: 'TPA desk', email: 'farah.tpa@citycare.test', password: 'Demo@123', hint: 'pre-auths, claims' },
  { label: 'Medical records', email: 'joseph.mrd@citycare.test', password: 'Demo@123', hint: 'ICD coding, requests' },
  { label: 'CSSD technician', email: 'sunil.cssd@citycare.test', password: 'Demo@123', hint: 'sterile sets' },
  { label: 'Patient relations', email: 'pooja.gro@citycare.test', password: 'Demo@123', hint: 'feedback, complaints' },
  { label: 'HR manager', email: 'nisha.hr@citycare.test', password: 'Demo@123', hint: 'staff, roster, attendance, leave' },
  { label: 'Doctor, 2 institutions', email: 'dr.mehta@demo.test', password: 'Demo@123', hint: 'asks which institution' },
]

export default function LoginPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(getRememberedEmail)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(!!getRememberedEmail())
  const [show, setShow] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(null)
  const [error, setError] = useState(() => takeLogoutReason())
  const [tenants, setTenants] = useState(null)
  const [challenge, setChallenge] = useState(null) // { challengeId, sentTo } while a sign-in code is out
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(location.state?.notice ?? null)

  const existing = getCurrentUser()
  if (existing && !tenants && !challenge) return <Navigate to={landingFor(existing)} replace />

  const finish = (me) => {
    setRememberedEmail(remember ? email : '')
    const from = location.state?.from?.pathname
    navigate(me.superadmin ? '/superadmin' : from && from !== '/login' ? from : landingFor(me), { replace: true })
  }

  const submit = async (e, tenantId) => {
    e?.preventDefault()
    setError(null)
    if (!email.trim() || !password) { setError(t('auth.enterBoth', 'Please enter your email and password.')); return }
    setBusy(true)
    if (tenantId) setPicking(tenantId)
    try {
      const res = await login(email.trim(), password, tenantId)
      if (res.needsTenant) setTenants(res.tenants)
      else if (res.needsCode) { setTenants(null); setCode(''); setNotice(null); setChallenge(res) }
      else finish(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setPicking(null)
    }
  }

  const submitCode = async (e) => {
    e?.preventDefault()
    if (code.length !== 6) return
    setError(null)
    setBusy(true)
    try {
      finish(await verifyLoginCode(challenge.challengeId, code.trim()))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError(null)
    try {
      const res = await resendLoginCode(challenge.challengeId)
      setNotice(t('auth.code.resent', { sentTo: res.sentTo }))
    } catch (err) {
      setError(err.message)
    }
  }

  const back = () => { setTenants(null); setChallenge(null); setCode(''); setError(null); setPassword('') }

  // the ERP sign-in's controls, class for class
  const primaryCls = 'w-full h-12 rounded-xl bg-brand-600 text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-700 hover:shadow-brand-600/35 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed'
  const ghostCls = 'w-full h-11 rounded-xl text-slate-500 text-sm hover:text-slate-800 hover:bg-slate-100 transition-colors'
  const inputCls = 'w-full h-12 ps-11 pe-4 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm outline-none transition-all hover:border-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15'
  const labelCls = 'block text-sm font-medium text-slate-700 mb-2'
  const errorBox = error && (
    <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{error}</span>
    </div>
  )

  const signingIn = !tenants && !challenge
  const title = tenants ? t('auth.chooseInstitution', 'Choose an institution') : challenge ? t('auth.code.title') : t('auth.signIn', 'Sign in')
  const subtitle = tenants
    ? t('auth.worksAtInstitutions', { email, count: tenants.length, defaultValue: `${email} works at ${tenants.length} institutions. Which one do you want to open?` })
    : challenge ? t('auth.code.sent', { sentTo: challenge.sentTo }) : null

  return (
    <div className="auth-blue relative min-h-[100dvh] bg-bg overflow-hidden">
      {/* the brand band across the top half, with a faint dot grid */}
      <div className="absolute inset-x-0 top-0 h-[300px] lg:h-[54vh] bg-gradient-to-br from-brand-500 via-brand-500 to-brand-600">
        <div className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="absolute -right-32 -top-32 w-[32rem] h-[32rem] rounded-full bg-white/10 blur-3xl" />
      </div>
      <div className="absolute top-4 end-4 sm:top-6 sm:end-6 z-10 rounded-lg bg-white shadow-sm"><LanguageSelector /></div>

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-12 py-8 lg:py-[6vh] grid lg:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_470px] gap-10 xl:gap-16 items-start">
        {/* left — who we are, the product, the modules */}
        <div className="flex flex-col auth-rise">
          <div className="flex items-center gap-3">
            <AuthMark size="lg" />
            <span className="lg:hidden font-display text-2xl font-bold text-white">SchoolGiant</span>
          </div>
          <h1 className="hidden lg:block mt-6 font-display text-5xl font-bold text-white tracking-tight">SchoolGiant</h1>
          <div className="hidden lg:block mt-4 max-w-xl space-y-3 text-[15px] leading-relaxed text-white/85">
            <p>{t('auth.showcase.intro', 'One system for the whole institution — front desk, OPD, wards, lab, pharmacy, billing, insurance and accounts, all working from the same patient record.')}</p>
            <p className="hidden [@media(min-height:960px)]:block">{t('auth.showcase.intro2', 'From registration to discharge every department hands its work to the next, so nobody writes the same thing twice.')}</p>
          </div>
          <div className="hidden lg:flex flex-col gap-7 mt-7">
            <ProductPeek className="w-full max-w-[620px] [@media(max-height:1000px)]:max-w-[530px] [@media(max-height:800px)]:max-w-[400px] self-start" />
            <KeyModules />
          </div>
        </div>

        {/* right — the sign-in card, straddling the band */}
        <div className="w-full max-w-[470px] mx-auto lg:mx-0 mt-2 lg:mt-0 auth-rise" style={{ animationDelay: '80ms' }}>
          <div className="rounded-[28px] bg-white ring-1 ring-slate-900/5 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.22)] p-7 sm:p-10">
            {/* planned maintenance etc. — people see it before they sign in */}
            <NoticeBanner className="border rounded-lg mb-5 px-3 sm:px-3" />
            <div className="flex items-start justify-between gap-4">
              <p className="text-[15px] text-slate-700">{t('auth.welcomeTo', 'Welcome to')} <span className="font-semibold text-brand-600">SchoolGiant</span></p>
              <p className="text-end text-xs leading-relaxed text-slate-400 shrink-0">
                {t('auth.newInstitutionQ', 'New institution?')}<br />
                <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">{t('auth.startTrial', 'Start a free trial')}</Link>
              </p>
            </div>

            {challenge && (
              <span className="mt-5 inline-flex w-12 h-12 items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-brand-100">
                <MailCheck className="w-6 h-6 text-brand-600" />
              </span>
            )}
            <h2 className={`${signingIn ? 'text-[2.75rem]' : 'text-3xl'} mt-3 font-bold text-slate-900 tracking-tight leading-tight`}>{title}</h2>
            {subtitle && <p className="mt-2 text-sm text-slate-500 leading-relaxed">{subtitle}</p>}

            <div className="mt-8">
              {notice && (
                <div role="status" className="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {challenge ? (
                <form onSubmit={submitCode} className="space-y-4" noValidate>
                  <label htmlFor="login-code" className="sr-only">{t('auth.code.label')}</label>
                  <input id="login-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••"
                    className="w-full h-14 px-4 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-300 text-2xl tracking-[0.6em] text-center font-mono outline-none transition-all focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
                  {errorBox}
                  <button type="submit" disabled={busy || code.length !== 6} className={primaryCls}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.code.verify')}</button>
                  <button type="button" onClick={resend} className="w-full text-xs font-medium text-brand-600 hover:text-brand-700">{t('auth.code.noEmail')} {t('auth.code.resend')}</button>
                  <button type="button" onClick={back} className={ghostCls}>{t('auth.backToSignIn', '← Back to sign in')}</button>
                </form>
              ) : tenants ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 truncate">{email}</p>
                  {tenants.map((h) => (
                    <button key={h.id} type="button" disabled={busy} onClick={() => submit(null, h.id)}
                      className="w-full h-14 px-4 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm flex items-center gap-3 hover:border-brand-400 hover:bg-brand-50/50 transition-all disabled:opacity-60 text-start group">
                      <span className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0"><Building2 className="w-4 h-4 text-brand-600" /></span>
                      <span className="flex-1 truncate font-medium">{h.name}</span>
                      {picking === h.id ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all rtl:rotate-180" />}
                    </button>
                  ))}
                  {errorBox}
                  <button type="button" onClick={back} className={ghostCls}>{t('auth.differentAccount', '← Use a different account')}</button>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-5" noValidate>
                  <div>
                    <label htmlFor="login-email" className={labelCls}>{t('auth.enterEmail', 'Enter your email address')}</label>
                    <div className="relative">
                      <Mail className="absolute start-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input id="login-email" type="email" autoComplete="username" autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.emailPlaceholder', 'you@institution.com')} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="login-password" className={labelCls}>{t('auth.enterPassword', 'Enter your password')}</label>
                    <div className="relative">
                      <Lock className="absolute start-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus={!!email} value={password}
                        onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock'))} onBlur={() => setCapsLock(false)}
                        placeholder={t('auth.password', 'Password')} className={`${inputCls} pe-12`} />
                      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
                        className="absolute end-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 transition-colors">
                        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {capsLock && <p className="mt-2 text-xs text-amber-700 flex items-center gap-1.5"><ArrowBigUp className="w-3.5 h-3.5" /> {t('auth.capsLock', 'Caps Lock is on')}</p>}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30 focus:ring-2" />
                      {t('auth.rememberShort', 'Remember me')}
                    </label>
                    <Link to="/forgot-password" state={{ email }} className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">{t('auth.forgot.link')}</Link>
                  </div>
                  {errorBox}
                  <div className="pt-2">
                    <button id="login-submit" type="submit" disabled={busy} className={primaryCls}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.signIn', 'Sign in')}</button>
                  </div>
                </form>
              )}
            </div>

            {/* demo logins — development builds only: a public owner button would hand anyone the platform */}
            {import.meta.env.DEV && signingIn && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 text-center mb-3">Demo logins · dev only</p>
                <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto scroll-thin">
                  {DEMO.map((d) => (
                    <button key={d.email} type="button" onClick={() => { setEmail(d.email); setPassword(d.password); setError(null) }}
                      className="text-start bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg py-1.5 px-2.5 transition-all">
                      <span className="block text-xs font-medium text-slate-700">{d.label}</span>
                      <span className="block text-[11px] text-slate-400">{d.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Patient portal: <Link to="/my/city-care-institution" className="text-brand-600 hover:underline">/my/city-care-institution</Link> — mobile 99000 12345, the code shows on screen.</p>
              </div>
            )}
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('auth.dataPrivate', 'Each institution’s data is kept separate and private.')}
          </p>
        </div>
      </div>
    </div>
  )
}
