import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  BuildingOfficeIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';

const SystemManagement: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);

  // Check if user has SUPER_ADMIN role
  if (user?.role !== UserRole.SUPER_ADMIN) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldCheckIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  const systemStats = [
    {
      title: 'Total Schools',
      value: '15',
      icon: BuildingOfficeIcon,
      color: 'bg-blue-500',
      description: 'Active institutions in the system'
    },
    {
      title: 'System Users',
      value: '45,678',
      icon: UserGroupIcon,
      color: 'bg-green-500',
      description: 'Total registered users'
    },
    {
      title: 'Active Sessions',
      value: '1,234',
      icon: ServerIcon,
      color: 'bg-purple-500',
      description: 'Current online users'
    },
    {
      title: 'System Health',
      value: '98%',
      icon: ShieldCheckIcon,
      color: 'bg-green-600',
      description: 'Overall system performance'
    }
  ];

  const managementSections = [
    {
      title: 'School Management',
      description: 'Manage all schools in the system',
      icon: BuildingOfficeIcon,
      color: 'bg-blue-500',
      features: ['Add new schools', 'Configure school settings', 'Monitor school performance', 'Manage school subscriptions']
    },
    {
      title: 'User Management',
      description: 'Manage system-wide user accounts',
      icon: UserGroupIcon,
      color: 'bg-green-500',
      features: ['Create admin accounts', 'Manage user permissions', 'Monitor user activity', 'Handle user disputes']
    },
    {
      title: 'System Configuration',
      description: 'Configure system-wide settings',
      icon: Cog6ToothIcon,
      color: 'bg-purple-500',
      features: ['System preferences', 'Security settings', 'Backup configuration', 'API management']
    },
    {
      title: 'Analytics & Reports',
      description: 'System-wide analytics and reporting',
      icon: ChartBarIcon,
      color: 'bg-yellow-500',
      features: ['System performance metrics', 'Usage analytics', 'Financial reports', 'Custom reports']
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">System Management</h1>
          <p className="text-gray-500">Manage the entire school management system</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">System Administrator</p>
          <p className="text-sm font-medium text-gray-900">{user?.name}</p>
        </div>
      </div>

      {/* System Statistics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {systemStats.map((stat) => (
          <div key={stat.title} className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <stat.icon className={`h-6 w-6 text-white p-1.5 rounded-full ${stat.color}`} />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">{stat.title}</dt>
                    <dd className="text-lg font-semibold text-gray-900">{stat.value}</dd>
                  </dl>
                </div>
              </div>
              <div className="mt-2">
                <p className="text-xs text-gray-500">{stat.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Management Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {managementSections.map((section) => (
          <div key={section.title} className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center mb-4">
              <section.icon className={`h-8 w-8 text-white p-1.5 rounded-lg ${section.color} mr-3`} />
              <div>
                <h3 className="text-lg font-medium text-gray-900">{section.title}</h3>
                <p className="text-sm text-gray-500">{section.description}</p>
              </div>
            </div>
            <div className="space-y-2">
              {section.features.map((feature, index) => (
                <div key={index} className="flex items-center text-sm text-gray-600">
                  <div className={`w-2 h-2 rounded-full ${section.color} mr-3`}></div>
                  {feature}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button className={`w-full px-4 py-2 text-sm font-medium text-white ${section.color} rounded-md hover:opacity-90 transition-opacity`}>
                Manage {section.title}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <BuildingOfficeIcon className="h-5 w-5 mr-2" />
            Add New School
          </button>
          <button className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <UserGroupIcon className="h-5 w-5 mr-2" />
            Create Admin
          </button>
          <button className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <Cog6ToothIcon className="h-5 w-5 mr-2" />
            System Settings
          </button>
          <button className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <ChartBarIcon className="h-5 w-5 mr-2" />
            View Reports
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemManagement; 