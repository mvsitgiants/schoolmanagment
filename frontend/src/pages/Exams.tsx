import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetExamsQuery,
  useCreateExamMutation,
  useUpdateExamMutation,
  useDeleteExamMutation,
  usePublishExamMutation,
  Exam,
} from '../store/slices/examApi';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface ExamFormData {
  name: string;
  type: 'MIDTERM' | 'FINAL' | 'TEST' | 'ASSIGNMENT';
  subject: string;
  class: string;
  section: string;
  date: string;
  duration: number;
  totalMarks: number;
  passingMarks: number;
  academicYear: string;
}

const Exams: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedExam, setSelectedExam] = useState<Partial<Exam> | null>(null);
  const [formData, setFormData] = useState<ExamFormData>({
    name: '',
    type: 'TEST',
    subject: '',
    class: '',
    section: '',
    date: '',
    duration: 60,
    totalMarks: 100,
    passingMarks: 40,
    academicYear: new Date().getFullYear().toString(),
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data, isLoading } = useGetExamsQuery({
    page,
    search,
  });

  const [createExam] = useCreateExamMutation();
  const [updateExam] = useUpdateExamMutation();
  const [deleteExam] = useDeleteExamMutation();
  const [publishExam] = usePublishExamMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || user?.role === UserRole.ADMIN;
  const canPublish = canModify || user?.role === UserRole.TEACHER;

  const handleAdd = () => {
    setSelectedExam(null);
    setFormData({
      name: '',
      type: 'TEST',
      subject: '',
      class: '',
      section: '',
      date: '',
      duration: 60,
      totalMarks: 100,
      passingMarks: 40,
      academicYear: new Date().getFullYear().toString(),
    });
    setIsModalOpen(true);
  };

  const handleEdit = (exam: Exam) => {
    setSelectedExam(exam);
    setFormData({
      name: exam.name,
      type: exam.type,
      subject: exam.subject._id,
      class: exam.class._id,
      section: exam.section,
      date: exam.date,
      duration: exam.duration,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      academicYear: exam.academicYear,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this exam?')) {
      try {
        await deleteExam(id).unwrap();
        toast.success('Exam deleted successfully');
      } catch (error) {
        toast.error('Failed to delete exam');
      }
    }
  };

  const handlePublish = async (id: string) => {
    if (window.confirm('Are you sure you want to publish this exam?')) {
      try {
        await publishExam(id).unwrap();
        toast.success('Exam published successfully');
      } catch (error) {
        toast.error('Failed to publish exam');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedExam?._id) {
        await updateExam({
          id: selectedExam._id,
          exam: formData,
        }).unwrap();
        toast.success('Exam updated successfully');
      } else {
        await createExam(formData).unwrap();
        toast.success('Exam created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedExam?._id ? 'Failed to update exam' : 'Failed to create exam'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Exams</h1>
        {canModify && (
          <button
            onClick={handleAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Exam
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
                  placeholder="Search exams..."
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
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Class
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.exams.map((exam) => (
                <tr key={exam._id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {exam.name}
                    </div>
                    <div className="text-sm text-gray-500">{exam.type}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {exam.subject.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {exam.subject.code}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {exam.class.name} - {exam.section}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {new Date(exam.date).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-500">
                      {exam.duration} minutes
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        exam.isPublished
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {exam.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(exam)}
                      className="text-indigo-600 hover:text-indigo-900 mr-4"
                    >
                      <PencilIcon className="h-5 w-5" />
                    </button>
                    {!exam.isPublished && canPublish && (
                      <button
                        onClick={() => handlePublish(exam._id)}
                        className="text-green-600 hover:text-green-900 mr-4"
                      >
                        <CheckCircleIcon className="h-5 w-5" />
                      </button>
                    )}
                    {user?.role === UserRole.SUPER_ADMIN && (
                      <button
                        onClick={() => handleDelete(exam._id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    )}
                  </td>
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
        title={selectedExam ? 'Edit Exam' : 'Add Exam'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              Exam Name
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-gray-700"
            >
              Exam Type
            </label>
            <select
              id="type"
              value={formData.type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  type: e.target.value as ExamFormData['type'],
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              <option value="TEST">Test</option>
              <option value="MIDTERM">Midterm</option>
              <option value="FINAL">Final</option>
              <option value="ASSIGNMENT">Assignment</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="date"
                className="block text-sm font-medium text-gray-700"
              >
                Date
              </label>
              <input
                type="date"
                id="date"
                value={formData.date}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, date: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="duration"
                className="block text-sm font-medium text-gray-700"
              >
                Duration (minutes)
              </label>
              <input
                type="number"
                id="duration"
                value={formData.duration}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    duration: parseInt(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
                min="1"
              />
            </div>

            <div>
              <label
                htmlFor="totalMarks"
                className="block text-sm font-medium text-gray-700"
              >
                Total Marks
              </label>
              <input
                type="number"
                id="totalMarks"
                value={formData.totalMarks}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    totalMarks: parseInt(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
                min="1"
              />
            </div>

            <div>
              <label
                htmlFor="passingMarks"
                className="block text-sm font-medium text-gray-700"
              >
                Passing Marks
              </label>
              <input
                type="number"
                id="passingMarks"
                value={formData.passingMarks}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    passingMarks: parseInt(e.target.value),
                  }))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                required
                min="1"
                max={formData.totalMarks}
              />
            </div>
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
              {selectedExam ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Exams; 