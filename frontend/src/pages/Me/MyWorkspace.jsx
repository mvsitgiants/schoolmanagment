import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PageContainer, PageHeader, Tabs } from '../../components/system'
import useAuthUser from '../../hooks/useAuthUser'
import { fetchMyApprovals, fetchMyReviews } from '../../api/hrms'
import AccountTab from './AccountTab'
import PayslipsTab from './PayslipsTab'
import { HrNotLinked, ME_HR, MyApprovalsTab, MyAttendanceTab, MyLeaveTab, MyProfileTab, MyReviewsTab, useMyHrRecord } from './HrTabs'

/**
 * The signed-in user's own workspace. Account (password, two-step sign-in, devices) for everyone;
 * with Staff & HR on and the login linked to a staff record: leave, attendance, reviews, the team's
 * leave to decide (for a reporting manager) and their own record.
 */
export default function MyWorkspace() {
  const { t } = useTranslation('me')
  const { t: th } = useTranslation('hrms')
  const user = useAuthUser()
  const [params, setParams] = useSearchParams()
  const hrOn = !!user && !user.superadmin && (user.enabledModules ?? []).includes('hrms')
  const record = useMyHrRecord(hrOn)
  const linked = hrOn && !!record.data
  const payrollOn = linked && (user.enabledModules ?? []).includes('payroll')
  const approvals = useQuery({ queryKey: [...ME_HR, 'approvals'], queryFn: fetchMyApprovals, enabled: linked, retry: false })
  const reviews = useQuery({ queryKey: [...ME_HR, 'reviews'], queryFn: fetchMyReviews, enabled: linked, retry: false })
  const hasTeam = (approvals.data?.length ?? 0) > 0 || (record.data?.reports ?? 0) > 0
  const hasReviews = (reviews.data?.mine?.length ?? 0) + (reviews.data?.team?.length ?? 0) > 0
  const tabs = [
    ...(linked ? [
      { value: 'leave', label: th('hrms.me.tabs.leave') },
      { value: 'attendance', label: th('hrms.me.tabs.attendance') },
      ...(payrollOn ? [{ value: 'payslips', label: th('hrms.me.tabs.payslips') }] : []),
      ...(hasTeam ? [{ value: 'approvals', label: th('hrms.me.tabs.approvals', { count: approvals.data?.length ?? 0 }) }] : []),
      ...(hasReviews ? [{ value: 'reviews', label: th('hrms.me.tabs.reviews') }] : []),
      { value: 'profile', label: th('hrms.me.tabs.profile') },
    ] : []),
    { value: 'account', label: t('me.workspace.tabs.account') },
  ]
  const asked = params.get('tab')
  const tab = tabs.some((x) => x.value === asked) ? asked : tabs[0].value
  const setTab = (v) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', v); return n }, { replace: true })
  return (
    <PageContainer>
      <PageHeader title={linked ? th('hrms.me.title') : t('me.workspace.tabs.account')} subtitle={[user?.user?.name, record.data?.designation].filter(Boolean).join(' · ')} />
      {hrOn && !linked && !record.isLoading && <div className="mb-4"><HrNotLinked error={record.error} /></div>}
      {tabs.length > 1 && <Tabs className="mb-4" tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'leave' && <MyLeaveTab />}
      {tab === 'attendance' && <MyAttendanceTab />}
      {tab === 'payslips' && <PayslipsTab />}
      {tab === 'approvals' && <MyApprovalsTab />}
      {tab === 'reviews' && <MyReviewsTab />}
      {tab === 'profile' && <MyProfileTab />}
      {tab === 'account' && <AccountTab me={user} />}
    </PageContainer>
  )
}
