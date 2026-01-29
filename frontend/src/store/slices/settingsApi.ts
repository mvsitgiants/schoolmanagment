import { api } from '../api';

export interface Settings {
  _id: string;
  schoolName: string;
  schoolAddress: string;
  schoolPhone: string;
  schoolEmail: string;
  schoolWebsite?: string;
  academicYear: string;
  semester: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  currency: string;
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  features: {
    attendance: boolean;
    grades: boolean;
    payments: boolean;
    library: boolean;
    calendar: boolean;
    reports: boolean;
  };
  updatedBy: string;
  updatedAt: string;
}

export interface SettingsUpdateRequest {
  schoolName?: string;
  schoolAddress?: string;
  schoolPhone?: string;
  schoolEmail?: string;
  schoolWebsite?: string;
  academicYear?: string;
  semester?: string;
  timezone?: string;
  dateFormat?: string;
  timeFormat?: '12h' | '24h';
  currency?: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  notifications?: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
  };
  features?: {
    attendance?: boolean;
    grades?: boolean;
    payments?: boolean;
    library?: boolean;
    calendar?: boolean;
    reports?: boolean;
  };
}

const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSettings: builder.query<Settings, void>({
      query: () => '/settings',
      providesTags: ['Settings'],
    }),

    updateSettings: builder.mutation<Settings, SettingsUpdateRequest>({
      query: (settings) => ({
        url: '/settings',
        method: 'PUT',
        body: settings,
      }),
      invalidatesTags: ['Settings'],
    }),

    resetSettings: builder.mutation<Settings, void>({
      query: () => ({
        url: '/settings/reset',
        method: 'POST',
      }),
      invalidatesTags: ['Settings'],
    }),

    exportSettings: builder.query<Blob, void>({
      query: () => ({
        url: '/settings/export',
        method: 'GET',
        responseHandler: (response) => response.blob(),
      }),
    }),

    importSettings: builder.mutation<Settings, FormData>({
      query: (formData) => ({
        url: '/settings/import',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Settings'],
    }),
  }),
});

export const {
  useGetSettingsQuery,
  useUpdateSettingsMutation,
  useResetSettingsMutation,
  useExportSettingsQuery,
  useImportSettingsMutation,
} = settingsApi; 