import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BellRing, Briefcase, Check, Mail, MessageCircle, Phone, Star, Users, X } from 'lucide-react'
import { Avatar, ColorChip, SectionCard, Tag } from '../../system'
import Button from '../../ui/Button'
import { Quiet, waNumber } from './kit'

/** Student 360 › Family: parents and guardians as cards with call / WhatsApp / email, brothers and sisters here, and how the family is messaged. */
export default function FamilyTab({ s, canEdit, onEdit }) {
  const { t } = useTranslation('students')
  const relation = (r) => (r ? t(`students.relations.${r}`, r) : null)
  const guardians = [...(s.guardians ?? [])].sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
  const consent = s.consents?.communication
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {guardians.length === 0 ? (
          <SectionCard icon={Users} title={t('students.form.guardians')}>
            <Quiet icon={Users} title={t('students.profile.family.none')} hint={t('students.profile.family.noneHint')} />
            {canEdit && <div className="flex justify-center"><Button size="sm" variant="secondary" onClick={onEdit}>{t('students.form.addGuardian')}</Button></div>}
          </SectionCard>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {guardians.map((g, i) => (
              <section key={g.id ?? i} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={g.name} size={48} soft />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                      <span className="truncate">{g.name}</span>
                      {g.isPrimary && <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden />}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {g.relation && <ColorChip label={relation(g.relation)} seed={`rel-${g.relation}`} />}
                      {g.isPrimary && <Tag tone="warning" size="xs">{t('students.form.primary')}</Tag>}
                    </div>
                  </div>
                </div>
                <dl className="mt-4 flex flex-col gap-2 text-sm">
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">{t('students.form.mobile')}</dt>
                    <dd className={g.mobile ? 'font-mono-num text-ink' : 'text-ink-faint'}>{g.mobile || t('students.profile.notFilledShort')}</dd></div>
                  <div className="flex items-center gap-2 min-w-0"><Mail className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">{t('students.form.email')}</dt>
                    <dd className={g.email ? 'truncate text-ink' : 'text-ink-faint'}>{g.email || t('students.profile.notFilledShort')}</dd></div>
                  <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">{t('students.form.occupation')}</dt>
                    <dd className={g.occupation ? 'text-ink' : 'text-ink-faint'}>{g.occupation || t('students.profile.notFilledShort')}</dd></div>
                </dl>
                {(g.mobile || g.email) && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                    {g.mobile && <a href={`tel:${g.mobile}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100"><Phone className="h-3.5 w-3.5" aria-hidden />{t('students.profile.family.call')}</a>}
                    {g.mobile && <a href={`https://wa.me/${waNumber(g.mobile)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-green-50 px-3 text-sm font-medium text-green-700 hover:bg-green-100"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{t('students.profile.family.whatsapp')}</a>}
                    {g.email && <a href={`mailto:${g.email}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-50 px-3 text-sm font-medium text-sky-700 hover:bg-sky-100"><Mail className="h-3.5 w-3.5" aria-hidden />{t('students.profile.family.email')}</a>}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard icon={Users} title={t('students.profile.siblings')} count={s.siblings?.length || null} flush>
          {s.siblings?.length ? (
            <ul className="divide-y divide-border">
              {s.siblings.map((x) => (
                <li key={x.id}>
                  <Link to={`/students/profile/${x.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.02]">
                    <Avatar name={x.name} size={32} soft />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-brand-700">{x.name}</span>
                      <span className="block font-mono-num text-[11px] text-ink-faint">{x.admissionNo}</span>
                    </span>
                    {x.classShort && <ColorChip label={x.classShort} seed={x.classShort.split('-')[0]} />}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-ink-faint">{t('students.profile.noSiblings')}</p>}
        </SectionCard>
        <SectionCard icon={BellRing} title={t('students.profile.family.messagesBy')}>
          <div className="flex flex-wrap gap-2">
            {['sms', 'whatsapp', 'email'].map((c) => {
              const on = c === 'email' ? consent?.email === true : consent?.[c] !== false // email needs an explicit yes
              return (
                <Tag key={c} tone={on ? 'success' : 'neutral'} icon={on ? Check : X}>{t(`students.profile.family.channel.${c}`)}</Tag>
              )
            })}
          </div>
          {s.language && <p className="mt-3 text-xs text-ink-muted">{t('students.profile.family.language', { lang: s.language })}</p>}
          <p className="mt-2 text-xs text-ink-faint">{t('students.form.guardiansHint')}</p>
        </SectionCard>
      </div>
    </div>
  )
}
