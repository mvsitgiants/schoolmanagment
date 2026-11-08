import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { Clock, Mail, MapPin, MessageCircle, Phone, ShieldCheck } from 'lucide-react'
import { FormField, Input, Note } from '../../components/system'
import Button from '../../components/ui/Button'
import { FCard, useFamily } from '../../components/family/FamilyKit'
import { familySendCode, familyVerify } from '../../api/family'

/** Sign in: the mobile number on the student's record → SMS code. The reply never says whether the number is on a record. */
export default function FamilyLogin() {
  const { t } = useTranslation('family')
  const { slug, info, signedIn } = useFamily()
  const [mobile, setMobile] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState({})
  const send = useMutation({
    mutationFn: () => familySendCode(slug, mobile),
    onSuccess: (r) => { setChallenge(r); setCode(''); setErrors({}) },
    onError: (e) => setErrors({ mobile: e.message }),
  })
  const verify = useMutation({
    mutationFn: () => familyVerify(slug, challenge.challengeId, code),
    onSuccess: (me) => signedIn(me),
    onError: (e) => setErrors({ code: e.message, expired: ['OTP_EXPIRED', 'OTP_LOCKED'].includes(e.code) || e.status === 409 }),
  })
  const s = info.school
  const digits = challenge?.digits ?? info.otp?.digits ?? 6

  return (
    <>
      <FCard>
        <h1 className="font-display text-xl font-semibold text-ink">{t('family.login.title')}</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">{info.welcome || t('family.login.subtitle', { name: s.name })}</p>
        <div className="mt-5 space-y-4">
          <FormField label={t('family.login.mobile')} error={errors.mobile} hint={info.studentLogins ? t('family.login.mobileHintStudents') : t('family.login.mobileHint')}>
            <Input inputMode="numeric" autoComplete="tel" value={mobile} placeholder="98450 12345" maxLength={14}
              onChange={(e) => { setMobile(e.target.value); setChallenge(null); setErrors({}) }} />
          </FormField>
          {!challenge ? (
            <Button className="w-full" size="lg" loading={send.isPending} disabled={mobile.replace(/\D/g, '').length < 10} onClick={() => send.mutate()}>{t('family.login.sendCode')}</Button>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-ink-muted">{t('family.login.codeSent', { phone: challenge.sentTo, school: s.name, digits, minutes: challenge.validMinutes })}</p>
              {challenge.testCode && <Note tone="info">{t('family.login.testMode', { code: challenge.testCode })}</Note>}
              <FormField label={t('family.login.code')} error={errors.code}>
                <Input inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={digits} className="font-mono-num tracking-[0.4em] text-lg"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </FormField>
              <Button className="w-full" size="lg" icon={ShieldCheck} loading={verify.isPending} disabled={code.length !== digits} onClick={() => verify.mutate()}>{t('family.login.signIn')}</Button>
              <button type="button" className={clsx('w-full min-h-[44px] text-sm hover:underline', errors.expired ? 'text-brand-700 font-semibold' : 'text-brand-600')} onClick={() => send.mutate()}>{t('family.login.newCode')}</button>
            </>
          )}
        </div>
      </FCard>
      <ContactCard />
      <p className="text-center text-xs text-ink-muted px-4">{t('family.login.privacy', { name: s.name })}</p>
    </>
  )
}

/** How to reach the school — on the sign-in screen and under More. */
export function ContactCard() {
  const { t } = useTranslation('family')
  const { info } = useFamily()
  const c = info.contact ?? {}
  const phone = c.phone || info.school.phone
  const address = c.address || [info.school.addressLine, info.school.city].filter(Boolean).join(', ')
  const timings = info.timings ?? []
  if (!phone && !address && !timings.length && !c.email && !c.whatsapp) return null
  const row = 'flex min-h-[44px] items-center gap-2.5'
  return (
    <FCard title={t('family.contact.title')}>
      <div className="space-y-1 text-[15px]">
        {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className={clsx(row, 'font-medium text-ink hover:text-brand-700')}><Phone className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span dir="ltr">{phone}</span></a>}
        {c.whatsapp && <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className={clsx(row, 'font-medium text-ink hover:text-brand-700')}><MessageCircle className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span>{t('family.contact.whatsapp')}</span></a>}
        {c.email && <a href={`mailto:${c.email}`} className={clsx(row, 'text-ink hover:text-brand-700')}><Mail className="w-4 h-4 text-ink-faint shrink-0" aria-hidden /><span className="break-all">{c.email}</span></a>}
        {address && <p className="flex items-start gap-2.5 py-1.5 text-ink-muted"><MapPin className="w-4 h-4 text-ink-faint mt-1 shrink-0" aria-hidden /><span className="min-w-0 break-words">{address}{c.mapUrl && <> · <a href={c.mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline underline-offset-2">{t('family.contact.directions')}</a></>}</span></p>}
        {timings.map((x) => <p key={`${x.label}-${x.hours}`} className="flex items-start gap-2.5 text-ink-muted"><Clock className="w-4 h-4 text-ink-faint mt-1 shrink-0" aria-hidden /><span className="min-w-0 break-words"><span className="text-ink font-medium">{x.label}</span> · {x.hours}</span></p>)}
      </div>
    </FCard>
  )
}
