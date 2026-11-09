import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, RefreshCw, ShieldCheck } from 'lucide-react'
import { PageContainer, SectionCard, SkeletonRows, Tabs } from '../../components/system'
import Button from '../../components/ui/Button'
import useAuthUser from '../../hooks/useAuthUser'
import { fetchMyApprovals, fetchMyLeave, fetchMyReviews } from '../../api/hrms'
import { fetchMyPayslips } from '../../api/payroll'
import { fetchMyTeaching } from '../../api/homework'
import { hasPermission, syncCurrentUser } from '../../api/auth'
import IdentityRail from './IdentityRail'
import OverviewTab from './OverviewTab'
import TeachingTab, { MY_TEACHING } from './TeachingTab'
import AccountTab from './AccountTab'
import PayslipsTab from './PayslipsTab'
import { ME_HR, MyApprovalsTab, MyAttendanceTab, MyLeaveTab, MyProfileTab, MyReviewsTab, useMyHrRecord } from './HrTabs'
import { isQuietError } from './shared'

/**
 * Everything a member of staff has of their own, laid out as a record (as the hospital workspace):
 * who you are down the left, and whichever part of it you asked for on the right.
 *
 * Outside every module gate — every call behind it is scoped by the server to the signed-in login.
 * Teaching (lessons, homework to check, my classes against the year plan) shows for anyone who
 * works with Homework & lessons; leave, attendance, pay and reviews once the login is linked to a
 * staff record (Staff & HR). Account & security is always there.
 */

const TABS = ['overview', 'teaching', 'leave', 'attendance', 'payslips', 'approvals', 'reviews', 'profile', 'account']
/** Other names a link may use for a tab (`/me?tab=…`). */
const TAB_ALIAS = { lessons: 'teaching', homework: 'teaching', classes: 'teaching', details: 'profile', security: 'account', password: 'account', sessions: 'account' }
const PAYSLIPS = [...ME_HR, 'payslips']

export default function MyWorkspace() {
  const { t } = useTranslation('me')
  const { t: th } = useTranslation('hrms')
  const user = useAuthUser()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [action, setAction] = useState(null) // a quick action from the overview: 'plan' | 'homework' (teaching), 'apply' (leave)
  const [reveal, setReveal] = useState(false) // address and date of birth start half-hidden

  const asked = params.get('tab') || 'overview'
  const wanted = TAB_ALIAS[asked] ?? asked
  const setTab = (to, next = null) => {
    setAction(next)
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (to === 'overview') n.delete('tab'); else n.set('tab', to)
      return n
    }, { replace: true })
  }
  const clearAction = useCallback(() => setAction(null), [])

  const modules = user?.enabledModules ?? []
  const staff = !!user && !user.superadmin
  const hrOn = staff && modules.includes('hrms')
  const teaches = staff && modules.includes('homework')
    && ['homework.lesson-plans.view', 'homework.homework.view', 'homework.syllabus.view'].some((p) => hasPermission(p))

  // the staff record first: leave, pay and reviews only make sense once the login is linked to one
  const record = useMyHrRecord(hrOn)
  const linked = hrOn && !!record.data
  const payrollOn = linked && modules.includes('payroll')
  const on = { enabled: linked, retry: false }
  const teaching = useQuery({ queryKey: MY_TEACHING, queryFn: fetchMyTeaching, enabled: teaches, retry: false })
  const leave = useQuery({ queryKey: [...ME_HR, 'leave'], queryFn: fetchMyLeave, ...on })
  const approvals = useQuery({ queryKey: [...ME_HR, 'approvals'], queryFn: fetchMyApprovals, ...on })
  const reviews = useQuery({ queryKey: [...ME_HR, 'reviews'], queryFn: fetchMyReviews, ...on })
  const pay = useQuery({ queryKey: PAYSLIPS, queryFn: fetchMyPayslips, enabled: payrollOn, retry: false })

  const fetching = useIsFetching({ queryKey: ME_HR }) + useIsFetching({ queryKey: MY_TEACHING })
  const refresh = () => {
    syncCurrentUser()
    qc.invalidateQueries({ queryKey: ME_HR })
    qc.invalidateQueries({ queryKey: MY_TEACHING })
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const pending = (hrOn && record.isPending) || (teaches && teaching.isPending)
  const hasTeam = (approvals.data?.length ?? 0) > 0 || (record.data?.reports ?? 0) > 0
  const hasReviews = (reviews.data?.mine?.length ?? 0) + (reviews.data?.team?.length ?? 0) > 0
  // show a tab only when it has something for this person
  const visible = new Set([
    'overview', teaches && 'teaching',
    linked && 'leave', linked && 'attendance', payrollOn && 'payslips', linked && hasTeam && 'approvals', linked && hasReviews && 'reviews', linked && 'profile',
    'account',
  ].filter(Boolean))
  const label = (x) => (['leave', 'attendance', 'payslips', 'approvals', 'reviews', 'profile'].includes(x)
    ? th(`hrms.me.tabs.${x}`, { count: approvals.data?.length ?? 0 })
    : t(`me.workspace.tabs.${x}`))
  const tabs = TABS.filter((x) => visible.has(x)).map((x) => ({ value: x, label: label(x) }))
  // a deep link to a tab still loading waits for it rather than bouncing to Overview
  const stillLoading = pending || (linked && [approvals, reviews].some((q) => q.isPending && q.fetchStatus !== 'idle'))
  const tab = visible.has(wanted) ? wanted : stillLoading ? wanted : 'overview'

  // nothing of their own to show: say why (no staff record, Staff & HR off, the platform owner)
  const errText = (e) => e?.response?.data?.message || e?.message
  const nothing = !pending && !teaches && !linked
  const blocked = !nothing ? null
    : user?.superadmin ? t('me.workspace.blockedOwner')
      : !hrOn ? t('me.workspace.blockedHrOff')
        : record.error && !isQuietError(record.error) ? t('me.workspace.loadFailed', { error: errText(record.error) })
          : t('me.workspace.notLinked')
  const quietBlock = !hrOn || !record.error || isQuietError(record.error)

  return (
    <PageContainer wide>
      <div className="flex flex-col lg:flex-row lg:gap-8">
        {/* --------------------------------------------------------------- left rail */}
        <div className="lg:w-[292px] shrink-0 lg:border-e lg:border-border lg:pe-8 lg:sticky lg:top-6 lg:self-start mb-4 lg:mb-0 min-w-0">
          <IdentityRail me={record.data ?? null} user={user} teaching={teaching.data} loading={hrOn && record.isPending}
            reveal={reveal} onReveal={linked ? () => setReveal((v) => !v) : undefined} />
        </div>

        {/* --------------------------------------------------------------- record */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <div className="flex items-end gap-2 sm:gap-4 min-w-0">
            <Tabs tabs={tabs} value={tab} onChange={(x) => setTab(x)} className="flex-1 min-w-0" />
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} loading={fetching > 0}
              className="mb-1 shrink-0 max-sm:h-11 max-sm:w-11 max-sm:px-0" title={t('me.workspace.refresh')} aria-label={t('me.workspace.refresh')} />
          </div>

          {tab !== 'account' && pending && <Loading label={t('me.workspace.loadingRecord')} />}

          {tab !== 'account' && nothing && (
            <SectionCard icon={LayoutGrid} title={t('me.workspace.title')}>
              <p className="text-sm text-ink-muted">{blocked}</p>
              <p className="text-sm text-ink-faint mt-2">{quietBlock ? t('me.workspace.askHr') : t('me.workspace.tryLater')}</p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" variant="secondary" icon={ShieldCheck} onClick={() => setTab('account')}>{t('me.workspace.tabs.account')}</Button>
                {!quietBlock && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>{t('me.workspace.tryAgain')}</Button>}
              </div>
            </SectionCard>
          )}

          {tab === 'overview' && !pending && !nothing && (
            <OverviewTab
              teaching={teaches ? teaching.data ?? null : null}
              record={linked ? record.data : null}
              leave={linked ? leave.data ?? null : null}
              payslips={payrollOn ? pay.data?.payslips ?? [] : null}
              approvals={linked ? approvals.data ?? [] : []}
              loading={fetching > 0}
              onGoto={setTab}
              onPlan={() => setTab('teaching', 'plan')}
              onSetHomework={() => setTab('teaching', 'homework')}
            />
          )}
          {tab === 'teaching' && visible.has('teaching') && <TeachingTab action={action} onActionDone={clearAction} />}
          {tab === 'leave' && visible.has('leave') && <MyLeaveTab applyOpen={action === 'apply'} onApplyClose={clearAction} />}
          {tab === 'attendance' && visible.has('attendance') && <MyAttendanceTab />}
          {tab === 'payslips' && visible.has('payslips') && <PayslipsTab />}
          {tab === 'approvals' && visible.has('approvals') && <MyApprovalsTab />}
          {tab === 'reviews' && visible.has('reviews') && <MyReviewsTab />}
          {tab === 'profile' && visible.has('profile') && <MyProfileTab />}
          {!pending && !visible.has(tab) && tab !== 'overview' && <Loading label={t('me.workspace.loadingRecord')} />}
          {tab === 'account' && <AccountTab me={user} />}
        </div>
      </div>
    </PageContainer>
  )
}

/** A tab still on its way: a few quiet placeholder rows in a plain card (the words for screen readers). */
function Loading({ label }) {
  return (
    <div className="rounded-xl border border-border bg-surface py-3">
      <span className="sr-only" role="status">{label}</span>
      <SkeletonRows rows={4} />
    </div>
  )
}
