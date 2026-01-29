import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetBooksQuery,
  useCreateBookMutation,
  useUpdateBookMutation,
  useDeleteBookMutation,
  useIssueBookMutation,
  useReturnBookMutation,
  Book,
  BookIssue,
} from '../store/slices/bookApi';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface BookFormData {
  title: string;
  author: string;
  isbn: string;
  category: string;
  subject?: string;
  publisher: string;
  publishYear: number;
  edition?: string;
  quantity: number;
  location: string;
  description?: string;
}

interface BookIssueFormData {
  book: string;
  issuedTo: string;
  dueDate: string;
  remarks?: string;
}

const Library: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<Partial<Book> | null>(null);
  const [formData, setFormData] = useState<BookFormData>({
    title: '',
    author: '',
    isbn: '',
    category: '',
    publisher: '',
    publishYear: new Date().getFullYear(),
    quantity: 1,
    location: '',
  });
  const [issueFormData, setIssueFormData] = useState<BookIssueFormData>({
    book: '',
    issuedTo: '',
    dueDate: '',
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data, isLoading } = useGetBooksQuery({
    page,
    search,
  });

  const [createBook] = useCreateBookMutation();
  const [updateBook] = useUpdateBookMutation();
  const [deleteBook] = useDeleteBookMutation();
  const [issueBook] = useIssueBookMutation();
  const [returnBook] = useReturnBookMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.LIBRARIAN;

  const handleAdd = () => {
    setSelectedBook(null);
    setFormData({
      title: '',
      author: '',
      isbn: '',
      category: '',
      publisher: '',
      publishYear: new Date().getFullYear(),
      quantity: 1,
      location: '',
    });
    setIsModalOpen(true);
  };

  const handleEdit = (book: Book) => {
    setSelectedBook(book);
    setFormData({
      title: book.title,
      author: book.author,
      isbn: book.isbn,
      category: book.category,
      subject: book.subject?._id,
      publisher: book.publisher,
      publishYear: book.publishYear,
      edition: book.edition,
      quantity: book.quantity,
      location: book.location,
      description: book.description,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this book?')) {
      try {
        await deleteBook(id).unwrap();
        toast.success('Book deleted successfully');
      } catch (error) {
        toast.error('Failed to delete book');
      }
    }
  };

  const handleIssue = (book: Book) => {
    setSelectedBook(book);
    setIssueFormData({
      book: book._id,
      issuedTo: '',
      dueDate: '',
    });
    setIsIssueModalOpen(true);
  };

  const handleReturn = async (issueId: string) => {
    try {
      await returnBook({
        id: issueId,
        returnData: {
          returnDate: new Date().toISOString(),
        },
      }).unwrap();
      toast.success('Book returned successfully');
    } catch (error) {
      toast.error('Failed to return book');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedBook?._id) {
        await updateBook({
          id: selectedBook._id,
          book: formData,
        }).unwrap();
        toast.success('Book updated successfully');
      } else {
        await createBook(formData).unwrap();
        toast.success('Book created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedBook?._id ? 'Failed to update book' : 'Failed to create book'
      );
    }
  };

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await issueBook(issueFormData).unwrap();
      toast.success('Book issued successfully');
      setIsIssueModalOpen(false);
    } catch (error) {
      toast.error('Failed to issue book');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Library</h1>
        {canModify && (
          <button
            onClick={handleAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Book
          </button>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search books..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-md"
                />
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-2.5" />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Author
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                {canModify && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.books.map((book) => (
                <tr key={book._id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {book.title}
                    </div>
                    <div className="text-sm text-gray-500">
                      ISBN: {book.isbn}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{book.author}</div>
                    <div className="text-sm text-gray-500">
                      {book.publisher} ({book.publishYear})
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{book.category}</div>
                    <div className="text-sm text-gray-500">
                      Location: {book.location}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      Available: {book.availableQuantity} / {book.quantity}
                    </div>
                    {book.availableQuantity > 0 ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        In Stock
                      </span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        Out of Stock
                      </span>
                    )}
                  </td>
                  {canModify && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(book)}
                        className="text-indigo-600 hover:text-indigo-900 mr-4"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      {book.availableQuantity > 0 && (
                        <button
                          onClick={() => handleIssue(book)}
                          className="text-green-600 hover:text-green-900 mr-4"
                        >
                          <ArrowUpTrayIcon className="h-5 w-5" />
                        </button>
                      )}
                      {user?.role === UserRole.SUPER_ADMIN && (
                        <button
                          onClick={() => handleDelete(book._id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === data.totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing{' '}
                  <span className="font-medium">
                    {(page - 1) * 10 + 1}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium">
                    {Math.min(page * 10, data.total)}
                  </span>{' '}
                  of <span className="font-medium">{data.total}</span> results
                </p>
              </div>
              <div>
                <nav
                  className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                  aria-label="Pagination"
                >
                  {Array.from({ length: data.totalPages }).map((_, index) => (
                    <button
                      key={index + 1}
                      onClick={() => setPage(index + 1)}
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        page === index + 1
                          ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedBook ? 'Edit Book' : 'Add Book'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="title"
                className="block text-sm font-medium text-gray-700"
              >
                Title
              </label>
              <input
                type="text"
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="author"
                className="block text-sm font-medium text-gray-700"
              >
                Author
              </label>
              <input
                type="text"
                id="author"
                value={formData.author}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, author: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="isbn"
                className="block text-sm font-medium text-gray-700"
              >
                ISBN
              </label>
              <input
                type="text"
                id="isbn"
                value={formData.isbn}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, isbn: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="category"
                className="block text-sm font-medium text-gray-700"
              >
                Category
              </label>
              <input
                type="text"
                id="category"
                value={formData.category}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, category: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="publisher"
                className="block text-sm font-medium text-gray-700"
              >
                Publisher
              </label>
              <input
                type="text"
                id="publisher"
                value={formData.publisher}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, publisher: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="publishYear"
                className="block text-sm font-medium text-gray-700"
              >
                Publish Year
              </label>
              <input
                type="number"
                id="publishYear"
                value={formData.publishYear}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    publishYear: parseInt(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="quantity"
                className="block text-sm font-medium text-gray-700"
              >
                Quantity
              </label>
              <input
                type="number"
                id="quantity"
                value={formData.quantity}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    quantity: parseInt(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
                min="1"
              />
            </div>

            <div>
              <label
                htmlFor="location"
                className="block text-sm font-medium text-gray-700"
              >
                Location
              </label>
              <input
                type="text"
                id="location"
                value={formData.location}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, location: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {selectedBook ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isIssueModalOpen}
        onClose={() => setIsIssueModalOpen(false)}
        title="Issue Book"
      >
        <form onSubmit={handleIssueSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="issuedTo"
              className="block text-sm font-medium text-gray-700"
            >
              Issue To
            </label>
            <input
              type="text"
              id="issuedTo"
              value={issueFormData.issuedTo}
              onChange={(e) =>
                setIssueFormData((prev) => ({
                  ...prev,
                  issuedTo: e.target.value,
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="dueDate"
              className="block text-sm font-medium text-gray-700"
            >
              Due Date
            </label>
            <input
              type="date"
              id="dueDate"
              value={issueFormData.dueDate}
              onChange={(e) =>
                setIssueFormData((prev) => ({
                  ...prev,
                  dueDate: e.target.value,
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="remarks"
              className="block text-sm font-medium text-gray-700"
            >
              Remarks
            </label>
            <textarea
              id="remarks"
              value={issueFormData.remarks}
              onChange={(e) =>
                setIssueFormData((prev) => ({
                  ...prev,
                  remarks: e.target.value,
                }))
              }
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setIsIssueModalOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Issue Book
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Library; 