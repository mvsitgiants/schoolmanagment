import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  BellRing, BookOpen, Briefcase, Building2, CalendarCheck2, CalendarDays, CalendarOff, GraduationCap, HeartPulse, Mail, MessageSquare, Phone,
  School, ShieldCheck, Timer, UserRound, Users, UsersRound, Palmtree,
} from 'lucide-react'
import { EMPLOYEE_STATUSES } from '@schoolgiant/shared'
import { Avatar, CodeBadge, Panel, StatCard, StatusPill } from '../system'
import Button from '../ui/Button'
import { CallModal } from '../comms/CallComposer'
import { openDirectChat } from '../../api/comms'
import { fetchEmployeeLeave, fetchStaffMonth } from '../../api/hrms'
import { hasPermission } from '../../api/auth'
import { useSnackbar } from '../../context/SnackbarContext'
import { useFormat } from '../../context/SettingsContext'
import { useHrLabels } from './HrKit'
import { getFormatConfig } from '../../utils/format'

// A staff member's profile, as My workspace shows your own: who they are and how to reach them on the left
// (always on screen), the numbers that matter at a glance on the Overview tab.

function Line({ icon: Icon, label, children }) {
  const empty = children == null || children === '' || children === false
  return (
    <div className="flex items-baseline gap-2.5 text-[13px] min-w-0">
      {Icon && <Icon className="w-3.5 h-3.5 text-ink-faint shrink-0 translate-y-0.5" />}
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className={empty ? 'ms-auto text-ink-faint' : 'ms-auto text-ink font-medium min-w-0 text-end break-words'}>{empty ? '—' : children}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-2">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

/** Four round contact buttons: chat, call bell, phone, email — each only when it can work. */
function Contact({ emp }) {
  const { t } = useTranslation('hrms')
  const navigate = useNavigate()
  const { showError } = useSnackbar()
  const [ringing, setRinging] = useState(false)
  const userId = emp.login?.active ? emp.login.id : null
  const canChat = !!userId && hasPermission('comms.chat.create')
  const canRing = !!userId && hasPermission('comms.calls.create')
  const chat = useMutation({ mutationFn: () => openDirectChat(userId), onSuccess: (c) => navigate(`/comms/chat/${c.id}`), onError: (e) => showError(e.message) })
  const items = [
    { key: 'message', icon: MessageSquare, label: t('hrms.profile.contact.message'), on: canChat, onClick: () => chat.mutate(), tone: 'bg-brand-50 text-brand-700 hover:bg-brand-100' },
    { key: 'ring', icon: BellRing, label: t('hrms.profile.contact.ring'), on: canRing, onClick: () => setRinging(true), tone: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
    { key: 'call', icon: Phone, label: t('hrms.profile.contact.call'), on: !!emp.mobile, href: `tel:${emp.mobile}`, tone: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
    { key: 'email', icon: Mail, label: t('hrms.profile.contact.email'), on: !!emp.email, href: `mailto:${emp.email}`, tone: 'bg-sky-50 text-sky-700 hover:bg-sky-100' },
  ]
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        {items.map((it) => {
          const cls = `flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition ${it.on ? it.tone : 'bg-black/[0.03] text-ink-faint cursor-not-allowed'}`
          const inner = <><it.icon className="w-4 h-4" />{it.label}</>
          if (it.href && it.on) return <a key={it.key} href={it.href} className={cls}>{inner}</a>
          return <button key={it.key} type="button" disabled={!it.on || (it.key === 'message' && chat.isPending)} onClick={it.onClick} className={cls} title={it.on ? it.label : t('hrms.profile.contact.noLogin')}>{inner}</button>
        })}
      </div>
      {canRing && <CallModal open={ringing} onClose={() => setRinging(false)} onSent={() => setRinging(false)} person={{ id: userId, name: emp.name, designation: emp.designation }} />}
    </>
  )
}

/** Left rail: initials, name, job, code, status, contact buttons, then the facts in three short sections. */
export function StaffRail({ emp, loginPanel }) {
  const { t } = useTranslation('hrms')
  const L = useHrLabels()
  const navigate = useNavigate()
  const { date } = useFormat()
  const em = emp.emergencyContact ?? {}
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={emp.name} size={60} soft />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold text-ink leading-tight break-words">{emp.name}</h1>
            <p className="text-[13px] text-ink-muted mt-0.5 break-words">{[emp.designation, emp.department].filter(Boolean).join(' · ')}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <CodeBadge>{emp.employeeCode}</CodeBadge>
              <StatusPill tone={EMPLOYEE_STATUSES[emp.status]?.tone}>{L.status(emp.status)}</StatusPill>
            </div>
          </div>
        </div>
        <Contact emp={emp} />
        <Section title={t('hrms.profile.rail.contact')}>
          <Line icon={Phone} label={t('hrms.employees.mobile')}>{emp.mobile && <span className="font-mono-num">{emp.mobile}</span>}</Line>
          <Line icon={Mail} label={t('hrms.employees.email')}>{emp.email}</Line>
          <Line icon={School} label={t('hrms.employees.branch')}>{emp.branch}</Line>
        </Section>
        <Section title={t('hrms.profile.rail.job')}>
          <Line icon={Building2} label={t('hrms.profile.rail.department')}>{emp.department}</Line>
          <Line icon={UserRound} label={t('hrms.profile.rail.category')}>{L.category(emp.category)}</Line>
          <Line icon={Briefcase} label={t('hrms.employees.employmentType')}>{L.employment(emp.employmentType)}</Line>
          <Line icon={CalendarCheck2} label={t('hrms.employees.joiningDate')}>{emp.joiningDate && date(emp.joiningDate)}</Line>
          {emp.confirmationDate && <Line icon={ShieldCheck} label={t('hrms.employees.confirmationDate')}>{date(emp.confirmationDate)}</Line>}
          <Line icon={Users} label={t('hrms.employees.manager')}>{emp.manager && <button type="button" className="text-brand-700 hover:underline" onClick={() => navigate(`/hrms/employees/${emp.manager.id}`)}>{emp.manager.name}</button>}</Line>
          <Line icon={CalendarOff} label={t('hrms.employees.weeklyOff')}>{emp.weeklyOffDays?.length ? emp.weeklyOffDays.map(L.day).join(', ') : t('hrms.profile.usualOff')}</Line>
        </Section>
        <Section title={t('hrms.profile.rail.personal')}>
          <Line icon={UserRound} label={t('hrms.employees.gender')}>{emp.gender && t(`hrms.genders.${emp.gender}`)}</Line>
          <Line icon={CalendarDays} label={t('hrms.employees.dob')}>{emp.dob && date(emp.dob)}</Line>
          <Line icon={GraduationCap} label={t('hrms.employees.qualifications')}>{emp.qualifications}</Line>
          <Line icon={Timer} label={t('hrms.profile.rail.experience')}>{emp.experienceYears != null ? t('hrms.profile.years', { count: emp.experienceYears }) : null}</Line>
          <Line icon={BookOpen} label={t('hrms.employees.subjects')}>{emp.subjects?.join(', ')}</Line>
          <Line icon={HeartPulse} label={t('hrms.profile.emergency')}>{em.name ? `${em.name}${em.relation ? ` (${em.relation})` : ''}${em.phone ? ` · ${em.phone}` : ''}` : null}</Line>
        </Section>
        {emp.notes && <p className="text-[13px] text-ink-muted whitespace-pre-line border-t border-border pt-3">{emp.notes}</p>}
      </div>
      {loginPanel}
    </aside>
  )
}

const yearsSince = (ymd, today) => {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

/** Overview tab: service, leave left, this month's attendance, team — then the team as avatar chips. */
export function StaffOverview({ emp }) {
  const { t } = useTranslation('hrms')
  const navigate = useNavigate()
  const { date } = useFormat()
  const [allTeam, setAllTeam] = useState(false)
  // today in the institution's timezone (YYYY-MM-DD)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: getFormatConfig().timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const month = today.slice(0, 7)
  const { data: balances = [] } = useQuery({ queryKey: ['emp-leave', emp.id], queryFn: () => fetchEmployeeLeave(emp.id) })
  const canAtt = hasPermission('hrms.attendance.view')
  const { data: reg } = useQuery({ queryKey: ['staff-month', month], queryFn: () => fetchStaffMonth(month), enabled: canAtt, staleTime: 60_000 })
  const row = reg?.rows?.find((r) => r.employeeId === emp.id)
  const tot = row?.totals ?? {}
  // working days so far: present / on duty count whole, a half day half; holidays and weekly offs don't count
  const worked = (tot.PRESENT ?? 0) + (tot.ON_DUTY ?? 0) + (tot.HALF_DAY ?? 0) / 2
  const due = (tot.PRESENT ?? 0) + (tot.ON_DUTY ?? 0) + (tot.HALF_DAY ?? 0) + (tot.ABSENT ?? 0) + (tot.LEAVE ?? 0) + (tot.unmarked ?? 0)
  const years = yearsSince(emp.joiningDate, today)
  const left = balances.reduce((s, b) => s + (b.balance ?? 0), 0)
  const credited = balances.reduce((s, b) => s + Math.max(0, (b.balance ?? 0) + (b.taken ?? 0)), 0)
  const team = allTeam ? emp.reports : emp.reports.slice(0, 12)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
        <StatCard icon={CalendarCheck2} tone="brand" label={t('hrms.profile.tiles.service')} value={years ?? '—'}
          sub={emp.joiningDate ? t('hrms.profile.tiles.since', { date: date(emp.joiningDate) }) : undefined} />
        <StatCard icon={Palmtree} tone="teal" label={t('hrms.profile.tiles.leaveLeft')} value={balances.length ? left : '—'}
          sub={balances.length ? balances.map((b) => `${b.code} ${b.balance}`).join(' · ') : t('hrms.profile.tiles.noLeave')} progress={credited ? (left / credited) * 100 : undefined} />
        {canAtt && (
          <StatCard icon={CalendarDays} tone={due && worked / due < 0.85 ? 'warning' : 'success'} label={t('hrms.profile.tiles.present')} value={row ? `${worked}/${due}` : '—'}
            sub={row ? t('hrms.profile.tiles.presentSub', { absent: tot.ABSENT ?? 0, leave: tot.LEAVE ?? 0, late: tot.late ?? 0 }) : t('hrms.profile.tiles.noAttendance')} progress={due ? (worked / due) * 100 : undefined} />
        )}
        <StatCard icon={UsersRound} tone="violet" label={t('hrms.profile.tiles.team')} value={emp.reports.length}
          sub={emp.manager ? t('hrms.profile.tiles.reportsTo', { name: emp.manager.name }) : t('hrms.profile.tiles.noManager')} />
      </div>
      {emp.reports.length > 0 && (
        <Panel title={t('hrms.profile.reports', { count: emp.reports.length })} icon={UsersRound}
          actions={emp.reports.length > 12 && <Button size="sm" variant="ghost" onClick={() => setAllTeam(!allTeam)}>{allTeam ? t('hrms.profile.tiles.showLess') : t('hrms.profile.tiles.showAll', { count: emp.reports.length })}</Button>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {team.map((r) => (
              <button key={r.id} type="button" onClick={() => navigate(`/hrms/employees/${r.id}`)} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2 text-start hover:border-brand-300 hover:bg-brand-50/40 transition min-w-0">
                <Avatar name={r.name} size={30} soft />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink truncate">{r.name}</span>
                  <span className="block text-[11px] text-ink-muted truncate">{r.designation}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
