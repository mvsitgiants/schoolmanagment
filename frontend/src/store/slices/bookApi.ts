import { api } from '../api';

export interface Book {
  _id: string;
  title: string;
  author: string;
  isbn: string;
  category: string;
  subject?: {
    _id: string;
    name: string;
    code: string;
  };
  publisher: string;
  publishYear: number;
  edition?: string;
  quantity: number;
  availableQuantity: number;
  location: string;
  description?: string;
  coverImage?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookIssue {
  _id: string;
  book: Book;
  issuedTo: {
    _id: string;
    name: string;
    email: string;
  };
  issuedBy: {
    _id: string;
    name: string;
  };
  issueDate: string;
  dueDate: string;
  returnDate?: string;
  returnedTo?: {
    _id: string;
    name: string;
  };
  fine?: number;
  status: 'ISSUED' | 'RETURNED' | 'OVERDUE' | 'LOST';
  remarks?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookResponse {
  books: Book[];
  page: number;
  totalPages: number;
  total: number;
}

export interface BookIssueResponse {
  bookIssues: BookIssue[];
  page: number;
  totalPages: number;
  total: number;
}

export interface BookFilters {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  subject?: string;
  availability?: boolean;
}

export interface BookIssueFilters {
  page?: number;
  limit?: number;
  status?: string;
  userId?: string;
  bookId?: string;
  startDate?: string;
  endDate?: string;
}

const bookApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getBooks: builder.query<BookResponse, BookFilters>({
      query: (filters) => ({
        url: '/books',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['Book'],
    }),

    getBookById: builder.query<Book, string>({
      query: (id) => `/books/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Book', id }],
    }),

    createBook: builder.mutation<Book, Partial<Book>>({
      query: (book) => ({
        url: '/books',
        method: 'POST',
        body: book,
      }),
      invalidatesTags: ['Book'],
    }),

    updateBook: builder.mutation<Book, { id: string; book: Partial<Book> }>({
      query: ({ id, book }) => ({
        url: `/books/${id}`,
        method: 'PUT',
        body: book,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Book', id },
        'Book',
      ],
    }),

    deleteBook: builder.mutation<void, string>({
      query: (id) => ({
        url: `/books/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Book'],
    }),

    // Book Issue endpoints
    getBookIssues: builder.query<BookIssueResponse, BookIssueFilters>({
      query: (filters) => ({
        url: '/book-issues',
        method: 'GET',
        params: filters,
      }),
      providesTags: ['BookIssue'],
    }),

    getBookIssueById: builder.query<BookIssue, string>({
      query: (id) => `/book-issues/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'BookIssue', id }],
    }),

    issueBook: builder.mutation<BookIssue, Partial<BookIssue>>({
      query: (bookIssue) => ({
        url: '/book-issues',
        method: 'POST',
        body: bookIssue,
      }),
      invalidatesTags: ['BookIssue', 'Book'],
    }),

    returnBook: builder.mutation<BookIssue, { id: string; returnData: { returnDate: string; fine?: number; remarks?: string } }>({
      query: ({ id, returnData }) => ({
        url: `/book-issues/${id}/return`,
        method: 'PUT',
        body: returnData,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'BookIssue', id },
        'Book',
      ],
    }),

    // Get user's book issues
    getUserBookIssues: builder.query<BookIssue[], void>({
      query: () => '/book-issues/user',
      providesTags: ['BookIssue'],
    }),
  }),
});

export const {
  useGetBooksQuery,
  useGetBookByIdQuery,
  useCreateBookMutation,
  useUpdateBookMutation,
  useDeleteBookMutation,
  useGetBookIssuesQuery,
  useGetBookIssueByIdQuery,
  useIssueBookMutation,
  useReturnBookMutation,
  useGetUserBookIssuesQuery,
} = bookApi; 