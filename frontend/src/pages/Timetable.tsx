import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetTimetablesQuery,
  useCreateTimetableMutation,
  useUpdateTimetableMutation,
  useDeleteTimetableMutation,
  Timetable,
} from '../store/slices/timetableApi';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface TimetableFormData {
  class: string;
  section: string;
  dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
  startTime: string;
  endTime: string;
  subject: string;
  teacher: string;
  room: string;
}

const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00'
];

const Timetables: React.FC = () => {
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTimetable, setSelectedTimetable] = useState<Partial<Timetable> | null>(null);
  const [formData, setFormData] = useState<TimetableFormData>({
    class: '',
    section: '',
    dayOfWeek: 'MONDAY',
    startTime: '08:00',
    endTime: '09:00',
    subject: '',
    teacher: '',
    room: '',
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data: timetables, isLoading } = useGetTimetablesQuery({
    class: selectedClass,
    section: selectedSection,
  });

  const [createTimetable] = useCreateTimetableMutation();
  const [updateTimetable] = useUpdateTimetableMutation();
  const [deleteTimetable] = useDeleteTimetableMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.TEACHER;

  const handleAdd = () => {
    setSelectedTimetable(null);
    setFormData({
      class: selectedClass,
      section: selectedSection,
      dayOfWeek: 'MONDAY',
      startTime: '08:00',
      endTime: '09:00',
      subject: '',
      teacher: '',
      room: '',
    });
    setIsModalOpen(true);
  };

  const handleEdit = (timetable: Timetable) => {
    setSelectedTimetable(timetable);
    setFormData({
      class: timetable.class._id,
      section: timetable.section,
      dayOfWeek: timetable.dayOfWeek,
      startTime: timetable.startTime,
      endTime: timetable.endTime,
      subject: timetable.subject._id,
      teacher: timetable.teacher._id,
      room: timetable.room,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this schedule?')) {
      try {
        await deleteTimetable(id).unwrap();
        toast.success('Schedule deleted successfully');
      } catch (error) {
        toast.error('Failed to delete schedule');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedTimetable?._id) {
        await updateTimetable({
          id: selectedTimetable._id,
          timetable: formData,
        }).unwrap();
        toast.success('Schedule updated successfully');
      } else {
        await createTimetable(formData).unwrap();
        toast.success('Schedule created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedTimetable?._id
          ? 'Failed to update schedule'
          : 'Failed to create schedule'
      );
    }
  };

  const groupTimetablesByDay = () => {
    const grouped: Record<string, Timetable[]> = {};
    DAYS_OF_WEEK.forEach(day => {
      grouped[day] = [];
    });

    timetables?.timetables.forEach(timetable => {
      grouped[timetable.dayOfWeek].push(timetable);
    });

    return grouped;
  };

  const renderTimeSlot = (day: string, time: string) => {
    const schedule = timetables?.timetables.find(
      t => t.dayOfWeek === day && t.startTime === time
    );

    if (!schedule) return <td className="border p-2"></td>;

    return (
      <td className="border p-2">
        <div className="bg-white rounded-lg shadow p-2">
          <div className="font-medium text-gray-900">{schedule.subject.name}</div>
          <div className="text-sm text-gray-500">{schedule.teacher.name}</div>
          <div className="text-xs text-gray-400">Room: {schedule.room}</div>
          {canModify && (
            <div className="mt-2 flex justify-end space-x-2">
              <button
                onClick={() => handleEdit(schedule)}
                className="text-indigo-600 hover:text-indigo-900"
              >
                <PencilIcon className="h-4 w-4" />
              </button>
              {user?.role === UserRole.SUPER_ADMIN && (
                <button
                  onClick={() => handleDelete(schedule._id)}
                  className="text-red-600 hover:text-red-900"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Timetable</h1>
        {canModify && selectedClass && selectedSection && (
          <button
            onClick={handleAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Schedule
          </button>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>
        </div>

        {selectedClass && selectedSection ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  {DAYS_OF_WEEK.map((day) => (
                    <th
                      key={day}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {TIME_SLOTS.map((time) => (
                  <tr key={time}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {time}
                    </td>
                    {DAYS_OF_WEEK.map((day) => renderTimeSlot(day, time))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            Please select a class and section to view the timetable
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedTimetable ? 'Edit Schedule' : 'Add Schedule'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="dayOfWeek"
              className="block text-sm font-medium text-gray-700"
            >
              Day
            </label>
            <select
              id="dayOfWeek"
              value={formData.dayOfWeek}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  dayOfWeek: e.target.value as TimetableFormData['dayOfWeek'],
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="startTime"
                className="block text-sm font-medium text-gray-700"
              >
                Start Time
              </label>
              <select
                id="startTime"
                value={formData.startTime}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, startTime: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              >
                {TIME_SLOTS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="endTime"
                className="block text-sm font-medium text-gray-700"
              >
                End Time
              </label>
              <select
                id="endTime"
                value={formData.endTime}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, endTime: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              >
                {TIME_SLOTS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="subject"
              className="block text-sm font-medium text-gray-700"
            >
              Subject
            </label>
            <select
              id="subject"
              value={formData.subject}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, subject: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              <option value="">Select Subject</option>
              {/* Add subject options dynamically */}
            </select>
          </div>

          <div>
            <label
              htmlFor="teacher"
              className="block text-sm font-medium text-gray-700"
            >
              Teacher
            </label>
            <select
              id="teacher"
              value={formData.teacher}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, teacher: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              <option value="">Select Teacher</option>
              {/* Add teacher options dynamically */}
            </select>
          </div>

          <div>
            <label
              htmlFor="room"
              className="block text-sm font-medium text-gray-700"
            >
              Room
            </label>
            <input
              type="text"
              id="room"
              value={formData.room}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, room: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {selectedTimetable ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Timetables; 