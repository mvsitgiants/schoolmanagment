import { api } from '../api';

export interface Class {
  _id: string;
  name: string;
  sections: string[];
  subjects: {
    _id: string;
    name: string;
    code: string;
  }[];
  classTeacher: {
    _id: string;
    name: string;
    email: string;
  };
  academicYear: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassResponse {
  classes: Class[];
  page: number;
  totalPages: number;
  total: number;
}

export interface ClassFilters {
  page?: number;
  limit?: number;
  search?: string;
  academicYear?: string;
}

const classApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getClasses: builder.query<ClassResponse, ClassFilters>({
      query: (filters) => ({
        url: '/classes',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Class'],
    }),

    getClassById: builder.query<Class, string>({
      query: (id) => `/classes/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Class', id }],
    }),

    createClass: builder.mutation<Class, Partial<Class>>({
      query: (classData) => ({
        url: '/classes',
        method: 'POST',
        body: classData,
      }),
      invalidatesTags: ['Class'],
    }),

    updateClass: builder.mutation<Class, { id: string; classData: Partial<Class> }>({
      query: ({ id, classData }) => ({
        url: `/classes/${id}`,
        method: 'PUT',
        body: classData,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Class', id },
        'Class',
      ],
    }),

    deleteClass: builder.mutation<void, string>({
      query: (id) => ({
        url: `/classes/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Class'],
    }),

    // Get sections for a specific class
    getClassSections: builder.query<string[], string>({
      query: (classId) => `/classes/${classId}/sections`,
      providesTags: (_result, _error, id) => [{ type: 'Class', id }],
    }),

    // Get subjects for a specific class
    getClassSubjects: builder.query<Class['subjects'], string>({
      query: (classId) => `/classes/${classId}/subjects`,
      providesTags: (_result, _error, id) => [{ type: 'Class', id }],
    }),
  }),
});

export const {
  useGetClassesQuery,
  useGetClassByIdQuery,
  useCreateClassMutation,
  useUpdateClassMutation,
  useDeleteClassMutation,
  useGetClassSectionsQuery,
  useGetClassSubjectsQuery,
} = classApi; 