import { api } from '../api';

export interface Subject {
  _id: string;
  name: string;
  code: string;
  description?: string;
  teachers: {
    _id: string;
    name: string;
    email: string;
  }[];
  classes: {
    _id: string;
    name: string;
  }[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectResponse {
  subjects: Subject[];
  page: number;
  totalPages: number;
  total: number;
}

export interface SubjectFilters {
  page?: number;
  limit?: number;
  search?: string;
  classId?: string;
  teacherId?: string;
}

const subjectApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSubjects: builder.query<SubjectResponse, SubjectFilters>({
      query: (filters) => ({
        url: '/subjects',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Subject'],
    }),

    getSubjectById: builder.query<Subject, string>({
      query: (id) => `/subjects/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Subject', id }],
    }),

    createSubject: builder.mutation<Subject, Partial<Subject>>({
      query: (subject) => ({
        url: '/subjects',
        method: 'POST',
        body: subject,
      }),
      invalidatesTags: ['Subject'],
    }),

    updateSubject: builder.mutation<Subject, { id: string; subject: Partial<Subject> }>({
      query: ({ id, subject }) => ({
        url: `/subjects/${id}`,
        method: 'PUT',
        body: subject,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Subject', id },
        'Subject',
      ],
    }),

    deleteSubject: builder.mutation<void, string>({
      query: (id) => ({
        url: `/subjects/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Subject'],
    }),

    // Get teachers assigned to a subject
    getSubjectTeachers: builder.query<Subject['teachers'], string>({
      query: (subjectId) => `/subjects/${subjectId}/teachers`,
      providesTags: (_result, _error, id) => [{ type: 'Subject', id }],
    }),

    // Get classes where a subject is taught
    getSubjectClasses: builder.query<Subject['classes'], string>({
      query: (subjectId) => `/subjects/${subjectId}/classes`,
      providesTags: (_result, _error, id) => [{ type: 'Subject', id }],
    }),
  }),
});

export const {
  useGetSubjectsQuery,
  useGetSubjectByIdQuery,
  useCreateSubjectMutation,
  useUpdateSubjectMutation,
  useDeleteSubjectMutation,
  useGetSubjectTeachersQuery,
  useGetSubjectClassesQuery,
} = subjectApi; 