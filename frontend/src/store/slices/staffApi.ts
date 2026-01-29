import { api } from '../api';

export interface Staff {
  _id: string;
  name: string;
  email: string;
  employeeId: string;
  role: 'ACCOUNTANT' | 'LIBRARIAN' | 'ADMIN_STAFF' | 'SUPPORT_STAFF';
  department: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: string;
  joiningDate: string;
  qualification: string;
  experience: number;
  address: string;
  phone: string;
  emergencyContact: string;
  salary: number;
  workingHours: string;
  responsibilities?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffResponse {
  staff: Staff[];
  page: number;
  totalPages: number;
  total: number;
}

export interface StaffFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  department?: string;
  isActive?: boolean;
}

const staffApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getStaff: builder.query<StaffResponse, StaffFilters>({
      query: (filters) => ({
        url: '/staff',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Staff'],
    }),

    getStaffById: builder.query<Staff, string>({
      query: (id) => `/staff/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Staff', id }],
    }),

    createStaff: builder.mutation<Staff, Partial<Staff>>({
      query: (staff) => ({
        url: '/staff',
        method: 'POST',
        body: staff,
      }),
      invalidatesTags: ['Staff'],
    }),

    updateStaff: builder.mutation<Staff, { id: string; staff: Partial<Staff> }>({
      query: ({ id, staff }) => ({
        url: `/staff/${id}`,
        method: 'PUT',
        body: staff,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Staff', id },
        'Staff',
      ],
    }),

    deleteStaff: builder.mutation<void, string>({
      query: (id) => ({
        url: `/staff/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Staff'],
    }),

    toggleStaffStatus: builder.mutation<Staff, { id: string; isActive: boolean }>({
      query: ({ id, isActive }) => ({
        url: `/staff/${id}/toggle-status`,
        method: 'PATCH',
        body: { isActive },
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Staff', id },
        'Staff',
      ],
    }),
  }),
});

export const {
  useGetStaffQuery,
  useGetStaffByIdQuery,
  useCreateStaffMutation,
  useUpdateStaffMutation,
  useDeleteStaffMutation,
  useToggleStaffStatusMutation,
} = staffApi; 