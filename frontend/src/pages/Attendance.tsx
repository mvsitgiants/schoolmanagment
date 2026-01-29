import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetAttendanceQuery,
  useMarkAttendanceMutation,
  useUpdateAttendanceMutation,
  Attendance,
} from '../store/slices/attendanceApi';
import {
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

interface AttendanceFormData {
  student: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY';
  remarks?: string;
}

const Attendance: React.FC = () => {
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [search, setSearch] = useState('');

  const { user } = useSelector((state: RootState) => state.auth);
  const { data, isLoading } = useGetAttendanceQuery({
    class: selectedClass,
    section: selectedSection,
    date: selectedDate,
    search,
  });

  const [markAttendance] = useMarkAttendanceMutation();
  const [updateAttendance] = useUpdateAttendanceMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.TEACHER;

  const handleDateChange = (days: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate.toISOString().split('T')[0]);
  };

  const handleStatusChange = async (
    studentId: string,
    currentStatus: string,
    attendanceId?: string
  ) => {
    if (!canModify) return;

    const statusOrder = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'];
    const currentIndex = statusOrder.indexOf(currentStatus);
    const newStatus = statusOrder[(currentIndex + 1) % statusOrder.length];

    try {
      if (attendanceId) {
        await updateAttendance({
          id: attendanceId,
          attendance: {
            status: newStatus,
          },
        }).unwrap();
      } else {
        await markAttendance({
          student: studentId,
          date: selectedDate,
          status: newStatus,
        }).unwrap();
      }
    } catch (error) {
      toast.error('Failed to update attendance');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PRESENT':
        return (
          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
            <CheckIcon className="h-4 w-4 mr-1" />
            Present
          </span>
        );
      case 'ABSENT':
        return (
          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
            <XMarkIcon className="h-4 w-4 mr-1" />
            Absent
          </span>
        );
      case 'LATE':
        return (
          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
            <CalendarIcon className="h-4 w-4 mr-1" />
            Late
          </span>
        );
      case 'HALF_DAY':
        return (
          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">
            <CalendarIcon className="h-4 w-4 mr-1" />
            Half Day
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Attendance</h1>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label
                htmlFor="class"
                className="block text-sm font-medium text-gray-700"
              >
                Class
              </label>
              <select
                id="class"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option value="">Select Class</option>
                {/* Add class options dynamically */}
              </select>
            </div>

            <div>
              <label
                htmlFor="section"
                className="block text-sm font-medium text-gray-700"
              >
                Section
              </label>
              <select
                id="section"
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option value="">Select Section</option>
                {/* Add section options dynamically */}
              </select>
            </div>

            <div>
              <label
                htmlFor="date"
                className="block text-sm font-medium text-gray-700"
              >
                Date
              </label>
              <div className="mt-1 flex rounded-md shadow-sm">
                <button
                  type="button"
                  onClick={() => handleDateChange(-1)}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium rounded-l-md text-gray-700 hover:bg-gray-50"
                >
                  <ChevronLeftIcon className="h-5 w-5" />
                </button>
                <input
                  type="date"
                  id="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1 block w-full rounded-none border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleDateChange(1)}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium rounded-r-md text-gray-700 hover:bg-gray-50"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="search"
                className="block text-sm font-medium text-gray-700"
              >
                Search
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="text"
                  id="search"
                  placeholder="Search students..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 pl-10"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {selectedClass && selectedSection ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Roll Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.students.map((student) => {
                  const attendance = data.attendance.find(
                    (a) => a.student._id === student._id
                  );
                  return (
                    <tr key={student._id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {student.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {student.rollNumber}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() =>
                            handleStatusChange(
                              student._id,
                              attendance?.status || 'ABSENT',
                              attendance?._id
                            )
                          }
                          disabled={!canModify}
                          className={`${
                            canModify ? 'cursor-pointer' : 'cursor-not-allowed'
                          }`}
                        >
                          {getStatusIcon(attendance?.status || 'ABSENT')}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {attendance?.remarks || '-'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            Please select a class and section to view attendance
          </div>
        )}
      </div>

      {data && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Attendance Summary
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-green-800 text-lg font-semibold">Present</div>
              <div className="text-green-600 text-2xl font-bold">
                {data.attendance.filter((a) => a.status === 'PRESENT').length}
              </div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-red-800 text-lg font-semibold">Absent</div>
              <div className="text-red-600 text-2xl font-bold">
                {data.attendance.filter((a) => a.status === 'ABSENT').length}
              </div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-yellow-800 text-lg font-semibold">Late</div>
              <div className="text-yellow-600 text-2xl font-bold">
                {data.attendance.filter((a) => a.status === 'LATE').length}
              </div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="text-orange-800 text-lg font-semibold">
                Half Day
              </div>
              <div className="text-orange-600 text-2xl font-bold">
                {data.attendance.filter((a) => a.status === 'HALF_DAY').length}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance; 