import { api } from '../api';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserResponse {
  users: User[];
  page: number;
  totalPages: number;
  total: number;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
}

const userApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getUsers: builder.query<UserResponse, UserFilters>({
      query: (filters) => ({
        url: '/users',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['User'],
    }),

    getUserById: builder.query<User, string>({
      query: (id) => `/users/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'User', id }],
    }),

    createUser: builder.mutation<User, Partial<User>>({
      query: (user) => ({
        url: '/users',
        method: 'POST',
        body: user,
      }),
      invalidatesTags: ['User'],
    }),

    updateUser: builder.mutation<User, { id: string; user: Partial<User> }>({
      query: ({ id, user }) => ({
        url: `/users/${id}`,
        method: 'PUT',
        body: user,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        'User',
      ],
    }),

    deleteUser: builder.mutation<void, string>({
      query: (id) => ({
        url: `/users/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['User'],
    }),

    toggleUserStatus: builder.mutation<User, { id: string; isActive: boolean }>({
      query: ({ id, isActive }) => ({
        url: `/users/${id}/toggle-status`,
        method: 'PATCH',
        body: { isActive },
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User', id },
        'User',
      ],
    }),
  }),
});

export const {
  useGetUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useToggleUserStatusMutation,
} = userApi; 