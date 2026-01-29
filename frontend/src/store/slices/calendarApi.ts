import { api } from '../api';

export interface CalendarEvent {
  _id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  type: 'EXAM' | 'HOLIDAY' | 'EVENT' | 'MEETING' | 'OTHER';
  location?: string;
  attendees?: string[];
  isAllDay: boolean;
  color?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventResponse {
  events: CalendarEvent[];
  page: number;
  totalPages: number;
  total: number;
}

export interface CalendarEventFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  isAllDay?: boolean;
}

const calendarApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getEvents: builder.query<CalendarEventResponse, CalendarEventFilters>({
      query: (filters) => ({
        url: '/calendar/events',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['CalendarEvent'],
    }),

    getEventById: builder.query<CalendarEvent, string>({
      query: (id) => `/calendar/events/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'CalendarEvent', id }],
    }),

    createEvent: builder.mutation<CalendarEvent, Partial<CalendarEvent>>({
      query: (event) => ({
        url: '/calendar/events',
        method: 'POST',
        body: event,
      }),
      invalidatesTags: ['CalendarEvent'],
    }),

    updateEvent: builder.mutation<CalendarEvent, { id: string; event: Partial<CalendarEvent> }>({
      query: ({ id, event }) => ({
        url: `/calendar/events/${id}`,
        method: 'PUT',
        body: event,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'CalendarEvent', id },
        'CalendarEvent',
      ],
    }),

    deleteEvent: builder.mutation<void, string>({
      query: (id) => ({
        url: `/calendar/events/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['CalendarEvent'],
    }),

    getEventsByDateRange: builder.query<CalendarEvent[], { startDate: string; endDate: string }>({
      query: ({ startDate, endDate }) => ({
        url: '/calendar/events/range',
        method: 'GET',
        params: { startDate, endDate },
      }),
      providesTags: ['CalendarEvent'],
    }),
  }),
});

export const {
  useGetEventsQuery,
  useGetEventByIdQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useGetEventsByDateRangeQuery,
} = calendarApi; 