import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  useGetUserProfileQuery,
  useUpdateUserProfileMutation,
  useChangePasswordMutation,
} from '../store/slices/userApi';
import {
  UserCircleIcon,
  KeyIcon,
  BellIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

interface ProfileFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  avatar?: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  bio?: string;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface PreferencesFormData {
  emailNotifications: boolean;
  smsNotifications: boolean;
  language: string;
  theme: 'light' | 'dark' | 'system';
  timezone: string;
}

const Profile: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'profile' | 'password' | 'preferences' | 'security'
  >('profile');

  const { user } = useSelector((state: RootState) => state.auth);
  const { data: profile, isLoading } = useGetUserProfileQuery();
  const [updateProfile] = useUpdateUserProfileMutation();
  const [changePassword] = useChangePasswordMutation();

  const [profileForm, setProfileForm] = useState<ProfileFormData>({
    name: '',
    email: '',
    phone: '',
    address: '',
    dateOfBirth: '',
    gender: 'MALE',
  });

  const [passwordForm, setPasswordForm] = useState<PasswordFormData>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [preferencesForm, setPreferencesForm] = useState<PreferencesFormData>({
    emailNotifications: true,
    smsNotifications: true,
    language: 'en',
    theme: 'system',
    timezone: 'UTC',
  });

  // Update form data when profile is loaded
  React.useEffect(() => {
    if (profile) {
      setProfileForm({
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        avatar: profile.avatar,
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        bio: profile.bio,
      });
      setPreferencesForm({
        emailNotifications: profile.preferences.emailNotifications,
        smsNotifications: profile.preferences.smsNotifications,
        language: profile.preferences.language,
        theme: profile.preferences.theme,
        timezone: profile.preferences.timezone,
      });
    }
  }, [profile]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile(profileForm).unwrap();
      toast.success('Profile updated successfully');
    } catch (error) {
      toast.error('Failed to update profile');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }).unwrap();
      toast.success('Password changed successfully');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error) {
      toast.error('Failed to change password');
    }
  };

  const handlePreferencesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile({ preferences: preferencesForm }).unwrap();
      toast.success('Preferences updated successfully');
    } catch (error) {
      toast.error('Failed to update preferences');
    }
  };

  const renderProfileForm = () => (
    <form onSubmit={handleProfileSubmit} className="space-y-6">
      <div className="flex items-center">
        <div className="h-24 w-24 rounded-full bg-gray-200 flex items-center justify-center">
          {profileForm.avatar ? (
            <img
              src={profileForm.avatar}
              alt="Profile"
              className="h-24 w-24 rounded-full object-cover"
            />
          ) : (
            <UserCircleIcon className="h-16 w-16 text-gray-400" />
          )}
        </div>
        <div className="ml-6">
          <label className="block text-sm font-medium text-gray-700">
            Profile Photo
          </label>
          <div className="mt-1 flex items-center">
            <button
              type="button"
              className="ml-5 bg-white py-2 px-3 border border-gray-300 rounded-md shadow-sm text-sm leading-4 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Change
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Full Name
          </label>
          <input
            type="text"
            value={profileForm.name}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, name: e.target.value }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            value={profileForm.email}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, email: e.target.value }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            type="tel"
            value={profileForm.phone}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, phone: e.target.value }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Date of Birth
          </label>
          <input
            type="date"
            value={profileForm.dateOfBirth}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Gender
          </label>
          <select
            value={profileForm.gender}
            onChange={(e) =>
              setProfileForm((prev) => ({
                ...prev,
                gender: e.target.value as ProfileFormData['gender'],
              }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          >
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700">
            Address
          </label>
          <textarea
            value={profileForm.address}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, address: e.target.value }))
            }
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            required
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700">Bio</label>
          <textarea
            value={profileForm.bio}
            onChange={(e) =>
              setProfileForm((prev) => ({ ...prev, bio: e.target.value }))
            }
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Save Changes
        </button>
      </div>
    </form>
  );

  const renderPasswordForm = () => (
    <form onSubmit={handlePasswordSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Current Password
        </label>
        <input
          type="password"
          value={passwordForm.currentPassword}
          onChange={(e) =>
            setPasswordForm((prev) => ({
              ...prev,
              currentPassword: e.target.value,
            }))
          }
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          New Password
        </label>
        <input
          type="password"
          value={passwordForm.newPassword}
          onChange={(e) =>
            setPasswordForm((prev) => ({
              ...prev,
              newPassword: e.target.value,
            }))
          }
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Confirm New Password
        </label>
        <input
          type="password"
          value={passwordForm.confirmPassword}
          onChange={(e) =>
            setPasswordForm((prev) => ({
              ...prev,
              confirmPassword: e.target.value,
            }))
          }
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          required
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Change Password
        </button>
      </div>
    </form>
  );

  const renderPreferencesForm = () => (
    <form onSubmit={handlePreferencesSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Language
          </label>
          <select
            value={preferencesForm.language}
            onChange={(e) =>
              setPreferencesForm((prev) => ({
                ...prev,
                language: e.target.value,
              }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Theme
          </label>
          <select
            value={preferencesForm.theme}
            onChange={(e) =>
              setPreferencesForm((prev) => ({
                ...prev,
                theme: e.target.value as PreferencesFormData['theme'],
              }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Timezone
          </label>
          <select
            value={preferencesForm.timezone}
            onChange={(e) =>
              setPreferencesForm((prev) => ({
                ...prev,
                timezone: e.target.value,
              }))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="UTC">UTC</option>
            <option value="America/New_York">Eastern Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Los_Angeles">Pacific Time</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Email Notifications
            </h3>
            <p className="text-sm text-gray-500">
              Receive notifications via email
            </p>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={preferencesForm.emailNotifications}
              onChange={(e) =>
                setPreferencesForm((prev) => ({
                  ...prev,
                  emailNotifications: e.target.checked,
                }))
              }
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              SMS Notifications
            </h3>
            <p className="text-sm text-gray-500">
              Receive notifications via SMS
            </p>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={preferencesForm.smsNotifications}
              onChange={(e) =>
                setPreferencesForm((prev) => ({
                  ...prev,
                  smsNotifications: e.target.checked,
                }))
              }
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Save Preferences
        </button>
      </div>
    </form>
  );

  const renderSecuritySettings = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">
          Two-Factor Authentication
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Add an extra layer of security to your account
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Set up 2FA
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-gray-900">Active Sessions</h3>
        <p className="mt-1 text-sm text-gray-500">
          Manage your active sessions across devices
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            View Active Sessions
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-gray-900">Login History</h3>
        <p className="mt-1 text-sm text-gray-500">
          View your recent login activity
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            View Login History
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          Profile & Settings
        </h1>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            <button
              onClick={() => setActiveTab('profile')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'profile'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <UserCircleIcon className="h-5 w-5 inline-block mr-2" />
              Profile
            </button>
            <button
              onClick={() => setActiveTab('password')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'password'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <KeyIcon className="h-5 w-5 inline-block mr-2" />
              Password
            </button>
            <button
              onClick={() => setActiveTab('preferences')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'preferences'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Cog6ToothIcon className="h-5 w-5 inline-block mr-2" />
              Preferences
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                activeTab === 'security'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <ShieldCheckIcon className="h-5 w-5 inline-block mr-2" />
              Security
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'profile' && renderProfileForm()}
          {activeTab === 'password' && renderPasswordForm()}
          {activeTab === 'preferences' && renderPreferencesForm()}
          {activeTab === 'security' && renderSecuritySettings()}
        </div>
      </div>
    </div>
  );
};

export default Profile; 