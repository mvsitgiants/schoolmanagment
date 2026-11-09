import { useTranslation } from 'react-i18next'
import { BookOpen, Briefcase, Building2, CalendarCheck2, CalendarDays, GraduationCap, Mail, MapPin, MapPinHouse, Phone, School, UserRound, Users } from 'lucide-react'
import { EMPLOYEE_STATUSES } from '@schoolgiant/shared'
import { Avatar, CodeBadge, Skeleton, StatusPill, VerifiedBadge } from '../../components/system'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels } from '../../components/hrms/HrKit'
import { RevealToggle, addressText, hide } from './shared'

/**
 * The left rail of My workspace: who you are, always on screen whichever tab is open — as
 * the hospital workspace has it. The staff record (when Staff & HR is on and the login is linked)
 * gives the job details; teaching gives the classes you are class teacher of and the subjects you
 * teach. A login with neither still gets its sign-in details. Read-only: HR owns these facts.
 */

function Line({ icon: Icon, label, children }) {
  const empty = children == null || children === ''
  return (
    <div className="flex items-baseline gap-2.5 text-sm min-w-0">
      {Icon && <Icon className="w-3.5 h-3.5 text-ink-faint shrink-0 translate-y-0.5" />}
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className={empty ? 'ms-auto text-ink-faint' : 'ms-auto text-ink font-medium min-w-0 text-end break-words'}>
        {empty ? '—' : children}
      </span>
    </div>
  )
}

function Section({ title, children, action }) {
  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2 mb-2.5 min-h-8">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

/** Photo-less record header: initials, name, job, code and status. On a phone it is the only part of the rail shown. */
function Head({ name, sub, code, status, verified }) {
  const { t } = useTranslation('me')
  return (
    <div className="flex items-center gap-4 min-w-0 rounded-xl border border-border bg-surface p-4 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
      <Avatar name={name} size={64} soft />
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-lg lg:text-xl font-semibold text-ink leading-tight break-words">{name}{verified && <VerifiedBadge className="ms-1.5" title={t('me.rail.verifiedProfile')} />}</h1>
        {sub && <p className="text-sm text-ink-muted mt-0.5 break-words">{sub}</p>}
        {(code || status) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {code && <CodeBadge>{code}</CodeBadge>}
            {status}
          </div>
        )}
      </div>
    </div>
  )
}

const unique = (xs) => [...new Set(xs)]

export default function IdentityRail({ me, user, teaching, loading, reveal = false, onReveal }) {
  const { t } = useTranslation('me')
  const L = useHrLabels()
  const { date } = useFormat()
  const verified = !!user?.user?.emailVerified

  if (!me && loading) {
    return (
      <aside className="flex flex-col gap-5" aria-busy="true">
        <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <Skeleton className="w-16 h-16 shrink-0 rounded-full" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <span className="sr-only">{t('me.workspace.loadingRecord')}</span>
          </div>
        </div>
      </aside>
    )
  }

  const classes = teaching?.classes ?? []
  const classTeacherOf = unique(classes.filter((c) => c.classTeacher).map((c) => c.section))
  const subjects = unique(classes.filter((c) => c.allocated).map((c) => c.subject)).sort()
  const sections = unique(classes.map((c) => c.section))
  const status = me?.status && <StatusPill tone={EMPLOYEE_STATUSES[me.status]?.tone ?? 'neutral'}>{L.status(me.status)}</StatusPill>
  const teachingSection = classes.length > 0 && (
    <Section title={t('me.rail.teaching')}>
      {classTeacherOf.length > 0 && <Line icon={School} label={t('me.rail.classTeacherOf')}>{classTeacherOf.join(', ')}</Line>}
      <Line icon={BookOpen} label={t('me.rail.subjects')}>{subjects.join(', ') || null}</Line>
      <Line icon={GraduationCap} label={t('me.rail.sections', { count: sections.length })}>{sections.join(', ')}</Line>
    </Section>
  )

  // No staff record: the sign-in (and what they teach) is all there is to show.
  if (!me) {
    return (
      <aside className="flex flex-col gap-5">
        <Head name={user?.user?.name || t('me.rail.you')} sub={user?.user?.designation || null} verified={verified} />
        <div className="hidden lg:flex lg:flex-col lg:gap-5">
          <Section title={t('me.rail.about')}>
            <Line icon={Mail} label={t('me.rail.email')}>{user?.user?.email}</Line>
            <Line icon={Phone} label={t('me.rail.mobile')}>{user?.user?.mobile}</Line>
            <Line icon={Building2} label={t('me.rail.institution')}>{user?.tenant?.name}</Line>
          </Section>
          {teachingSection}
        </div>
      </aside>
    )
  }

  const emergency = me.emergencyContact ?? {}
  return (
    <aside className="flex flex-col gap-5">
      <Head name={me.name} code={me.employeeCode ? `#${me.employeeCode}` : null} verified={verified}
        sub={[me.designation, me.department].filter(Boolean).join(' · ') || null}
        status={<span className="lg:hidden">{status}</span>} />

      {/* On a phone the tabs come first — a teacher marking a lesson taught between periods should
          not scroll past their HR record. The same facts are on the Details tab. */}
      <div className="hidden lg:flex lg:flex-col lg:gap-5">
        <Section title={t('me.rail.about')}>
          <Line icon={Phone} label={t('me.rail.phone')}>{me.mobile}</Line>
          <Line icon={Mail} label={t('me.rail.email')}>{me.email}</Line>
        </Section>

        {teachingSection}

        <Section title={t('me.rail.address')} action={onReveal && <RevealToggle show={reveal} onToggle={onReveal} />}>
          <Line icon={MapPinHouse} label={t('me.rail.addressLabel')}>{hide(reveal, addressText(me.address), 'address')}</Line>
          <Line icon={MapPin} label={t('me.rail.emergency')}>{emergency.name ? `${emergency.name}${emergency.phone ? ` · ${emergency.phone}` : ''}` : null}</Line>
        </Section>

        <Section title={t('me.rail.employeeDetails')} action={status}>
          <Line icon={CalendarDays} label={t('me.rail.dob')}>{hide(reveal, me.dob ? date(me.dob) : null, 'date')}</Line>
          <Line icon={Briefcase} label={t('me.rail.jobTitle')}>{me.designation}</Line>
          <Line icon={Building2} label={t('me.rail.department')}>{me.department}</Line>
          <Line icon={Users} label={t('me.rail.reportsTo')}>{me.manager?.name}</Line>
          <Line icon={CalendarCheck2} label={t('me.rail.joined')}>{me.joiningDate ? date(me.joiningDate) : null}</Line>
          <Line icon={UserRound} label={t('me.rail.category')}>{me.category ? L.category(me.category) : null}</Line>
          {me.branch && <Line icon={School} label={t('me.rail.campus')}>{me.branch}</Line>}
        </Section>
      </div>
    </aside>
  )
}
