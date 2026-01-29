import { api } from '../api';

export interface Student {
  _id: string;
  name: string;
  email: string;
  class: string;
  section: string;
  rollNumber: string;
  admissionNumber: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  address: string;
  phone: string;
  admissionDate: string;
  bloodGroup?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  previousSchool?: string;
  medicalConditions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentResponse {
  students: Student[];
  page: number;
  totalPages: number;
  total: number;
}

export interface StudentFilters {
  page?: number;
  limit?: number;
  search?: string;
  class?: string;
  section?: string;
}

const studentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getStudents: builder.query<StudentResponse, StudentFilters>({
      query: (filters) => ({
        url: '/students',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Student'],
    }),

    getStudentById: builder.query<Student, string>({
      query: (id) => `/students/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Student', id }],
    }),

    createStudent: builder.mutation<Student, Partial<Student>>({
      query: (student) => ({
        url: '/students',
        method: 'POST',
        body: student,
      }),
      invalidatesTags: ['Student'],
    }),

    updateStudent: builder.mutation<Student, { id: string; student: Partial<Student> }>({
      query: ({ id, student }) => ({
        url: `/students/${id}`,
        method: 'PUT',
        body: student,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Student', id },
        'Student',
      ],
    }),

    deleteStudent: builder.mutation<void, string>({
      query: (id) => ({
        url: `/students/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Student'],
    }),
  }),
});

export const {
  useGetStudentsQuery,
  useGetStudentByIdQuery,
  useCreateStudentMutation,
  useUpdateStudentMutation,
  useDeleteStudentMutation,
} = studentApi; 