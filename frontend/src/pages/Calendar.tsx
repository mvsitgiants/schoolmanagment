import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '../store/slices/calendarApi';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface Event {
  _id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  type: 'CLASS' | 'EXAM' | 'MEETING' | 'HOLIDAY' | 'OTHER';
  participants?: string[];
  location?: string;
  color: string;
}

interface EventFormData {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  type: Event['type'];
  participants?: string[];
  location?: string;
}

const EVENT_TYPES = [
  { value: 'CLASS', label: 'Class', color: 'bg-blue-100 text-blue-800' },
  { value: 'EXAM', label: 'Exam', color: 'bg-red-100 text-red-800' },
  { value: 'MEETING', label: 'Meeting', color: 'bg-green-100 text-green-800' },
  { value: 'HOLIDAY', label: 'Holiday', color: 'bg-purple-100 text-purple-800' },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-100 text-gray-800' },
];

const Calendar: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [formData, setFormData] = useState<EventFormData>({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    type: 'OTHER',
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data: events } = useGetEventsQuery({
    year: selectedDate.getFullYear(),
    month: selectedDate.getMonth() + 1,
  });

  const [createEvent] = useCreateEventMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [deleteEvent] = useDeleteEventMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.TEACHER;

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    setSelectedDate(
      new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1)
    );
  };

  const handleNextMonth = () => {
    setSelectedDate(
      new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1)
    );
  };

  const handleAdd = () => {
    setSelectedEvent(null);
    setFormData({
      title: '',
      description: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      type: 'OTHER',
    });
    setIsModalOpen(true);
  };

  const handleEdit = (event: Event) => {
    setSelectedEvent(event);
    setFormData({
      title: event.title,
      description: event.description,
      startDate: event.startDate.split('T')[0],
      endDate: event.endDate.split('T')[0],
      type: event.type,
      participants: event.participants,
      location: event.location,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this event?')) {
      try {
        await deleteEvent(id).unwrap();
        toast.success('Event deleted successfully');
      } catch (error) {
        toast.error('Failed to delete event');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedEvent?._id) {
        await updateEvent({
          id: selectedEvent._id,
          event: formData,
        }).unwrap();
        toast.success('Event updated successfully');
      } else {
        await createEvent(formData).unwrap();
        toast.success('Event created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedEvent?._id
          ? 'Failed to update event'
          : 'Failed to create event'
      );
    }
  };

  const getEventTypeColor = (type: Event['type']) => {
    return EVENT_TYPES.find((t) => t.value === type)?.color || 'bg-gray-100 text-gray-800';
  };

  const renderCalendarHeader = () => (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      <div className="flex items-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {selectedDate.toLocaleString('default', {
            month: 'long',
            year: 'numeric',
          })}
        </h2>
      </div>
      <div className="flex items-center space-x-4">
        <button
          onClick={handlePrevMonth}
          className="p-2 text-gray-400 hover:text-gray-500"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => setSelectedDate(new Date())}
          className="px-3 py-1 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
        >
          Today
        </button>
        <button
          onClick={handleNextMonth}
          className="p-2 text-gray-400 hover:text-gray-500"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
        {canModify && (
          <button
            onClick={handleAdd}
            className="ml-4 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Event
          </button>
        )}
      </div>
    </div>
  );

  const renderCalendarGrid = () => {
    const daysInMonth = getDaysInMonth(selectedDate);
    const firstDayOfMonth = getFirstDayOfMonth(selectedDate);
    const days = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="bg-gray-50" />);
    }

    // Add cells for each day of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        day
      );
      const dayEvents = events?.filter((event) => {
        const eventStart = new Date(event.startDate);
        const eventEnd = new Date(event.endDate);
        return date >= eventStart && date <= eventEnd;
      });

      days.push(
        <div
          key={day}
          className="min-h-[120px] p-2 border-t border-l border-gray-200 relative"
        >
          <div className="font-medium text-gray-900">{day}</div>
          <div className="space-y-1 mt-1">
            {dayEvents?.map((event) => (
              <button
                key={event._id}
                onClick={() => handleEdit(event)}
                className={`w-full text-left px-2 py-1 rounded-md text-xs ${getEventTypeColor(
                  event.type
                )}`}
              >
                {event.title}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-7 border-r border-b border-gray-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="px-2 py-3 text-center text-sm font-medium text-gray-500 border-t border-l border-gray-200 bg-gray-50"
          >
            {day}
          </div>
        ))}
        {days}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Calendar</h1>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {renderCalendarHeader()}
        {renderCalendarGrid()}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedEvent ? 'Edit Event' : 'Add Event'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Start Date
              </label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    startDate: e.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, endDate: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Event Type
            </label>
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  type: e.target.value as Event['type'],
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Location
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, location: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-3">
            {selectedEvent && (
              <button
                type="button"
                onClick={() => handleDelete(selectedEvent._id)}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Delete
              </button>
            )}
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
              {selectedEvent ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Calendar; 