import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import AppLayout from './layouts/AppLayout'
import SuperadminLayout from './layouts/SuperadminLayout'
import { SettingsProvider } from './context/SettingsContext'

// Every screen is its own chunk — a teacher never downloads the role designer.
const LoginPage = lazy(() => import('./pages/Auth/LoginPage'))
const SignupPage = lazy(() => import('./pages/Auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./pages/Auth/ForgotPasswordPage'))
const AcceptInvitePage = lazy(() => import('./pages/Auth/AcceptInvitePage'))
const VerifyEmailPage = lazy(() => import('./pages/Auth/VerifyEmailPage'))
const Home = lazy(() => import('./pages/Home/Home'))
const MyWorkspace = lazy(() => import('./pages/Me/MyWorkspace'))

// Administration (core)
const SetupHub = lazy(() => import('./pages/Core/SetupHub'))
const InstitutionProfile = lazy(() => import('./pages/Core/InstitutionProfile'))
const Branches = lazy(() => import('./pages/Core/Branches'))
const Departments = lazy(() => import('./pages/Core/Departments'))
const Users = lazy(() => import('./pages/Core/Users'))
const Roles = lazy(() => import('./pages/Core/Roles'))
const RoleEditor = lazy(() => import('./pages/Core/RoleEditor'))
const RoleCompare = lazy(() => import('./pages/Core/RoleCompare'))
const AllPages = lazy(() => import('./pages/Core/AllPages'))
const Modules = lazy(() => import('./pages/Core/Modules'))
const Subscription = lazy(() => import('./pages/Core/Subscription'))
const AuditLog = lazy(() => import('./pages/Core/AuditLog'))
const NumberSeries = lazy(() => import('./pages/Core/NumberSeries'))
const Settings = lazy(() => import('./pages/Core/Settings'))
const CustomFields = lazy(() => import('./pages/Core/CustomFields'))
const Approvals = lazy(() => import('./pages/Core/Approvals'))
const FormBuilder = lazy(() => import('./pages/Core/Forms'))
const Workflows = lazy(() => import('./pages/Core/Workflows'))
const NotificationSetup = lazy(() => import('./pages/Core/NotificationSetup'))
const CoreMasters = lazy(() => import('./pages/Core/Masters'))
const PrintTemplates = lazy(() => import('./pages/Core/PrintTemplates'))
const ApiKeys = lazy(() => import('./pages/Core/ApiKeys'))

// A module page that isn't built yet shows its catalog entry; unknown paths show NotFound.
const ModulePage = lazy(() => import('./pages/ModulePage'))
const NotFound = lazy(() => import('./pages/NotFound'))

// Platform owner (SchoolGiant team)
const SaDashboard = lazy(() => import('./pages/Superadmin/Dashboard'))
const SaTenants = lazy(() => import('./pages/Superadmin/Tenants'))
const SaTenantDetail = lazy(() => import('./pages/Superadmin/TenantDetail'))
const SaInvoices = lazy(() => import('./pages/Superadmin/Invoices'))
const SaPlans = lazy(() => import('./pages/Superadmin/Plans'))
const SaRoleTemplates = lazy(() => import('./pages/Superadmin/RoleTemplates'))
const SaSettings = lazy(() => import('./pages/Superadmin/Settings'))
const SaCoupons = lazy(() => import('./pages/Superadmin/Coupons'))
const SaStaff = lazy(() => import('./pages/Superadmin/Staff'))
const SaAudit = lazy(() => import('./pages/Superadmin/AuditLog'))

function PageLoading() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading">
      <div className="h-10 w-72 rounded-lg bg-black/5" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-black/5" />)}</div>
      <div className="h-80 rounded-xl bg-black/5" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route path="/superadmin" element={<AuthGuard><SuperadminLayout /></AuthGuard>}>
          <Route index element={<SaDashboard />} />
          <Route path="tenants" element={<SaTenants />} />
          <Route path="tenants/:id" element={<SaTenantDetail />} />
          <Route path="invoices" element={<SaInvoices />} />
          <Route path="plans" element={<SaPlans />} />
          <Route path="role-templates" element={<SaRoleTemplates />} />
          <Route path="coupons" element={<SaCoupons />} />
          <Route path="staff" element={<SaStaff />} />
          <Route path="audit" element={<SaAudit />} />
          <Route path="settings" element={<SaSettings />} />
        </Route>

        <Route element={<AuthGuard><SettingsProvider><AppLayout /></SettingsProvider></AuthGuard>}>
          <Route index element={<Home />} />
          <Route path="me" element={<MyWorkspace />} />
          <Route path="me/*" element={<Navigate to="/me" replace />} />
          <Route path="core" element={<Navigate to="/core/setup" replace />} />
          <Route path="core/setup" element={<SetupHub />} />
          <Route path="core/profile" element={<InstitutionProfile />} />
          <Route path="core/branches" element={<Branches />} />
          <Route path="core/departments" element={<Departments />} />
          <Route path="core/users" element={<Users />} />
          <Route path="core/roles" element={<Roles />} />
          <Route path="core/roles/compare" element={<RoleCompare />} />
          <Route path="core/roles/:id" element={<RoleEditor />} />
          <Route path="core/all-pages" element={<AllPages />} />
          <Route path="core/modules" element={<Modules />} />
          <Route path="core/subscription" element={<Subscription />} />
          <Route path="core/audit" element={<AuditLog />} />
          <Route path="core/numbering" element={<NumberSeries />} />
          <Route path="core/settings" element={<Settings />} />
          <Route path="core/custom-fields" element={<CustomFields />} />
          <Route path="core/workflows" element={<Workflows />} />
          <Route path="core/forms" element={<FormBuilder />} />
          <Route path="core/forms/:id" element={<FormBuilder />} />
          <Route path="core/notifications-setup" element={<NotificationSetup />} />
          <Route path="core/masters" element={<CoreMasters />} />
          <Route path="core/print-templates" element={<PrintTemplates />} />
          <Route path="core/api-keys" element={<ApiKeys />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path=":moduleId/:pageId/*" element={<ModulePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
