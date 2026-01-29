import { api } from '../api';

export interface StudyMaterial {
  _id: string;
  title: string;
  description: string;
  type: 'NOTES' | 'ASSIGNMENT' | 'SYLLABUS' | 'WORKSHEET' | 'OTHER';
  subject: {
    _id: string;
    name: string;
    code: string;
  };
  class: {
    _id: string;
    name: string;
  };
  section?: string;
  uploadedBy: {
    _id: string;
    name: string;
  };
  fileUrl: string;
  fileType: string;
  fileSize: number;
  isPublished: boolean;
  academicYear: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialResponse {
  studyMaterials: StudyMaterial[];
  page: number;
  totalPages: number;
  total: number;
}

export interface StudyMaterialFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  subjectId?: string;
  classId?: string;
  section?: string;
  academicYear?: string;
  uploadedBy?: string;
  tags?: string[];
}

const studyMaterialApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getStudyMaterials: builder.query<StudyMaterialResponse, StudyMaterialFilters>({
      query: (filters) => ({
        url: '/study-materials',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['StudyMaterial'],
    }),

    getStudyMaterialById: builder.query<StudyMaterial, string>({
      query: (id) => `/study-materials/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'StudyMaterial', id }],
    }),

    createStudyMaterial: builder.mutation<StudyMaterial, FormData>({
      query: (formData) => ({
        url: '/study-materials',
        method: 'POST',
        body: formData,
        formData: true,
      }),
      invalidatesTags: ['StudyMaterial'],
    }),

    updateStudyMaterial: builder.mutation<StudyMaterial, { id: string; formData: FormData }>({
      query: ({ id, formData }) => ({
        url: `/study-materials/${id}`,
        method: 'PUT',
        body: formData,
        formData: true,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'StudyMaterial', id },
        'StudyMaterial',
      ],
    }),

    deleteStudyMaterial: builder.mutation<void, string>({
      query: (id) => ({
        url: `/study-materials/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['StudyMaterial'],
    }),

    publishStudyMaterial: builder.mutation<void, string>({
      query: (id) => ({
        url: `/study-materials/${id}/publish`,
        method: 'PUT',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'StudyMaterial', id }],
    }),

    // Get study materials by subject
    getSubjectStudyMaterials: builder.query<StudyMaterial[], { subjectId: string; academicYear?: string }>({
      query: ({ subjectId, academicYear }) => ({
        url: `/subjects/${subjectId}/study-materials`,
        method: 'GET',
        params: { academicYear },
      }),
      providesTags: (_result, _error, { subjectId }) => [
        { type: 'StudyMaterial', id: `subject-${subjectId}` },
      ],
    }),

    // Get study materials by class
    getClassStudyMaterials: builder.query<StudyMaterial[], { classId: string; section?: string; academicYear?: string }>({
      query: ({ classId, section, academicYear }) => ({
        url: `/classes/${classId}/study-materials`,
        method: 'GET',
        params: { section, academicYear },
      }),
      providesTags: (_result, _error, { classId }) => [
        { type: 'StudyMaterial', id: `class-${classId}` },
      ],
    }),
  }),
});

export const {
  useGetStudyMaterialsQuery,
  useGetStudyMaterialByIdQuery,
  useCreateStudyMaterialMutation,
  useUpdateStudyMaterialMutation,
  useDeleteStudyMaterialMutation,
  usePublishStudyMaterialMutation,
  useGetSubjectStudyMaterialsQuery,
  useGetClassStudyMaterialsQuery,
} = studyMaterialApi; 