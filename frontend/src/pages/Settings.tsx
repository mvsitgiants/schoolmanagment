import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetSettingsQuery,
  useUpdateSettingsMutation,
} from '../store/slices/settingsApi';
import {
  Cog6ToothIcon,
  BellIcon,
  BuildingLibraryIcon,
  AcademicCapIcon,
  CurrencyDollarIcon,
  EnvelopeIcon,
  CloudIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

interface SchoolSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logo?: string;
  academicYear: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  currency: string;
}

interface NotificationSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  attendanceAlerts: boolean;
  feeReminders: boolean;
  examResults: boolean;
  homeworkUpdates: boolean;
}

interface AcademicSettings {
  gradesSystem: 'PERCENTAGE' | 'GPA' | 'LETTER';
  passingPercentage: number;
  attendanceThreshold: number;
  lateArrivalThreshold: number;
  examRetakes: boolean;
  homeworkSubmissionDeadline: number;
}

interface FeesSettings {
  lateFeePercentage: number;
  gracePeriod: number;
  allowPartialPayment: boolean;
  autoReminders: boolean;
  paymentMethods: string[];
}

interface SystemSettings {
  school: SchoolSettings;
  notifications: NotificationSettings;
  academic: AcademicSettings;
  fees: FeesSettings;
}

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'school' | 'notifications' | 'academic' | 'fees'
  >('school');

  const { user } = useSelector((state: RootState) => state.auth);
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [updateSettings] = useUpdateSettingsMutation();

  const canModify = user?.role === UserRole.SUPER_ADMIN;

  const handleSave = async (
    section: keyof SystemSettings,
    data: Partial<SystemSettings[keyof SystemSettings]>
  ) => {
    if (!canModify) return;

    try {
      await updateSettings({
        section,
        settings: data,
      }).unwrap();
      toast.success('Settings updated successfully');
    } catch (error) {
      toast.error('Failed to update settings');
    }
  };

  const renderSchoolSettings = () => {
    if (!settings) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              School Name
            </label>
            <input
              type="text"
              value={settings.school.name}
              onChange={(e) =>
                handleSave('school', { name: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={settings.school.email}
              onChange={(e) =>
                handleSave('school', { email: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Phone
            </label>
            <input
              type="tel"
              value={settings.school.phone}
              onChange={(e) =>
                handleSave('school', { phone: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Website
            </label>
            <input
              type="url"
              value={settings.school.website}
              onChange={(e) =>
                handleSave('school', { website: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Address
            </label>
            <textarea
              value={settings.school.address}
              onChange={(e) =>
                handleSave('school', { address: e.target.value })
              }
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Academic Year
            </label>
            <input
              type="text"
              value={settings.school.academicYear}
              onChange={(e) =>
                handleSave('school', { academicYear: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Timezone
            </label>
            <select
              value={settings.school.timezone}
              onChange={(e) =>
                handleSave('school', { timezone: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern Time</option>
              <option value="America/Chicago">Central Time</option>
              <option value="America/Denver">Mountain Time</option>
              <option value="America/Los_Angeles">Pacific Time</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Date Format
            </label>
            <select
              value={settings.school.dateFormat}
              onChange={(e) =>
                handleSave('school', { dateFormat: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            >
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Time Format
            </label>
            <select
              value={settings.school.timeFormat}
              onChange={(e) =>
                handleSave('school', { timeFormat: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            >
              <option value="12">12-hour</option>
              <option value="24">24-hour</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Currency
            </label>
            <select
              value={settings.school.currency}
              onChange={(e) =>
                handleSave('school', { currency: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="INR">INR (₹)</option>
            </select>
          </div>
        </div>
      </div>
    );
  };

  const renderNotificationSettings = () => {
    if (!settings) return null;

    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Email Notifications
              </h3>
              <p className="text-sm text-gray-500">
                Send notifications via email
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.emailNotifications}
                onChange={(e) =>
                  handleSave('notifications', {
                    emailNotifications: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                SMS Notifications
              </h3>
              <p className="text-sm text-gray-500">
                Send notifications via SMS
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.smsNotifications}
                onChange={(e) =>
                  handleSave('notifications', {
                    smsNotifications: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Attendance Alerts
              </h3>
              <p className="text-sm text-gray-500">
                Send alerts for absent students
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.attendanceAlerts}
                onChange={(e) =>
                  handleSave('notifications', {
                    attendanceAlerts: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Fee Reminders
              </h3>
              <p className="text-sm text-gray-500">
                Send reminders for fee payments
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.feeReminders}
                onChange={(e) =>
                  handleSave('notifications', {
                    feeReminders: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Exam Results
              </h3>
              <p className="text-sm text-gray-500">
                Send notifications for exam results
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.examResults}
                onChange={(e) =>
                  handleSave('notifications', {
                    examResults: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Homework Updates
              </h3>
              <p className="text-sm text-gray-500">
                Send notifications for homework assignments
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications.homeworkUpdates}
                onChange={(e) =>
                  handleSave('notifications', {
                    homeworkUpdates: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAcademicSettings = () => {
    if (!settings) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Grades System
            </label>
            <select
              value={settings.academic.gradesSystem}
              onChange={(e) =>
                handleSave('academic', {
                  gradesSystem: e.target.value as AcademicSettings['gradesSystem'],
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
            >
              <option value="PERCENTAGE">Percentage</option>
              <option value="GPA">GPA</option>
              <option value="LETTER">Letter Grade</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Passing Percentage
            </label>
            <input
              type="number"
              value={settings.academic.passingPercentage}
              onChange={(e) =>
                handleSave('academic', {
                  passingPercentage: parseInt(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="0"
              max="100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Attendance Threshold (%)
            </label>
            <input
              type="number"
              value={settings.academic.attendanceThreshold}
              onChange={(e) =>
                handleSave('academic', {
                  attendanceThreshold: parseInt(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="0"
              max="100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Late Arrival Threshold (minutes)
            </label>
            <input
              type="number"
              value={settings.academic.lateArrivalThreshold}
              onChange={(e) =>
                handleSave('academic', {
                  lateArrivalThreshold: parseInt(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="0"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Allow Exam Retakes
              </h3>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.academic.examRetakes}
                onChange={(e) =>
                  handleSave('academic', {
                    examRetakes: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Homework Submission Deadline (days)
            </label>
            <input
              type="number"
              value={settings.academic.homeworkSubmissionDeadline}
              onChange={(e) =>
                handleSave('academic', {
                  homeworkSubmissionDeadline: parseInt(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="1"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderFeesSettings = () => {
    if (!settings) return null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Late Fee Percentage
            </label>
            <input
              type="number"
              value={settings.fees.lateFeePercentage}
              onChange={(e) =>
                handleSave('fees', {
                  lateFeePercentage: parseFloat(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="0"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Grace Period (days)
            </label>
            <input
              type="number"
              value={settings.fees.gracePeriod}
              onChange={(e) =>
                handleSave('fees', {
                  gracePeriod: parseInt(e.target.value),
                })
              }
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              disabled={!canModify}
              min="0"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Allow Partial Payment
              </h3>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.fees.allowPartialPayment}
                onChange={(e) =>
                  handleSave('fees', {
                    allowPartialPayment: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Automatic Reminders
              </h3>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={settings.fees.autoReminders}
                onChange={(e) =>
                  handleSave('fees', {
                    autoReminders: e.target.checked,
                  })
                }
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                disabled={!canModify}
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Payment Methods
            </label>
            <div className="mt-2 space-y-2">
              {['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE'].map((method) => (
                <div key={method} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.fees.paymentMethods.includes(method)}
                    onChange={(e) => {
                      const methods = e.target.checked
                        ? [...settings.fees.paymentMethods, method]
                        : settings.fees.paymentMethods.filter(
                            (m) => m !== method
                          );
                      handleSave('fees', { paymentMethods: methods });
                    }}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    disabled={!canModify}
                  />
                  <label className="ml-2 text-sm text-gray-700">
                    {method.replace('_', ' ')}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('school')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'school'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BuildingLibraryIcon className="h-5 w-5 inline-block mr-2" />
              School
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'notifications'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BellIcon className="h-5 w-5 inline-block mr-2" />
              Notifications
            </button>
            <button
              onClick={() => setActiveTab('academic')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'academic'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <AcademicCapIcon className="h-5 w-5 inline-block mr-2" />
              Academic
            </button>
            <button
              onClick={() => setActiveTab('fees')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'fees'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <CurrencyDollarIcon className="h-5 w-5 inline-block mr-2" />
              Fees
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'school' && renderSchoolSettings()}
          {activeTab === 'notifications' && renderNotificationSettings()}
          {activeTab === 'academic' && renderAcademicSettings()}
          {activeTab === 'fees' && renderFeesSettings()}
        </div>
      </div>
    </div>
  );
};

export default Settings; 