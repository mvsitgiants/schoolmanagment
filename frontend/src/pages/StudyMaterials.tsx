import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetStudyMaterialsQuery,
  useCreateStudyMaterialMutation,
  useUpdateStudyMaterialMutation,
  useDeleteStudyMaterialMutation,
  StudyMaterial,
} from '../store/slices/studyMaterialApi';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import Modal from '../components/common/Modal';
import { toast } from 'react-toastify';

interface StudyMaterialFormData {
  title: string;
  description: string;
  subject: string;
  class: string;
  type: 'NOTES' | 'ASSIGNMENT' | 'SYLLABUS' | 'OTHER';
  fileUrl: string;
  tags: string[];
}

const StudyMaterials: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<Partial<StudyMaterial> | null>(
    null
  );
  const [formData, setFormData] = useState<StudyMaterialFormData>({
    title: '',
    description: '',
    subject: '',
    class: '',
    type: 'NOTES',
    fileUrl: '',
    tags: [],
  });

  const { user } = useSelector((state: RootState) => state.auth);
  const { data, isLoading } = useGetStudyMaterialsQuery({
    page,
    search,
  });

  const [createStudyMaterial] = useCreateStudyMaterialMutation();
  const [updateStudyMaterial] = useUpdateStudyMaterialMutation();
  const [deleteStudyMaterial] = useDeleteStudyMaterialMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN || 
                    user?.role === UserRole.ADMIN || 
                    user?.role === UserRole.TEACHER;

  const handleAdd = () => {
    setSelectedMaterial(null);
    setFormData({
      title: '',
      description: '',
      subject: '',
      class: '',
      type: 'NOTES',
      fileUrl: '',
      tags: [],
    });
    setIsModalOpen(true);
  };

  const handleEdit = (material: StudyMaterial) => {
    setSelectedMaterial(material);
    setFormData({
      title: material.title,
      description: material.description,
      subject: material.subject._id,
      class: material.class._id,
      type: material.type,
      fileUrl: material.fileUrl,
      tags: material.tags,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this material?')) {
      try {
        await deleteStudyMaterial(id).unwrap();
        toast.success('Study material deleted successfully');
      } catch (error) {
        toast.error('Failed to delete study material');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedMaterial?._id) {
        await updateStudyMaterial({
          id: selectedMaterial._id,
          material: formData,
        }).unwrap();
        toast.success('Study material updated successfully');
      } else {
        await createStudyMaterial(formData).unwrap();
        toast.success('Study material created successfully');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error(
        selectedMaterial?._id
          ? 'Failed to update study material'
          : 'Failed to create study material'
      );
    }
  };

  const handleDownload = (fileUrl: string) => {
    window.open(fileUrl, '_blank');
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'NOTES':
        return 'bg-blue-100 text-blue-800';
      case 'ASSIGNMENT':
        return 'bg-yellow-100 text-yellow-800';
      case 'SYLLABUS':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Study Materials</h1>
        {canModify && (
          <button
            onClick={handleAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 flex items-center"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Material
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
                  placeholder="Search materials..."
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
                  Subject & Class
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploaded By
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.materials.map((material) => (
                <tr key={material._id}>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {material.title}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {material.description}
                    </div>
                    {material.tags.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {material.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {material.subject.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      Class {material.class.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getTypeColor(
                        material.type
                      )}`}
                    >
                      {material.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {material.uploadedBy.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(material.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleDownload(material.fileUrl)}
                      className="text-green-600 hover:text-green-900 mr-4"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                    </button>
                    {canModify && (
                      <>
                        <button
                          onClick={() => handleEdit(material)}
                          className="text-indigo-600 hover:text-indigo-900 mr-4"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        {user?.role === UserRole.SUPER_ADMIN && (
                          <button
                            onClick={() => handleDelete(material._id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        )}
                      </>
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
        title={selectedMaterial ? 'Edit Material' : 'Add Material'}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
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
              required
            />
          </div>

          <div>
            <label
              htmlFor="type"
              className="block text-sm font-medium text-gray-700"
            >
              Type
            </label>
            <select
              id="type"
              value={formData.type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  type: e.target.value as StudyMaterialFormData['type'],
                }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            >
              <option value="NOTES">Notes</option>
              <option value="ASSIGNMENT">Assignment</option>
              <option value="SYLLABUS">Syllabus</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="fileUrl"
              className="block text-sm font-medium text-gray-700"
            >
              File URL
            </label>
            <input
              type="url"
              id="fileUrl"
              value={formData.fileUrl}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, fileUrl: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="tags"
              className="block text-sm font-medium text-gray-700"
            >
              Tags (comma-separated)
            </label>
            <input
              type="text"
              id="tags"
              value={formData.tags.join(', ')}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tags: e.target.value.split(',').map((tag) => tag.trim()),
                }))
              }
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
              {selectedMaterial ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default StudyMaterials; 