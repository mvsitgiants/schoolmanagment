import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  AcademicCapIcon,
  UserGroupIcon,
  BookOpenIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';
import { useGetNoticesQuery } from '../store/slices/noticeApi';
import { useGetStudentPaymentsQuery } from '../store/slices/paymentApi';
import { useGetStudentGradesQuery } from '../store/slices/examApi';
import { useGetUserBookIssuesQuery } from '../store/slices/bookApi';
import AuthDebug from '../components/common/AuthDebug';

// Extended interface for populated grade data
interface PopulatedGrade {
  _id: string;
  exam: {
    _id: string;
    name: string;
    totalMarks: number;
  };
  student: {
    _id: string;
    name: string;
    rollNumber: string;
  };
  marksObtained: number;
  remarks?: string;
  gradedBy: {
    _id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

const DashboardCard = ({ title, value, icon: Icon, color }: any) => (
  <div className="bg-white overflow-hidden shadow rounded-lg">
    <div className="p-5">
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <Icon className={`h-6 w-6 text-white p-1.5 rounded-full ${color}`} />
        </div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
            <dd className="text-lg font-semibold text-gray-900">{value}</dd>
          </dl>
        </div>
      </div>
    </div>
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  
  // Debug logging
  console.log('Dashboard - User:', user);
  console.log('Dashboard - User Role:', user?.role);

  const { data: notices, error: noticesError, isLoading: noticesLoading } = useGetNoticesQuery({
    limit: 5,
    targetAudience: user?.role,
  }, { skip: !user?.role });
  
  const { data: payments, error: paymentsError, isLoading: paymentsLoading } = useGetStudentPaymentsQuery(
    { studentId: user?._id || '' },
    { skip: user?.role !== UserRole.STUDENT || !user?._id }
  );
  
  const { data: grades, error: gradesError, isLoading: gradesLoading } = useGetStudentGradesQuery(
    { studentId: user?._id || '' },
    { skip: user?.role !== UserRole.STUDENT || !user?._id }
  );
  
  const { data: bookIssues, error: bookIssuesError, isLoading: bookIssuesLoading } = useGetUserBookIssuesQuery(
    undefined,
    { skip: user?.role !== UserRole.STUDENT }
  );

  // Debug API errors
  console.log('API Errors:', { noticesError, paymentsError, gradesError, bookIssuesError });
  console.log('API Loading States:', { noticesLoading, paymentsLoading, gradesLoading, bookIssuesLoading });

  const renderStats = () => {
    console.log('Dashboard - User role for stats:', user?.role);
    console.log('Dashboard - UserRole.SUPER_ADMIN:', UserRole.SUPER_ADMIN);
    switch (user?.role) {
      case UserRole.SUPER_ADMIN:
        return (
          <>
            <DashboardCard
              title="Total Schools"
              value="15"
              icon={AcademicCapIcon}
              color="bg-indigo-500"
            />
            <DashboardCard
              title="System Users"
              value="45,678"
              icon={UserGroupIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="Active Sessions"
              value="1,234"
              icon={CalendarIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="System Revenue"
              value="$234,567"
              icon={CurrencyDollarIcon}
              color="bg-purple-500"
            />
          </>
        );

      case UserRole.ADMIN:
        return (
          <>
            <DashboardCard
              title="Total Students"
              value="1,234"
              icon={UserGroupIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="Total Classes"
              value="24"
              icon={AcademicCapIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="Total Teachers"
              value="45"
              icon={BookOpenIcon}
              color="bg-yellow-500"
            />
            <DashboardCard
              title="School Revenue"
              value="$12,345"
              icon={CurrencyDollarIcon}
              color="bg-purple-500"
            />
          </>
        );

      case UserRole.TEACHER:
        return (
          <>
            <DashboardCard
              title="My Classes"
              value="3"
              icon={AcademicCapIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="My Students"
              value="120"
              icon={UserGroupIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="Upcoming Exams"
              value="2"
              icon={ClipboardDocumentListIcon}
              color="bg-yellow-500"
            />
            <DashboardCard
              title="Study Materials"
              value="15"
              icon={BookOpenIcon}
              color="bg-purple-500"
            />
          </>
        );

      case UserRole.STUDENT:
        return (
          <>
            <DashboardCard
              title="Attendance"
              value="95%"
              icon={CalendarIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="Subjects"
              value="8"
              icon={BookOpenIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="Due Assignments"
              value="3"
              icon={ClipboardDocumentListIcon}
              color="bg-yellow-500"
            />
            <DashboardCard
              title="Books Issued"
              value={bookIssues?.length || 0}
              icon={BookOpenIcon}
              color="bg-purple-500"
            />
          </>
        );

      case UserRole.ACCOUNTANT:
        return (
          <>
            <DashboardCard
              title="Total Collections"
              value="$45,678"
              icon={CurrencyDollarIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="Pending Fees"
              value="$12,345"
              icon={CurrencyDollarIcon}
              color="bg-red-500"
            />
            <DashboardCard
              title="Today's Collections"
              value="$2,345"
              icon={CurrencyDollarIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="Fee Defaulters"
              value="45"
              icon={UserGroupIcon}
              color="bg-yellow-500"
            />
          </>
        );

      case UserRole.LIBRARIAN:
        return (
          <>
            <DashboardCard
              title="Total Books"
              value="5,678"
              icon={BookOpenIcon}
              color="bg-blue-500"
            />
            <DashboardCard
              title="Books Issued"
              value="234"
              icon={BookOpenIcon}
              color="bg-green-500"
            />
            <DashboardCard
              title="Overdue Books"
              value="12"
              icon={BookOpenIcon}
              color="bg-red-500"
            />
            <DashboardCard
              title="Available Books"
              value="5,444"
              icon={BookOpenIcon}
              color="bg-purple-500"
            />
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Debug component - remove this in production */}
      {/* <AuthDebug /> */}
      
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          {user?.role === UserRole.SUPER_ADMIN ? 'System Dashboard' : 
           user?.role === UserRole.ADMIN ? 'School Dashboard' : 'Dashboard'}
        </h1>
        <p className="text-gray-500">
          Welcome back, {user?.name}
          {user?.role === UserRole.SUPER_ADMIN && ' (System Administrator)'}
          {user?.role === UserRole.ADMIN && ' (School Administrator)'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {renderStats()}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Recent Notices
          </h2>
          <div className="space-y-4">
            {noticesLoading && (
              <p className="text-gray-500">Loading notices...</p>
            )}
            {noticesError && (
              <p className="text-red-500">Error loading notices</p>
            )}
            {notices?.notices?.map((notice) => (
              <div
                key={notice._id}
                className="border-l-4 border-indigo-500 pl-4 py-2"
              >
                <h3 className="text-sm font-medium text-gray-900">
                  {notice.title}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{notice.content}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(notice.startDate).toLocaleDateString()}
                </p>
              </div>
            ))}
            {(!notices?.notices || notices.notices.length === 0) && !noticesLoading && !noticesError && (
              <p className="text-gray-500">No recent notices</p>
            )}
          </div>
        </div>

        {user?.role === UserRole.SUPER_ADMIN && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              System Overview
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-900">Schools</h3>
                  <p className="text-2xl font-bold text-blue-600">15</p>
                  <p className="text-xs text-blue-500">Active institutions</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-green-900">Users</h3>
                  <p className="text-2xl font-bold text-green-600">45,678</p>
                  <p className="text-xs text-green-500">Total registered</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-purple-900">Revenue</h3>
                  <p className="text-2xl font-bold text-purple-600">$234K</p>
                  <p className="text-xs text-purple-500">This month</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-yellow-900">Support</h3>
                  <p className="text-2xl font-bold text-yellow-600">23</p>
                  <p className="text-xs text-yellow-500">Open tickets</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {user?.role === UserRole.ADMIN && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              School Overview
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-900">Students</h3>
                  <p className="text-2xl font-bold text-blue-600">1,234</p>
                  <p className="text-xs text-blue-500">Enrolled</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-green-900">Teachers</h3>
                  <p className="text-2xl font-bold text-green-600">45</p>
                  <p className="text-xs text-green-500">Active staff</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-purple-900">Classes</h3>
                  <p className="text-2xl font-bold text-purple-600">24</p>
                  <p className="text-xs text-purple-500">Running</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-yellow-900">Attendance</h3>
                  <p className="text-2xl font-bold text-yellow-600">94%</p>
                  <p className="text-xs text-yellow-500">Today's rate</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {user?.role === UserRole.STUDENT && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              Recent Activities
            </h2>
            <div className="space-y-4">
              {(paymentsLoading || gradesLoading) && (
                <p className="text-gray-500">Loading activities...</p>
              )}
              {(paymentsError || gradesError) && (
                <p className="text-red-500">Error loading activities</p>
              )}
              {payments?.slice(0, 3).map((payment) => (
                <div
                  key={payment._id}
                  className="flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Fee Payment
                    </p>
                    <p className="text-xs text-gray-500">
                      Receipt: {payment.receiptNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      ${payment.amount}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(payment.paymentDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
              {grades?.slice(0, 3).map((grade) => {
                // Check if exam is populated (object) or just an ID (string)
                const isExamPopulated = typeof grade.exam === 'object' && grade.exam !== null;
                const examName = isExamPopulated ? (grade.exam as any).name : 'Unknown Exam';
                const totalMarks = isExamPopulated ? (grade.exam as any).totalMarks : null;
                
                return (
                  <div key={grade._id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {examName}
                      </p>
                      <p className="text-xs text-gray-500">
                        Marks: {grade.marksObtained}/{totalMarks || 'N/A'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        {totalMarks 
                          ? `${((grade.marksObtained / totalMarks) * 100).toFixed(1)}%`
                          : 'N/A'
                        }
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(grade.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                );
              })}
              {(!payments || payments.length === 0) && (!grades || grades.length === 0) && !paymentsLoading && !gradesLoading && !paymentsError && !gradesError && (
                <p className="text-gray-500">No recent activities</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard; 