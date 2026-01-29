import { api } from '../api';

export interface Exam {
  _id: string;
  name: string;
  type: 'MIDTERM' | 'FINAL' | 'TEST' | 'ASSIGNMENT';
  subject: {
    _id: string;
    name: string;
    code: string;
  };
  class: {
    _id: string;
    name: string;
  };
  section: string;
  date: string;
  duration: number;
  totalMarks: number;
  passingMarks: number;
  academicYear: string;
  conductedBy: {
    _id: string;
    name: string;
  };
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Grade {
  _id: string;
  exam: string;
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

export interface ExamResponse {
  exams: Exam[];
  page: number;
  totalPages: number;
  total: number;
}

export interface GradeResponse {
  grades: Grade[];
  page: number;
  totalPages: number;
  total: number;
}

export interface ExamFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  subjectId?: string;
  classId?: string;
  section?: string;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
}

export interface GradeFilters {
  page?: number;
  limit?: number;
  examId: string;
  studentId?: string;
}

const examApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getExams: builder.query<ExamResponse, ExamFilters>({
      query: (filters) => ({
        url: '/exams',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Exam'],
    }),

    getExamById: builder.query<Exam, string>({
      query: (id) => `/exams/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Exam', id }],
    }),

    createExam: builder.mutation<Exam, Partial<Exam>>({
      query: (exam) => ({
        url: '/exams',
        method: 'POST',
        body: exam,
      }),
      invalidatesTags: ['Exam'],
    }),

    updateExam: builder.mutation<Exam, { id: string; exam: Partial<Exam> }>({
      query: ({ id, exam }) => ({
        url: `/exams/${id}`,
        method: 'PUT',
        body: exam,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Exam', id },
        'Exam',
      ],
    }),

    deleteExam: builder.mutation<void, string>({
      query: (id) => ({
        url: `/exams/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Exam'],
    }),

    publishExam: builder.mutation<void, string>({
      query: (id) => ({
        url: `/exams/${id}/publish`,
        method: 'PUT',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Exam', id }],
    }),

    // Grade endpoints
    getGrades: builder.query<GradeResponse, GradeFilters>({
      query: (filters) => ({
        url: '/grades',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Grade'],
    }),

    getGradeById: builder.query<Grade, string>({
      query: (id) => `/grades/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Grade', id }],
    }),

    createGrade: builder.mutation<Grade, Partial<Grade>>({
      query: (grade) => ({
        url: '/grades',
        method: 'POST',
        body: grade,
      }),
      invalidatesTags: ['Grade'],
    }),

    updateGrade: builder.mutation<Grade, { id: string; grade: Partial<Grade> }>({
      query: ({ id, grade }) => ({
        url: `/grades/${id}`,
        method: 'PUT',
        body: grade,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Grade', id },
        'Grade',
      ],
    }),

    deleteGrade: builder.mutation<void, string>({
      query: (id) => ({
        url: `/grades/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Grade'],
    }),

    // Bulk grade operations
    bulkCreateGrades: builder.mutation<void, { examId: string; grades: Partial<Grade>[] }>({
      query: ({ examId, grades }) => ({
        url: `/exams/${examId}/grades/bulk`,
        method: 'POST',
        body: { grades },
      }),
      invalidatesTags: ['Grade'],
    }),

    // Get student's grades
    getStudentGrades: builder.query<Grade[], { studentId: string; academicYear?: string }>({
      query: ({ studentId, academicYear }) => ({
        url: `/students/${studentId}/grades`,
        method: 'GET',
        params: { academicYear },
      }),
      providesTags: (_result, _error, { studentId }) => [
        { type: 'Grade', id: `student-${studentId}` },
      ],
    }),
  }),
});

export const {
  useGetExamsQuery,
  useGetExamByIdQuery,
  useCreateExamMutation,
  useUpdateExamMutation,
  useDeleteExamMutation,
  usePublishExamMutation,
  useGetGradesQuery,
  useGetGradeByIdQuery,
  useCreateGradeMutation,
  useUpdateGradeMutation,
  useDeleteGradeMutation,
  useBulkCreateGradesMutation,
  useGetStudentGradesQuery,
} = examApi; 