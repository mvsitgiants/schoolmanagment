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

// Academic setup
const AcademicYears = lazy(() => import('./pages/Academics/Years'))
const AcademicClasses = lazy(() => import('./pages/Academics/Classes'))
const AcademicSubjects = lazy(() => import('./pages/Academics/Subjects'))
const AcademicGrading = lazy(() => import('./pages/Academics/Grading'))
const AcademicAllocation = lazy(() => import('./pages/Academics/Allocation'))

// Students
const StudentAdmit = lazy(() => import('./pages/Students/Admit'))
const StudentDirectory = lazy(() => import('./pages/Students/Directory'))
const StudentProfile = lazy(() => import('./pages/Students/Profile'))
const StudentGuardians = lazy(() => import('./pages/Students/Guardians'))
const StudentPromotion = lazy(() => import('./pages/Students/Promotion'))
const StudentTransfer = lazy(() => import('./pages/Students/Transfer'))

// Attendance
const AttendanceMark = lazy(() => import('./pages/Attendance/Mark'))
const AttendanceRegister = lazy(() => import('./pages/Attendance/Register'))
const AttendanceLeave = lazy(() => import('./pages/Attendance/Leave'))
const AttendanceReports = lazy(() => import('./pages/Attendance/Reports'))
// Fees
const FeeStructures = lazy(() => import('./pages/Fees/Structures'))
const FeeCollect = lazy(() => import('./pages/Fees/Collect'))
const FeeInvoices = lazy(() => import('./pages/Fees/Invoices'))
const FeeDues = lazy(() => import('./pages/Fees/Dues'))
const FeeConcessions = lazy(() => import('./pages/Fees/Concessions'))
const FeeRefunds = lazy(() => import('./pages/Fees/Refunds'))
const FeeDayEnd = lazy(() => import('./pages/Fees/DayEnd'))
const FeeOnline = lazy(() => import('./pages/Fees/Online'))
// Exams
const ExamSchedule = lazy(() => import('./pages/Exams/Schedule'))
const ExamHallTickets = lazy(() => import('./pages/Exams/HallTickets'))
const AnalyticsAcademics = lazy(() => import('./pages/Analytics/Academics'))
const AnalyticsFees = lazy(() => import('./pages/Analytics/Fees'))
const AnalyticsCampuses = lazy(() => import('./pages/Analytics/Campuses'))
const AiAssistant = lazy(() => import('./pages/Ai/Assistant'))
const AiQuestionPapers = lazy(() => import('./pages/Ai/QuestionPapers'))
const AiRemarks = lazy(() => import('./pages/Ai/Remarks'))
const IntPayments = lazy(() => import('./pages/Integrations/Payments'))
const IntMessaging = lazy(() => import('./pages/Integrations/Messaging'))
const IntDevices = lazy(() => import('./pages/Integrations/Devices'))
const IntLogs = lazy(() => import('./pages/Integrations/Logs'))
const ProgPrograms = lazy(() => import('./pages/Programs/Programs'))
const ProgOutcomes = lazy(() => import('./pages/Programs/Outcomes'))
const ProgAttainment = lazy(() => import('./pages/Programs/Attainment'))
const RegWindows = lazy(() => import('./pages/Registration/Windows'))
const RegRequests = lazy(() => import('./pages/Registration/Requests'))
const CoeMarks = lazy(() => import('./pages/Coe/Marks'))
const CoeRevaluation = lazy(() => import('./pages/Coe/Revaluation'))
const CoeGradeCards = lazy(() => import('./pages/Coe/GradeCards'))
const ExamSeating = lazy(() => import('./pages/Exams/Seating'))
const ExamQuestionPapers = lazy(() => import('./pages/Exams/QuestionPapers'))
const ExamMarks = lazy(() => import('./pages/Exams/Marks'))
const ExamResults = lazy(() => import('./pages/Exams/Results'))
const ExamReportCards = lazy(() => import('./pages/Exams/ReportCards'))
const ExamSetup = lazy(() => import('./pages/Exams/Setup'))
// Homework & lessons
const HomeworkPage = lazy(() => import('./pages/Homework/Homework'))
const LessonPlans = lazy(() => import('./pages/Homework/LessonPlans'))
const SyllabusTracker = lazy(() => import('./pages/Homework/Syllabus'))
// Certificates
const CertificateIssue = lazy(() => import('./pages/Certificates/Issue'))
const CertificateRegister = lazy(() => import('./pages/Certificates/Register'))
const VerifyCertificate = lazy(() => import('./pages/Public/VerifyCertificate'))
const VerifyStudent = lazy(() => import('./pages/Public/VerifyStudent'))
const PublicApply = lazy(() => import('./pages/Public/Apply'))
// Admissions
const AdmEnquiries = lazy(() => import('./pages/Admissions/Enquiries'))
const AdmApplications = lazy(() => import('./pages/Admissions/Applications'))
const AdmTests = lazy(() => import('./pages/Admissions/Tests'))
const AdmMerit = lazy(() => import('./pages/Admissions/Merit'))
const AdmSettings = lazy(() => import('./pages/Admissions/Settings'))
// Timetable
const TimetablePage = lazy(() => import('./pages/Timetable/Timetable'))
const TtSubstitutions = lazy(() => import('./pages/Timetable/Substitutions'))
const TtRooms = lazy(() => import('./pages/Timetable/Rooms'))
// Staff & HR
const HrEmployees = lazy(() => import('./pages/Hrms/Employees'))
const HrEmployeeProfile = lazy(() => import('./pages/Hrms/EmployeeProfile'))
const HrAttendance = lazy(() => import('./pages/Hrms/Attendance'))
const HrLeave = lazy(() => import('./pages/Hrms/Leave'))
const HrHolidays = lazy(() => import('./pages/Hrms/Holidays'))
const HrHiring = lazy(() => import('./pages/Hrms/Hiring'))
const HrPerformance = lazy(() => import('./pages/Hrms/Performance'))
// Payroll
const PayStructures = lazy(() => import('./pages/Payroll/Structures'))
const PayStatutory = lazy(() => import('./pages/Payroll/Statutory'))
const PayLoans = lazy(() => import('./pages/Payroll/Loans'))
const PayRuns = lazy(() => import('./pages/Payroll/Runs'))
const PayPayslips = lazy(() => import('./pages/Payroll/Payslips'))
const PayExports = lazy(() => import('./pages/Payroll/Exports'))
// Accounts
const FinAccounts = lazy(() => import('./pages/Finance/Accounts'))
const FinJournals = lazy(() => import('./pages/Finance/Journals'))
const FinExpenses = lazy(() => import('./pages/Finance/Expenses'))
const FinBank = lazy(() => import('./pages/Finance/Bank'))
const FinReports = lazy(() => import('./pages/Finance/Reports'))
// LMS
const LmsCourses = lazy(() => import('./pages/Lms/Courses'))
const LmsLive = lazy(() => import('./pages/Lms/LiveClasses'))
const LmsQuestions = lazy(() => import('./pages/Lms/QuestionBank'))
// Online tests
const OtTests = lazy(() => import('./pages/OnlineTests/Tests'))
const OtAttempts = lazy(() => import('./pages/OnlineTests/Attempts'))
const TrRoutes = lazy(() => import('./pages/Transport/Routes'))
const TrVehicles = lazy(() => import('./pages/Transport/Vehicles'))
const TrAssignments = lazy(() => import('./pages/Transport/Assignments'))
const TrTracking = lazy(() => import('./pages/Transport/Tracking'))
const LibCatalogue = lazy(() => import('./pages/Library/Catalogue'))
const LibCirculation = lazy(() => import('./pages/Library/Circulation'))
const LibFines = lazy(() => import('./pages/Library/Fines'))
const EvCalendar = lazy(() => import('./pages/Events/Calendar'))
const EvPtm = lazy(() => import('./pages/Events/Ptm'))
const EvGallery = lazy(() => import('./pages/Events/Gallery'))
const StudentIdCards = lazy(() => import('./pages/Students/IdCards'))
// Dashboard & reports
const CommandCentre = lazy(() => import('./pages/Dashboard/Command'))
const ReportLibrary = lazy(() => import('./pages/Reports/Library'))
const ReportBuilder = lazy(() => import('./pages/Reports/Builder'))
// Parent & student app
const FamilyApp = lazy(() => import('./pages/Family/FamilyApp'))
const PortalSettings = lazy(() => import('./pages/Portal/Settings'))
const PortalContent = lazy(() => import('./pages/Portal/Content'))
// Communication hub
const CommNotices = lazy(() => import('./pages/Communication/Notices'))
const CommMessages = lazy(() => import('./pages/Communication/Messages'))
const CommChat = lazy(() => import('./pages/Communication/Chat'))
const CommLog = lazy(() => import('./pages/Communication/Log'))

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
        <Route path="/verify/student/:code" element={<VerifyStudent />} />
        <Route path="/apply/:slug" element={<PublicApply />} />
        <Route path="/apply/:slug/status" element={<PublicApply track />} />
        <Route path="/verify/:code" element={<VerifyCertificate />} />
        <Route path="/app/:slug/*" element={<FamilyApp />} />

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
          <Route path="academics" element={<Navigate to="/academics/classes" replace />} />
          <Route path="academics/years" element={<AcademicYears />} />
          <Route path="academics/classes" element={<AcademicClasses />} />
          <Route path="academics/subjects" element={<AcademicSubjects />} />
          <Route path="academics/grading" element={<AcademicGrading />} />
          <Route path="academics/allocation" element={<AcademicAllocation />} />
          <Route path="students" element={<Navigate to="/students/directory" replace />} />
          <Route path="students/admit" element={<StudentAdmit />} />
          <Route path="students/directory" element={<StudentDirectory />} />
          <Route path="students/profile" element={<StudentProfile />} />
          <Route path="students/profile/:id" element={<StudentProfile />} />
          <Route path="students/guardians" element={<StudentGuardians />} />
          <Route path="students/promotion" element={<StudentPromotion />} />
          <Route path="students/transfer" element={<StudentTransfer />} />
          <Route path="students/id-cards" element={<StudentIdCards />} />
          <Route path="admissions" element={<Navigate to="/admissions/enquiries" replace />} />
          <Route path="admissions/enquiries" element={<AdmEnquiries />} />
          <Route path="admissions/applications" element={<AdmApplications />} />
          <Route path="admissions/tests" element={<AdmTests />} />
          <Route path="admissions/merit" element={<AdmMerit />} />
          <Route path="admissions/settings" element={<AdmSettings />} />
          <Route path="timetable" element={<Navigate to="/timetable/timetable" replace />} />
          <Route path="timetable/timetable" element={<TimetablePage />} />
          <Route path="timetable/substitutions" element={<TtSubstitutions />} />
          <Route path="timetable/rooms" element={<TtRooms />} />
          <Route path="hrms" element={<Navigate to="/hrms/employees" replace />} />
          <Route path="hrms/employees" element={<HrEmployees />} />
          <Route path="hrms/employees/:id" element={<HrEmployeeProfile />} />
          <Route path="hrms/attendance" element={<HrAttendance />} />
          <Route path="hrms/leave" element={<HrLeave />} />
          <Route path="hrms/holidays" element={<HrHolidays />} />
          <Route path="hrms/hiring" element={<HrHiring />} />
          <Route path="hrms/performance" element={<HrPerformance />} />
          <Route path="payroll" element={<Navigate to="/payroll/runs" replace />} />
          <Route path="payroll/structures" element={<PayStructures />} />
          <Route path="payroll/statutory" element={<PayStatutory />} />
          <Route path="payroll/loans" element={<PayLoans />} />
          <Route path="payroll/runs" element={<PayRuns />} />
          <Route path="payroll/payslips" element={<PayPayslips />} />
          <Route path="payroll/exports" element={<PayExports />} />
          <Route path="finance" element={<Navigate to="/finance/journals" replace />} />
          <Route path="finance/accounts" element={<FinAccounts />} />
          <Route path="finance/journals" element={<FinJournals />} />
          <Route path="finance/expenses" element={<FinExpenses />} />
          <Route path="finance/bank" element={<FinBank />} />
          <Route path="finance/reports" element={<FinReports />} />
          <Route path="lms" element={<Navigate to="/lms/courses" replace />} />
          <Route path="lms/courses" element={<LmsCourses />} />
          <Route path="lms/live-classes" element={<LmsLive />} />
          <Route path="lms/question-bank" element={<LmsQuestions />} />
          <Route path="online-tests" element={<Navigate to="/online-tests/tests" replace />} />
          <Route path="online-tests/tests" element={<OtTests />} />
          <Route path="online-tests/attempts" element={<OtAttempts />} />
          <Route path="transport" element={<Navigate to="/transport/routes" replace />} />
          <Route path="transport/routes" element={<TrRoutes />} />
          <Route path="transport/vehicles" element={<TrVehicles />} />
          <Route path="transport/assignments" element={<TrAssignments />} />
          <Route path="transport/tracking" element={<TrTracking />} />
          <Route path="library" element={<Navigate to="/library/circulation" replace />} />
          <Route path="library/catalogue" element={<LibCatalogue />} />
          <Route path="library/circulation" element={<LibCirculation />} />
          <Route path="library/fines" element={<LibFines />} />
          <Route path="events" element={<Navigate to="/events/calendar" replace />} />
          <Route path="events/calendar" element={<EvCalendar />} />
          <Route path="events/ptm" element={<EvPtm />} />
          <Route path="events/gallery" element={<EvGallery />} />
          <Route path="attendance" element={<Navigate to="/attendance/mark" replace />} />
          <Route path="attendance/mark" element={<AttendanceMark />} />
          <Route path="attendance/register" element={<AttendanceRegister />} />
          <Route path="attendance/leave" element={<AttendanceLeave />} />
          <Route path="attendance/reports" element={<AttendanceReports />} />
          <Route path="fees" element={<Navigate to="/fees/collect" replace />} />
          <Route path="fees/structures" element={<FeeStructures />} />
          <Route path="fees/collect" element={<FeeCollect />} />
          <Route path="fees/invoices" element={<FeeInvoices />} />
          <Route path="fees/dues" element={<FeeDues />} />
          <Route path="fees/concessions" element={<FeeConcessions />} />
          <Route path="fees/refunds" element={<FeeRefunds />} />
          <Route path="fees/day-end" element={<FeeDayEnd />} />
          <Route path="fees/online" element={<FeeOnline />} />
          <Route path="exams" element={<Navigate to="/exams/schedule" replace />} />
          <Route path="exams/schedule" element={<ExamSchedule />} />
          <Route path="exams/hall-tickets" element={<ExamHallTickets />} />
          <Route path="analytics" element={<Navigate to="/analytics/academics" replace />} />
          <Route path="analytics/academics" element={<AnalyticsAcademics />} />
          <Route path="analytics/fees" element={<AnalyticsFees />} />
          <Route path="analytics/campuses" element={<AnalyticsCampuses />} />
          <Route path="ai" element={<Navigate to="/ai/assistant" replace />} />
          <Route path="ai/assistant" element={<AiAssistant />} />
          <Route path="ai/question-papers" element={<AiQuestionPapers />} />
          <Route path="ai/remarks" element={<AiRemarks />} />
          <Route path="integrations" element={<Navigate to="/integrations/payments" replace />} />
          <Route path="integrations/payments" element={<IntPayments />} />
          <Route path="integrations/messaging" element={<IntMessaging />} />
          <Route path="integrations/devices" element={<IntDevices />} />
          <Route path="integrations/logs" element={<IntLogs />} />
          <Route path="programs" element={<Navigate to="/programs/programs" replace />} />
          <Route path="programs/programs" element={<ProgPrograms />} />
          <Route path="programs/outcomes" element={<ProgOutcomes />} />
          <Route path="programs/attainment" element={<ProgAttainment />} />
          <Route path="registration" element={<Navigate to="/registration/windows" replace />} />
          <Route path="registration/windows" element={<RegWindows />} />
          <Route path="registration/requests" element={<RegRequests />} />
          <Route path="coe" element={<Navigate to="/coe/marks" replace />} />
          <Route path="coe/marks" element={<CoeMarks />} />
          <Route path="coe/revaluation" element={<CoeRevaluation />} />
          <Route path="coe/grade-cards" element={<CoeGradeCards />} />
          <Route path="exams/seating" element={<ExamSeating />} />
          <Route path="exams/question-papers" element={<ExamQuestionPapers />} />
          <Route path="exams/marks" element={<ExamMarks />} />
          <Route path="exams/results" element={<ExamResults />} />
          <Route path="exams/report-cards" element={<ExamReportCards />} />
          <Route path="exams/setup" element={<ExamSetup />} />
          <Route path="homework" element={<Navigate to="/homework/homework" replace />} />
          <Route path="homework/homework" element={<HomeworkPage />} />
          <Route path="homework/lesson-plans" element={<LessonPlans />} />
          <Route path="homework/syllabus" element={<SyllabusTracker />} />
          <Route path="certificates" element={<Navigate to="/certificates/issue" replace />} />
          <Route path="certificates/issue" element={<CertificateIssue />} />
          <Route path="certificates/register" element={<CertificateRegister />} />
          <Route path="dashboard" element={<Navigate to="/dashboard/command" replace />} />
          <Route path="dashboard/command" element={<CommandCentre />} />
          <Route path="reports" element={<Navigate to="/reports/library" replace />} />
          <Route path="reports/library" element={<ReportLibrary />} />
          <Route path="reports/builder" element={<ReportBuilder />} />
          <Route path="portal" element={<Navigate to="/portal/settings" replace />} />
          <Route path="portal/settings" element={<PortalSettings />} />
          <Route path="portal/content" element={<PortalContent />} />
          <Route path="communication" element={<Navigate to="/communication/notices" replace />} />
          <Route path="communication/notices" element={<CommNotices />} />
          <Route path="communication/messages" element={<CommMessages />} />
          <Route path="communication/chat" element={<CommChat />} />
          <Route path="communication/log" element={<CommLog />} />
          <Route path=":moduleId/:pageId/*" element={<ModulePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
