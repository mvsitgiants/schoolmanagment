import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetAttendanceReportQuery,
  useGetExamReportQuery,
  useGetFeeReportQuery,
  useGetStudentReportQuery,
} from '../store/slices/reportApi';
import {
  ChartBarIcon,
  DocumentArrowDownIcon,
  FunnelIcon,
  CalendarIcon,
  AcademicCapIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

type ReportType = 'ATTENDANCE' | 'EXAM' | 'FEE' | 'STUDENT';
type DateRange = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'CUSTOM';

interface ReportFilters {
  type: ReportType;
  dateRange: DateRange;
  startDate?: string;
  endDate?: string;
  class?: string;
  section?: string;
}

const Reports: React.FC = () => {
  const [filters, setFilters] = useState<ReportFilters>({
    type: 'ATTENDANCE',
    dateRange: 'THIS_MONTH',
  });

  const { user } = useSelector((state: RootState) => state.auth);

  const { data: attendanceReport } = useGetAttendanceReportQuery(
    filters.type === 'ATTENDANCE' ? filters : undefined,
    { skip: filters.type !== 'ATTENDANCE' }
  );

  const { data: examReport } = useGetExamReportQuery(
    filters.type === 'EXAM' ? filters : undefined,
    { skip: filters.type !== 'EXAM' }
  );

  const { data: feeReport } = useGetFeeReportQuery(
    filters.type === 'FEE' ? filters : undefined,
    { skip: filters.type !== 'FEE' }
  );

  const { data: studentReport } = useGetStudentReportQuery(
    filters.type === 'STUDENT' ? filters : undefined,
    { skip: filters.type !== 'STUDENT' }
  );

  const handleExport = () => {
    // Implement export functionality
    toast.info('Exporting report...');
  };

  const renderDateRangeSelector = () => (
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        <select
          value={filters.dateRange}
          onChange={(e) =>
            setFilters((prev) => ({
              ...prev,
              dateRange: e.target.value as DateRange,
            }))
          }
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        >
          <option value="TODAY">Today</option>
          <option value="THIS_WEEK">This Week</option>
          <option value="THIS_MONTH">This Month</option>
          <option value="THIS_YEAR">This Year</option>
          <option value="CUSTOM">Custom Range</option>
        </select>
      </div>

      {filters.dateRange === 'CUSTOM' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, startDate: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, endDate: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderAttendanceReport = () => {
    if (!attendanceReport) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-green-800 text-lg font-semibold">Present</div>
            <div className="text-green-600 text-2xl font-bold">
              {attendanceReport.presentCount}
            </div>
            <div className="text-green-600">
              {attendanceReport.presentPercentage}%
            </div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <div className="text-red-800 text-lg font-semibold">Absent</div>
            <div className="text-red-600 text-2xl font-bold">
              {attendanceReport.absentCount}
            </div>
            <div className="text-red-600">{attendanceReport.absentPercentage}%</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-yellow-800 text-lg font-semibold">Late</div>
            <div className="text-yellow-600 text-2xl font-bold">
              {attendanceReport.lateCount}
            </div>
            <div className="text-yellow-600">{attendanceReport.latePercentage}%</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg">
            <div className="text-orange-800 text-lg font-semibold">Half Day</div>
            <div className="text-orange-600 text-2xl font-bold">
              {attendanceReport.halfDayCount}
            </div>
            <div className="text-orange-600">
              {attendanceReport.halfDayPercentage}%
            </div>
          </div>
        </div>

        {/* Add attendance trend chart here */}
      </div>
    );
  };

  const renderExamReport = () => {
    if (!examReport) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-blue-800 text-lg font-semibold">
              Total Exams
            </div>
            <div className="text-blue-600 text-2xl font-bold">
              {examReport.totalExams}
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-green-800 text-lg font-semibold">Pass Rate</div>
            <div className="text-green-600 text-2xl font-bold">
              {examReport.passRate}%
            </div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-yellow-800 text-lg font-semibold">
              Average Score
            </div>
            <div className="text-yellow-600 text-2xl font-bold">
              {examReport.averageScore}%
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-purple-800 text-lg font-semibold">
              Top Scorers
            </div>
            <div className="text-purple-600 text-2xl font-bold">
              {examReport.topScorersCount}
            </div>
          </div>
        </div>

        {/* Add exam performance chart here */}
      </div>
    );
  };

  const renderFeeReport = () => {
    if (!feeReport) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-green-800 text-lg font-semibold">
              Total Collection
            </div>
            <div className="text-green-600 text-2xl font-bold">
              ${feeReport.totalCollection}
            </div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <div className="text-red-800 text-lg font-semibold">
              Pending Fees
            </div>
            <div className="text-red-600 text-2xl font-bold">
              ${feeReport.pendingAmount}
            </div>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-blue-800 text-lg font-semibold">
              Collection Rate
            </div>
            <div className="text-blue-600 text-2xl font-bold">
              {feeReport.collectionRate}%
            </div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-yellow-800 text-lg font-semibold">
              Defaulters
            </div>
            <div className="text-yellow-600 text-2xl font-bold">
              {feeReport.defaultersCount}
            </div>
          </div>
        </div>

        {/* Add fee collection trend chart here */}
      </div>
    );
  };

  const renderStudentReport = () => {
    if (!studentReport) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-blue-800 text-lg font-semibold">
              Total Students
            </div>
            <div className="text-blue-600 text-2xl font-bold">
              {studentReport.totalStudents}
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-green-800 text-lg font-semibold">
              New Admissions
            </div>
            <div className="text-green-600 text-2xl font-bold">
              {studentReport.newAdmissions}
            </div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <div className="text-red-800 text-lg font-semibold">
              Withdrawals
            </div>
            <div className="text-red-600 text-2xl font-bold">
              {studentReport.withdrawals}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-purple-800 text-lg font-semibold">
              Gender Ratio
            </div>
            <div className="text-purple-600 text-2xl font-bold">
              {studentReport.genderRatio}
            </div>
          </div>
        </div>

        {/* Add student demographics chart here */}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          Reports & Analytics
        </h1>
        <button
          onClick={handleExport}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
        >
          <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
          Export Report
        </button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Report Type
              </label>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, type: 'ATTENDANCE' }))
                  }
                  className={`p-2 flex flex-col items-center justify-center rounded-md border ${
                    filters.type === 'ATTENDANCE'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CalendarIcon className="h-6 w-6 mb-1" />
                  <span className="text-sm">Attendance</span>
                </button>
                <button
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, type: 'EXAM' }))
                  }
                  className={`p-2 flex flex-col items-center justify-center rounded-md border ${
                    filters.type === 'EXAM'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <AcademicCapIcon className="h-6 w-6 mb-1" />
                  <span className="text-sm">Exam</span>
                </button>
                <button
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, type: 'FEE' }))
                  }
                  className={`p-2 flex flex-col items-center justify-center rounded-md border ${
                    filters.type === 'FEE'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CurrencyDollarIcon className="h-6 w-6 mb-1" />
                  <span className="text-sm">Fee</span>
                </button>
                <button
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, type: 'STUDENT' }))
                  }
                  className={`p-2 flex flex-col items-center justify-center rounded-md border ${
                    filters.type === 'STUDENT'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <UserGroupIcon className="h-6 w-6 mb-1" />
                  <span className="text-sm">Student</span>
                </button>
              </div>
            </div>

            <div>{renderDateRangeSelector()}</div>
          </div>
        </div>

        <div className="p-6">
          {filters.type === 'ATTENDANCE' && renderAttendanceReport()}
          {filters.type === 'EXAM' && renderExamReport()}
          {filters.type === 'FEE' && renderFeeReport()}
          {filters.type === 'STUDENT' && renderStudentReport()}
        </div>
      </div>
    </div>
  );
};

export default Reports; 