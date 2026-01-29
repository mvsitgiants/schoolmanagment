import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetGradesQuery,
  useCreateGradeMutation,
  useUpdateGradeMutation,
  useDeleteGradeMutation,
  Grade,
} from '../store/slices/examApi';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  DocumentDownloadIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface GradeFormData {
  exam: string;
  student: string;
  marksObtained: number;
  remarks?: string;
}

const Grades: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [examId, setExamId] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<Partial<Grade> | null>(null);
  const [formData, setFormData] = useState<GradeFormData>({
    exam: '',
    student: '',
    marksObtained: 0,
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data, isLoading } = useGetGradesQuery({
    page,
    search,
    examId,
  });

  const [createGrade] = useCreateGradeMutation();
  const [updateGrade] = useUpdateGradeMutation();
  const [deleteGrade] = useDeleteGradeMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.TEACHER;

  const handleAdd = () => {
    setSelectedGrade(null);
    setFormData({
      exam: '',
      student: '',
      marksObtained: 0,
    });
    setIsModalOpen(true);
  };

  const handleEdit = (grade: Grade) => {
    setSelectedGrade(grade);
    setFormData({
      exam: grade.exam._id,
      student: grade.student._id,
      marksObtained: grade.marksObtained,
      remarks: grade.remarks,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this grade?')) {
      try {
        await deleteGrade(id).unwrap();
        toast.success('Grade deleted successfully');
      } catch (error) {
        toast.error('Failed to delete grade');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedGrade?._id) {
        await updateGrade({
          id: selectedGrade._id,
          grade: formData,
        }).unwrap();
        toast.success('Grade updated successfully');
      } else {
        await createGrade(formData).unwrap();
        toast.success('Grade created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedGrade?._id ? 'Failed to update grade' : 'Failed to create grade'
      );
    }
  };

  const calculatePercentage = (marksObtained: number, totalMarks: number) => {
    return ((marksObtained / totalMarks) * 100).toFixed(1) + '%';
  };

  const getGradeStatus = (marksObtained: number, passingMarks: number) => {
    return marksObtained >= passingMarks ? (
      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
        Pass
      </span>
    ) : (
      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
        Fail
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Grades</h1>
        {canModify && (
          <button
            onClick={handleAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Grade
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
                  placeholder="Search students..."
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
                  Student
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Exam
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Marks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Graded By
                </th>
                {canModify && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.grades.map((grade) => (
                <tr key={grade._id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {grade.student.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      Roll No: {grade.student.rollNumber}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {grade.exam.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {grade.exam.subject.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {grade.marksObtained} / {grade.exam.totalMarks}
                    </div>
                    <div className="text-sm text-gray-500">
                      {calculatePercentage(
                        grade.marksObtained,
                        grade.exam.totalMarks
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getGradeStatus(grade.marksObtained, grade.exam.passingMarks)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {grade.gradedBy.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(grade.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  {canModify && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(grade)}
                        className="text-indigo-600 hover:text-indigo-900 mr-4"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      {user?.role === UserRole.SUPER_ADMIN && (
                        <button
                          onClick={() => handleDelete(grade._id)}
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
        title={selectedGrade ? 'Edit Grade' : 'Add Grade'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="marksObtained"
              className="block text-sm font-medium text-gray-700"
            >
              Marks Obtained
            </label>
            <input
              type="number"
              id="marksObtained"
              value={formData.marksObtained}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  marksObtained: parseInt(e.target.value),
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
              min="0"
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
              value={formData.remarks}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, remarks: e.target.value }))
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
              {selectedGrade ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Grades; 