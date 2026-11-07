import { useTranslation } from 'react-i18next'
import { PageContainer, PageHeader } from '../../components/system'
import useAuthUser from '../../hooks/useAuthUser'
import AccountTab from './AccountTab'

/**
 * The signed-in user's own account: password, two-step sign-in, email check and devices.
 * Outside every module gate — every user needs it. Staff self-service (leave, payslips,
 * attendance) joins this page when the Staff & HR module is built.
 */
export default function MyWorkspace() {
  const { t } = useTranslation('me')
  const user = useAuthUser()
  return (
    <PageContainer>
      <PageHeader title={t('me.workspace.tabs.account')} subtitle={user?.user?.name} />
      <AccountTab me={user} />
    </PageContainer>
  )
}
