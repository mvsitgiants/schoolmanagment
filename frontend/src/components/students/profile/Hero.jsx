import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, CalendarDays, Droplet, IdCard, MessageCircle, Pencil, Phone, Star, UserCheck, UserMinus } from 'lucide-react'
import { STUDENT_STATUS } from '@schoolgiant/shared'
import { Avatar, CodeBadge, ColorChip, GenderTag, StatusPill, Tag } from '../../system'
import Button from '../../ui/Button'
import { fetchStudentPhoto } from '../../../api/students'
import { useFormat } from '../../../context/SettingsContext'
import { waNumber } from './kit'

/**
 * The top of Student 360: photo, name, class, admission no., status and the facts everyone looks for first; the
 * parents as contact chips (call, WhatsApp); and the actions on the record.
 */
export default function Hero({ s, actions, onPhoto }) {
  const { t } = useTranslation('students')
  const { date } = useFormat()
  const { data: photo } = useQuery({ queryKey: ['student-photo', s.id], queryFn: () => fetchStudentPhoto(s.id), staleTime: 300_000 })
  const relation = (r) => (r ? t(`students.relations.${r}`, r) : null)
  const guardians = [...(s.guardians ?? [])].sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <button type="button" onClick={onPhoto} title={t('students.photo.title')} aria-label={t('students.photo.title')}
            className="shrink-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            {photo?.photo
              ? <img src={photo.photo} alt={s.name} className="h-[72px] w-[72px] rounded-2xl object-cover ring-1 ring-border sm:h-24 sm:w-24" />
              : <Avatar name={s.name} soft size={96} className="!h-[72px] !w-[72px] !rounded-2xl !text-2xl sm:!h-24 sm:!w-24 sm:!text-3xl" />}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold leading-tight text-ink break-words sm:text-2xl">{s.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {s.classLabel && <ColorChip label={s.classLabel} seed={s.classId ?? s.classLabel} sub={s.rollNo ? t('students.profile.hero.roll', { no: s.rollNo }) : null} />}
              <CodeBadge title={t('students.form.admissionNo')}>{s.admissionNo}</CodeBadge>
              <StatusPill tone={STUDENT_STATUS[s.status]?.tone}>{t(`students.status.${s.status}`, STUDENT_STATUS[s.status]?.label)}</StatusPill>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-muted">
              {s.gender && <GenderTag value={s.gender} label={[t(`students.genders.${s.gender}`, s.gender), s.age != null && t('students.directory.age', { count: s.age })].filter(Boolean).join(' · ')} />}
              {!s.gender && s.age != null && <span>{t('students.directory.age', { count: s.age })}</span>}
              {s.bloodGroup && <Tag tone="danger" icon={Droplet} size="xs">{s.bloodGroup}</Tag>}
              {s.yearName && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-ink-faint" aria-hidden />{s.yearName}</span>}
              {s.admissionDate && <span className="text-ink-faint">{t('students.profile.hero.since', { date: date(s.admissionDate) })}</span>}
            </div>
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2 lg:max-w-[46%] lg:justify-end">{actions}</div>}
      </div>

      {guardians.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
          {guardians.map((g, i) => (
            <span key={g.id ?? i} className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border bg-bg/60 py-1 ps-1 pe-1.5">
              <Avatar name={g.name} size={28} soft />
              <span className="min-w-0 leading-tight">
                <span className="flex items-center gap-1 truncate text-[13px] font-medium text-ink">
                  {g.name}{g.isPrimary && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label={t('students.form.primary')} />}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">{[relation(g.relation), g.mobile].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              {g.mobile && (
                <>
                  <a href={`tel:${g.mobile}`} title={t('students.profile.hero.call', { name: g.name })} aria-label={t('students.profile.hero.call', { name: g.name })}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <a href={`https://wa.me/${waNumber(g.mobile)}`} target="_blank" rel="noreferrer" title={t('students.profile.hero.whatsapp', { name: g.name })} aria-label={t('students.profile.hero.whatsapp', { name: g.name })}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** The record's actions, as the hero shows them. */
export function HeroActions({ s, can, onEdit, onIdCard, onTc, onInactive, onActive, busy }) {
  const { t } = useTranslation('students')
  return (
    <>
      {can.edit && <Button size="sm" variant="secondary" icon={Pencil} onClick={onEdit}>{t('actions.edit')}</Button>}
      {can.idCard && s.status === 'ACTIVE' && <Button size="sm" variant="secondary" icon={IdCard} onClick={onIdCard}>{t('students.profile.hero.idCard')}</Button>}
      {can.tc && s.status === 'ACTIVE' && <Button size="sm" variant="secondary" icon={ArrowLeftRight} onClick={onTc}>{t('students.profile.requestTc')}</Button>}
      {can.edit && s.status === 'ACTIVE' && <Button size="sm" variant="ghost" icon={UserMinus} onClick={onInactive} loading={busy}>{t('students.profile.markInactive')}</Button>}
      {can.edit && s.status !== 'ACTIVE' && <Button size="sm" variant="secondary" icon={UserCheck} onClick={onActive} loading={busy}>{t('students.profile.markActive')}</Button>}
    </>
  )
}
