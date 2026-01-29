import { api } from '../api';

export interface Notice {
  _id: string;
  title: string;
  content: string;
  type: 'GENERAL' | 'EXAM' | 'EVENT' | 'HOLIDAY' | 'ANNOUNCEMENT';
  startDate: string;
  endDate?: string;
  targetAudience: ('STUDENT' | 'TEACHER' | 'PARENT' | 'STAFF')[];
  targetClasses?: {
    _id: string;
    name: string;
  }[];
  attachments?: string[];
  isPublished: boolean;
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

export interface NoticeResponse {
  notices: Notice[];
  page: number;
  totalPages: number;
  total: number;
}

export interface NoticeFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  targetAudience?: string;
  targetClass?: string;
  isPublished?: boolean;
}

const noticeApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getNotices: builder.query<NoticeResponse, NoticeFilters>({
      query: (filters) => ({
        url: '/notices',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Notice'],
    }),

    getNoticeById: builder.query<Notice, string>({
      query: (id) => `/notices/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Notice', id }],
    }),

    createNotice: builder.mutation<Notice, Partial<Notice>>({
      query: (notice) => ({
        url: '/notices',
        method: 'POST',
        body: notice,
      }),
      invalidatesTags: ['Notice'],
    }),

    updateNotice: builder.mutation<Notice, { id: string; notice: Partial<Notice> }>({
      query: ({ id, notice }) => ({
        url: `/notices/${id}`,
        method: 'PUT',
        body: notice,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Notice', id },
        'Notice',
      ],
    }),

    deleteNotice: builder.mutation<void, string>({
      query: (id) => ({
        url: `/notices/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Notice'],
    }),

    publishNotice: builder.mutation<void, string>({
      query: (id) => ({
        url: `/notices/${id}/publish`,
        method: 'PUT',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Notice', id }],
    }),

    // Get calendar events from notices
    getCalendarEvents: builder.query<Notice[], { startDate: string; endDate: string }>({
      query: ({ startDate, endDate }) => ({
        url: '/notices/calendar',
        method: 'GET',
        params: { startDate, endDate },
      }),
      providesTags: ['Notice'],
    }),

    // Get user's notices based on their role and class
    getUserNotices: builder.query<Notice[], void>({
      query: () => '/notices/user',
      providesTags: ['Notice'],
    }),
  }),
});

export const {
  useGetNoticesQuery,
  useGetNoticeByIdQuery,
  useCreateNoticeMutation,
  useUpdateNoticeMutation,
  useDeleteNoticeMutation,
  usePublishNoticeMutation,
  useGetCalendarEventsQuery,
  useGetUserNoticesQuery,
} = noticeApi; 