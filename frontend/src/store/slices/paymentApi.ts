import { api } from '../api';

export interface FeeStructure {
  _id: string;
  name: string;
  class: {
    _id: string;
    name: string;
  };
  academicYear: string;
  fees: {
    type: string;
    amount: number;
    dueDate?: string;
    isOptional: boolean;
    description?: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  _id: string;
  student: {
    _id: string;
    name: string;
    class: string;
    section: string;
    rollNumber: string;
  };
  feeStructure: FeeStructure;
  academicYear: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
  transactionId?: string;
  receiptNumber: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  collectedBy: {
    _id: string;
    name: string;
  };
  remarks?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentResponse {
  payments: Payment[];
  page: number;
  totalPages: number;
  total: number;
}

export interface FeeStructureResponse {
  feeStructures: FeeStructure[];
  page: number;
  totalPages: number;
  total: number;
}

export interface PaymentFilters {
  page?: number;
  limit?: number;
  search?: string;
  studentId?: string;
  classId?: string;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export interface FeeStructureFilters {
  page?: number;
  limit?: number;
  search?: string;
  classId?: string;
  academicYear?: string;
}

const paymentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Fee Structure endpoints
    getFeeStructures: builder.query<FeeStructureResponse, FeeStructureFilters>({
      query: (filters) => ({
        url: '/fee-structures',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Payment'],
    }),

    getFeeStructureById: builder.query<FeeStructure, string>({
      query: (id) => `/fee-structures/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Payment', id }],
    }),

    createFeeStructure: builder.mutation<FeeStructure, Partial<FeeStructure>>({
      query: (feeStructure) => ({
        url: '/fee-structures',
        method: 'POST',
        body: feeStructure,
      }),
      invalidatesTags: ['Payment'],
    }),

    updateFeeStructure: builder.mutation<FeeStructure, { id: string; feeStructure: Partial<FeeStructure> }>({
      query: ({ id, feeStructure }) => ({
        url: `/fee-structures/${id}`,
        method: 'PUT',
        body: feeStructure,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Payment', id },
        'Payment',
      ],
    }),

    deleteFeeStructure: builder.mutation<void, string>({
      query: (id) => ({
        url: `/fee-structures/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Payment'],
    }),

    // Payment endpoints
    getPayments: builder.query<PaymentResponse, PaymentFilters>({
      query: (filters) => ({
        url: '/payments',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Payment'],
    }),

    getPaymentById: builder.query<Payment, string>({
      query: (id) => `/payments/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Payment', id }],
    }),

    createPayment: builder.mutation<Payment, Partial<Payment>>({
      query: (payment) => ({
        url: '/payments',
        method: 'POST',
        body: payment,
      }),
      invalidatesTags: ['Payment'],
    }),

    updatePayment: builder.mutation<Payment, { id: string; payment: Partial<Payment> }>({
      query: ({ id, payment }) => ({
        url: `/payments/${id}`,
        method: 'PUT',
        body: payment,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Payment', id },
        'Payment',
      ],
    }),

    deletePayment: builder.mutation<void, string>({
      query: (id) => ({
        url: `/payments/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Payment'],
    }),

    // Get student's payments
    getStudentPayments: builder.query<Payment[], { studentId: string; academicYear?: string }>({
      query: ({ studentId, academicYear }) => ({
        url: `/students/${studentId}/payments`,
        method: 'GET',
        params: { academicYear },
      }),
      providesTags: (_result, _error, { studentId }) => [
        { type: 'Payment', id: `student-${studentId}` },
      ],
    }),

    // Get payment receipt
    getPaymentReceipt: builder.query<string, string>({
      query: (id) => ({
        url: `/payments/${id}/receipt`,
        method: 'GET',
        responseHandler: (response) => response.blob(),
      }),
    }),
  }),
});

export const {
  useGetFeeStructuresQuery,
  useGetFeeStructureByIdQuery,
  useCreateFeeStructureMutation,
  useUpdateFeeStructureMutation,
  useDeleteFeeStructureMutation,
  useGetPaymentsQuery,
  useGetPaymentByIdQuery,
  useCreatePaymentMutation,
  useUpdatePaymentMutation,
  useDeletePaymentMutation,
  useGetStudentPaymentsQuery,
  useGetPaymentReceiptQuery,
} = paymentApi; 