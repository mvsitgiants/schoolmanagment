import React from 'react';
import { useForm } from 'react-hook-form';
import { Student } from '../../store/slices/studentApi';

interface StudentFormProps {
  student?: Partial<Student>;
  onSubmit: (data: Partial<Student>) => void;
  onCancel: () => void;
  isLoading: boolean;
}

const StudentForm: React.FC<StudentFormProps> = ({
  student,
  onSubmit,
  onCancel,
  isLoading,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Partial<Student>>({
    defaultValues: student || {},
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700"
          >
            Name
          </label>
          <input
            type="text"
            id="name"
            {...register('name', { required: 'Name is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email
          </label>
          <input
            type="email"
            id="email"
            {...register('email', {
              required: 'Email is required',
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: 'Invalid email address',
              },
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="class"
            className="block text-sm font-medium text-gray-700"
          >
            Class
          </label>
          <input
            type="text"
            id="class"
            {...register('class', { required: 'Class is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.class && (
            <p className="mt-1 text-sm text-red-600">{errors.class.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="section"
            className="block text-sm font-medium text-gray-700"
          >
            Section
          </label>
          <input
            type="text"
            id="section"
            {...register('section', { required: 'Section is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.section && (
            <p className="mt-1 text-sm text-red-600">{errors.section.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="rollNumber"
            className="block text-sm font-medium text-gray-700"
          >
            Roll Number
          </label>
          <input
            type="text"
            id="rollNumber"
            {...register('rollNumber', { required: 'Roll number is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.rollNumber && (
            <p className="mt-1 text-sm text-red-600">
              {errors.rollNumber.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="admissionNumber"
            className="block text-sm font-medium text-gray-700"
          >
            Admission Number
          </label>
          <input
            type="text"
            id="admissionNumber"
            {...register('admissionNumber', {
              required: 'Admission number is required',
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.admissionNumber && (
            <p className="mt-1 text-sm text-red-600">
              {errors.admissionNumber.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="dateOfBirth"
            className="block text-sm font-medium text-gray-700"
          >
            Date of Birth
          </label>
          <input
            type="date"
            id="dateOfBirth"
            {...register('dateOfBirth', { required: 'Date of birth is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.dateOfBirth && (
            <p className="mt-1 text-sm text-red-600">
              {errors.dateOfBirth.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="gender"
            className="block text-sm font-medium text-gray-700"
          >
            Gender
          </label>
          <select
            id="gender"
            {...register('gender', { required: 'Gender is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="">Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
          {errors.gender && (
            <p className="mt-1 text-sm text-red-600">{errors.gender.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="contactNumber"
            className="block text-sm font-medium text-gray-700"
          >
            Contact Number
          </label>
          <input
            type="tel"
            id="contactNumber"
            {...register('contactNumber', {
              required: 'Contact number is required',
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.contactNumber && (
            <p className="mt-1 text-sm text-red-600">
              {errors.contactNumber.message}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor="address"
            className="block text-sm font-medium text-gray-700"
          >
            Address
          </label>
          <textarea
            id="address"
            rows={3}
            {...register('address', { required: 'Address is required' })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {errors.address && (
            <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
};

export default StudentForm; 