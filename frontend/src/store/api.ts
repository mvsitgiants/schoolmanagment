import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { RootState } from './index';
import { logout } from './slices/authSlice';

// Custom base query with error handling
const baseQueryWithReauth = async (args: any, api: any, extraOptions: any) => {
  let result = await fetchBaseQuery({
    baseUrl: 'http://localhost:5000/api',
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  })(args, api, extraOptions);
  
  if (result.error && result.error.status === 401) {
    // Token is invalid, logout the user
    api.dispatch(logout());
    // Redirect to login page
    window.location.href = '/login';
  }
  
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  endpoints: () => ({}),
  tagTypes: ['User', 'Student', 'Teacher', 'Class', 'Subject', 'Exam', 'Grade', 'Notice', 'Payment', 'Book'],
});

// Enhanced API with error handling
export const enhancedApi = api.enhanceEndpoints({
  addTagTypes: ['User', 'Student', 'Teacher', 'Class', 'Subject', 'Exam', 'Grade', 'Notice', 'Payment', 'Book'],
}); 