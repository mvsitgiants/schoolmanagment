import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { UserRole } from '../types/user.types';
import {
  ChartBarIcon,
  ChartPieIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  FunnelIcon,
  DocumentArrowDownIcon,
  EyeIcon,
  ClockIcon,
  AcademicCapIcon,
  BookOpenIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';

interface AnalyticsData {
  totalRevenue: number;
  totalUsers: number;
  totalSchools: number;
  systemUptime: number;
  activeSessions: number;
  monthlyGrowth: {
    revenue: number;
    users: number;
    schools: number;
  };
}

interface ChartData {
  month: string;
  revenue: number;
  users: number;
  schools: number;
  attendance: number;
}

interface SchoolPerformance {
  id: string;
  name: string;
  students: number;
  teachers: number;
  revenue: number;
  growth: number;
  attendance: number;
  performance: number;
}

const Analytics: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [selectedPeriod, setSelectedPeriod] = useState('6months');
  const [selectedMetric, setSelectedMetric] = useState('revenue');
  const [viewMode, setViewMode] = useState('overview');
  const [isLoading, setIsLoading] = useState(false);

  // Check if user has access to analytics
  const canAccessAnalytics = user?.role === UserRole.SUPER_ADMIN || 
                           user?.role === UserRole.ADMIN || 
                           user?.role === UserRole.ACCOUNTANT;

  if (!canAccessAnalytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldCheckIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You don't have permission to access analytics.</p>
          <p className="text-sm text-gray-400 mt-2">Required roles: SUPER_ADMIN, ADMIN, ACCOUNTANT</p>
        </div>
      </div>
    );
  }

  // Mock data - in real app, this would come from API
  const analyticsData: AnalyticsData = {
    totalRevenue: 2345678,
    totalUsers: 45678,
    totalSchools: 15,
    systemUptime: 99.8,
    activeSessions: 1234,
    monthlyGrowth: {
      revenue: 12.5,
      users: 8.2,
      schools: 2.0
    }
  };

  const chartData: ChartData[] = [
    { month: 'Jan', revenue: 180000, users: 42000, schools: 12, attendance: 94 },
    { month: 'Feb', revenue: 190000, users: 43000, schools: 13, attendance: 95 },
    { month: 'Mar', revenue: 210000, users: 44000, schools: 13, attendance: 93 },
    { month: 'Apr', revenue: 220000, users: 45000, schools: 14, attendance: 96 },
    { month: 'May', revenue: 230000, users: 45500, schools: 14, attendance: 94 },
    { month: 'Jun', revenue: 234567, users: 45678, schools: 15, attendance: 95 }
  ];

  const topSchools: SchoolPerformance[] = [
    { id: '1', name: 'ABC International School', students: 2500, teachers: 120, revenue: 450000, growth: 15, attendance: 96, performance: 92 },
    { id: '2', name: 'XYZ Academy', students: 2200, teachers: 110, revenue: 420000, growth: 12, attendance: 94, performance: 89 },
    { id: '3', name: 'Global Education Center', students: 2000, teachers: 95, revenue: 380000, growth: 18, attendance: 93, performance: 87 },
    { id: '4', name: 'Elite Preparatory School', students: 1800, teachers: 85, revenue: 350000, growth: 10, attendance: 95, performance: 85 },
    { id: '5', name: 'Future Leaders Academy', students: 1600, teachers: 75, revenue: 320000, growth: 14, attendance: 92, performance: 83 }
  ];

  const getMetricValue = (metric: string) => {
    switch (metric) {
      case 'revenue':
        return analyticsData.totalRevenue;
      case 'users':
        return analyticsData.totalUsers;
      case 'schools':
        return analyticsData.totalSchools;
      default:
        return 0;
    }
  };

  const getMetricGrowth = (metric: string) => {
    switch (metric) {
      case 'revenue':
        return analyticsData.monthlyGrowth.revenue;
      case 'users':
        return analyticsData.monthlyGrowth.users;
      case 'schools':
        return analyticsData.monthlyGrowth.schools;
      default:
        return 0;
    }
  };

  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case 'revenue':
        return CurrencyDollarIcon;
      case 'users':
        return UserGroupIcon;
      case 'schools':
        return BuildingOfficeIcon;
      default:
        return ChartBarIcon;
    }
  };

  const getMetricColor = (metric: string) => {
    switch (metric) {
      case 'revenue':
        return 'bg-green-500';
      case 'users':
        return 'bg-blue-500';
      case 'schools':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const generateReport = () => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      alert('Report generated successfully!');
    }, 2000);
  };

  const exportData = () => {
    setIsLoading(true);
    // Simulate export
    setTimeout(() => {
      setIsLoading(false);
      alert('Data exported successfully!');
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics & Reports</h1>
          <p className="text-gray-500">
            {user?.role === UserRole.SUPER_ADMIN ? 'System-wide analytics and performance metrics' : 
             user?.role === UserRole.ADMIN ? 'School analytics and performance metrics' : 
             'Financial analytics and reporting'}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="text-right">
            <p className="text-sm text-gray-500">
              {user?.role === UserRole.SUPER_ADMIN ? 'System Administrator' :
               user?.role === UserRole.ADMIN ? 'School Administrator' : 'Accountant'}
            </p>
            <p className="text-sm font-medium text-gray-900">{user?.name}</p>
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Period</label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="1month">Last Month</option>
                <option value="3months">Last 3 Months</option>
                <option value="6months">Last 6 Months</option>
                <option value="1year">Last Year</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Primary Metric</label>
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="revenue">Revenue</option>
                <option value="users">Users</option>
                <option value="schools">Schools</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">View Mode</label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="overview">Overview</option>
                <option value="detailed">Detailed</option>
                <option value="comparison">Comparison</option>
              </select>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={generateReport}
              disabled={isLoading}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <DocumentArrowDownIcon className="h-4 w-4 mr-2" />
              {isLoading ? 'Generating...' : 'Generate Report'}
            </button>
            <button
              onClick={exportData}
              disabled={isLoading}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              <EyeIcon className="h-4 w-4 mr-2" />
              {isLoading ? 'Exporting...' : 'Export Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {['revenue', 'users', 'schools', 'uptime'].map((metric) => {
          const Icon = metric === 'uptime' ? ShieldCheckIcon : getMetricIcon(metric);
          const color = metric === 'uptime' ? 'bg-yellow-500' : getMetricColor(metric);
          const value = metric === 'uptime' ? analyticsData.systemUptime : getMetricValue(metric);
          const growth = metric === 'uptime' ? -0.1 : getMetricGrowth(metric);
          const formattedValue = metric === 'revenue' ? formatCurrency(value) : 
                                metric === 'uptime' ? `${value}%` : formatNumber(value);
          const title = metric === 'revenue' ? 'Total Revenue' :
                       metric === 'users' ? 'Total Users' :
                       metric === 'schools' ? 'Total Schools' : 'System Uptime';

          return (
            <div key={metric} className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Icon className={`h-6 w-6 text-white p-1.5 rounded-full ${color}`} />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
                      <dd className="text-lg font-semibold text-gray-900">{formattedValue}</dd>
                    </dl>
                  </div>
                </div>
                                 <div className="mt-2 flex items-center">
                   {growth >= 0 ? (
                     <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                   ) : (
                     <ArrowTrendingDownIcon className="h-4 w-4 text-red-500 mr-1" />
                   )}
                  <span className={`text-sm font-medium ${
                    growth >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {growth >= 0 ? '+' : ''}{growth}%
                  </span>
                  <span className="text-sm text-gray-500 ml-1">from last month</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Primary Metric Chart */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              {selectedMetric === 'revenue' ? 'Revenue Trend' :
               selectedMetric === 'users' ? 'User Growth' : 'School Growth'}
            </h3>
            <ChartBarIcon className="h-5 w-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {chartData.map((data, index) => {
              const value = selectedMetric === 'revenue' ? data.revenue :
                           selectedMetric === 'users' ? data.users : data.schools;
              const maxValue = selectedMetric === 'revenue' ? 250000 :
                              selectedMetric === 'users' ? 50000 : 20;
              const formattedValue = selectedMetric === 'revenue' ? formatCurrency(value) :
                                    selectedMetric === 'users' ? formatNumber(value) : value.toString();
              
              return (
                <div key={data.month} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">{data.month}</span>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center">
                      <div className="w-20 bg-gray-200 rounded-full h-2 mr-2">
                        <div 
                          className={`h-2 rounded-full ${getMetricColor(selectedMetric)}`}
                          style={{ width: `${(value / maxValue) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-gray-600">{formattedValue}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Attendance Chart */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Attendance Trend</h3>
            <ChartPieIcon className="h-5 w-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {chartData.map((data, index) => (
              <div key={data.month} className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-500">{data.month}</span>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    <div className="w-20 bg-gray-200 rounded-full h-2 mr-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full" 
                        style={{ width: `${data.attendance}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600">{data.attendance}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Performing Schools */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Top Performing Schools</h3>
          <div className="flex items-center space-x-2">
            <AcademicCapIcon className="h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-500">Based on performance metrics</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  School Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Students
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teachers
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Growth
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attendance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Performance
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {topSchools.map((school, index) => (
                <tr key={school.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8">
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600">{index + 1}</span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{school.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(school.students)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(school.teachers)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(school.revenue)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                      +{school.growth}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {school.attendance}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                        <div 
                          className="bg-green-500 h-2 rounded-full" 
                          style={{ width: `${school.performance}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-gray-600">{school.performance}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <DocumentArrowDownIcon className="h-8 w-8 text-blue-500" />
            </div>
            <div className="ml-4">
              <h4 className="text-lg font-medium text-gray-900">Generate Report</h4>
              <p className="text-sm text-gray-500">Create custom reports</p>
            </div>
          </div>
          <button 
            onClick={generateReport}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
        
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <EyeIcon className="h-8 w-8 text-green-500" />
            </div>
            <div className="ml-4">
              <h4 className="text-lg font-medium text-gray-900">Export Data</h4>
              <p className="text-sm text-gray-500">Export in various formats</p>
            </div>
          </div>
          <button 
            onClick={exportData}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {isLoading ? 'Exporting...' : 'Export Data'}
          </button>
        </div>
        
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <ClockIcon className="h-8 w-8 text-purple-500" />
            </div>
            <div className="ml-4">
              <h4 className="text-lg font-medium text-gray-900">Schedule Reports</h4>
              <p className="text-sm text-gray-500">Automated reporting</p>
            </div>
          </div>
          <button className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">
            Schedule Reports
          </button>
        </div>
        
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <FunnelIcon className="h-8 w-8 text-yellow-500" />
            </div>
            <div className="ml-4">
              <h4 className="text-lg font-medium text-gray-900">Advanced Filters</h4>
              <p className="text-sm text-gray-500">Custom data filtering</p>
            </div>
          </div>
          <button className="w-full px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700">
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default Analytics; 