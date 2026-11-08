import { useTranslation } from 'react-i18next'
import { FileBadge, LogOut, Smartphone, UserRound } from 'lucide-react'
import Button from '../../components/ui/Button'
import { FCard, FEmpty, FError, FRow, FSkeleton, useFamily, useFamilyQuery } from '../../components/family/FamilyKit'
import { familyCertificates, familyDocUrl, familyProfile } from '../../api/family'
import { useFormat } from '../../context/SettingsContext'
import { ContactCard } from './Login'
import { BAR_SLOTS, familySections } from '../../components/family/sections'

function Profile() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: p, isLoading, error } = useFamilyQuery(['profile'], () => familyProfile(slug, studentId))
  if (isLoading) return <FSkeleton className="h-40" />
  if (error) return <FError error={error} />
  if (!p) return null
  const rows = [
    [t('family.profile.class'), p.class], [t('family.profile.year'), p.year], [t('family.profile.roll'), p.rollNo], [t('family.profile.admissionNo'), p.admissionNo],
    [t('family.profile.classTeacher'), p.classTeacher], [t('family.profile.dob'), p.dob && date(p.dob)], [t('family.profile.bloodGroup'), p.bloodGroup],
  ].filter((r) => r[1])
  return (
    <FCard title={p.name}>
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-[15px]">
        {rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="text-ink-muted">{k}</dt>, <dd key={`v${k}`} className="text-ink font-medium break-words">{v}</dd>])}
      </dl>
      {p.guardians.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border space-y-1.5">
          {p.guardians.map((g) => <p key={`${g.name}-${g.relation}`} className="flex items-center gap-2 text-sm text-ink"><UserRound className="w-4 h-4 text-ink-faint" aria-hidden />{g.name}{g.relation ? <span className="text-ink-muted"> · {t(`family.relation.${g.relation}`, g.relation)}</span> : null}{g.mobile ? <span className="ms-auto text-ink-faint font-mono-num">{g.mobile}</span> : null}</p>)}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-faint">{t('family.profile.wrong')}</p>
    </FCard>
  )
}

function Certificates() {
  const { t } = useTranslation('family')
  const { slug, studentId } = useFamily()
  const { date } = useFormat()
  const { data: rows = [], isLoading, error } = useFamilyQuery(['certificates'], () => familyCertificates(slug, studentId))
  if (isLoading) return <FSkeleton className="h-24" />
  if (error) return <FError error={error} />
  return (
    <FCard title={t('family.certificates.title')}>
      {rows.length ? (
        <div className="divide-y divide-border -my-2">
          {rows.map((c) => <FRow key={c.id} href={familyDocUrl(slug, 'CERTIFICATE', c.id)} icon={FileBadge} title={t(`family.certificates.kinds.${c.kind}`, c.kindLabel)} subtitle={`${c.certificateNo} · ${date(c.issueDate)}`} meta={c.purpose ?? undefined} />)}
        </div>
      ) : <FEmpty icon={FileBadge} title={t('family.certificates.none')} hint={t('family.certificates.noneHint')} />}
    </FCard>
  )
}

export default function FamilyMore() {
  const { t } = useTranslation('family')
  const { me, has, signOut, info, slug } = useFamily()
  const rest = familySections(slug, has, t).slice(BAR_SLOTS)
  return (
    <>
      {rest.length > 0 && (
        <FCard>
          <div className="divide-y divide-border -my-2">{rest.map((x) => <FRow key={x.key} to={x.to} icon={x.icon} title={x.label} />)}</div>
        </FCard>
      )}
      <Profile />
      {has('CERTIFICATES') && <Certificates />}
      <ContactCard />
      {info.help && <FCard title={t('family.more.help')}><p className="text-sm text-ink whitespace-pre-line">{info.help}</p></FCard>}
      <FCard>
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-ink-faint shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-ink-muted">{t('family.more.install')}</p>
        </div>
      </FCard>
      <FCard>
        <p className="text-sm text-ink-muted">{t('family.more.signedInAs', { mobile: me?.mobile })}</p>
        <Button variant="secondary" icon={LogOut} className="w-full mt-3" onClick={signOut}>{t('family.more.signOut')}</Button>
      </FCard>
    </>
  )
}
