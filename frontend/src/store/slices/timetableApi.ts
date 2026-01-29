import { api } from '../api';

export interface TimeSlot {
  startTime: string;
  endTime: string;
  subject: {
    _id: string;
    name: string;
    code: string;
  };
  teacher: {
    _id: string;
    name: string;
  };
  room?: string;
}

export interface Timetable {
  _id: string;
  class: {
    _id: string;
    name: string;
  };
  section: string;
  academicYear: string;
  schedule: {
    day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
    slots: TimeSlot[];
  }[];
  isActive: boolean;
  createdBy: {
    _id: string;
    name: string;
  };
  updatedBy: {
    _id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TimetableResponse {
  timetables: Timetable[];
  page: number;
  totalPages: number;
  total: number;
}

export interface TimetableFilters {
  page?: number;
  limit?: number;
  classId?: string;
  section?: string;
  academicYear?: string;
  teacherId?: string;
}

const timetableApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTimetables: builder.query<TimetableResponse, TimetableFilters>({
      query: (filters) => ({
        url: '/timetables',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Timetable'],
    }),

    getTimetableById: builder.query<Timetable, string>({
      query: (id) => `/timetables/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Timetable', id }],
    }),

    createTimetable: builder.mutation<Timetable, Partial<Timetable>>({
      query: (timetable) => ({
        url: '/timetables',
        method: 'POST',
        body: timetable,
      }),
      invalidatesTags: ['Timetable'],
    }),

    updateTimetable: builder.mutation<Timetable, { id: string; timetable: Partial<Timetable> }>({
      query: ({ id, timetable }) => ({
        url: `/timetables/${id}`,
        method: 'PUT',
        body: timetable,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Timetable', id },
        'Timetable',
      ],
    }),

    deleteTimetable: builder.mutation<void, string>({
      query: (id) => ({
        url: `/timetables/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Timetable'],
    }),

    // Get class timetable
    getClassTimetable: builder.query<Timetable, { classId: string; section: string; academicYear?: string }>({
      query: ({ classId, section, academicYear }) => ({
        url: `/classes/${classId}/sections/${section}/timetable`,
        method: 'GET',
        params: { academicYear },
      }),
      providesTags: (_result, _error, { classId, section }) => [
        { type: 'Timetable', id: `class-${classId}-${section}` },
      ],
    }),

    // Get teacher's timetable
    getTeacherTimetable: builder.query<TimeSlot[], { teacherId: string; academicYear?: string }>({
      query: ({ teacherId, academicYear }) => ({
        url: `/teachers/${teacherId}/timetable`,
        method: 'GET',
        params: { academicYear },
      }),
      providesTags: (_result, _error, { teacherId }) => [
        { type: 'Timetable', id: `teacher-${teacherId}` },
      ],
    }),
  }),
});

export const {
  useGetTimetablesQuery,
  useGetTimetableByIdQuery,
  useCreateTimetableMutation,
  useUpdateTimetableMutation,
  useDeleteTimetableMutation,
  useGetClassTimetableQuery,
  useGetTeacherTimetableQuery,
} = timetableApi; 