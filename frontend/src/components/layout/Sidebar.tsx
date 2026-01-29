import React from 'react';
import { useSelector } from 'react-redux';
import { NavLink } from 'react-router-dom';
import {
  UserGroupIcon,
  AcademicCapIcon,
  BookOpenIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  BuildingOfficeIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { RootState } from '../../store';

interface MenuItem {
  name: string;
  path: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  roles: string[];
}

const menuItems: MenuItem[] = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: ClipboardDocumentListIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'LIBRARIAN'],
  },
  {
    name: 'Staff',
    path: '/staff',
    icon: UserGroupIcon,
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    name: 'Students',
    path: '/students',
    icon: AcademicCapIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER'],
  },
  {
    name: 'Classes',
    path: '/classes',
    icon: BookOpenIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER'],
  },
  {
    name: 'Calendar',
    path: '/calendar',
    icon: CalendarIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT'],
  },
  {
    name: 'Payments',
    path: '/payments',
    icon: CurrencyDollarIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
  },
  {
    name: 'Settings',
    path: '/settings',
    icon: Cog6ToothIcon,
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    name: 'System Management',
    path: '/system',
    icon: BuildingOfficeIcon,
    roles: ['SUPER_ADMIN'],
  },
  {
    name: 'Analytics',
    path: '/analytics',
    icon: ChartBarIcon,
    roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'LIBRARIAN'],
  },
];

const Sidebar: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const userRole = user?.role || '';

  // Debug logging
  console.log('Sidebar - User:', user);
  console.log('Sidebar - User Role:', userRole);
  console.log('Sidebar - Available menu items:', menuItems);
  console.log('Sidebar - Filtered menu items:', menuItems.filter((item) =>
    item.roles.includes(userRole)
  ));

  const filteredMenuItems = menuItems.filter((item) =>
    item.roles.includes(userRole)
  );

  // If no menu items are found, show all items for debugging
  const displayItems = filteredMenuItems.length > 0 ? filteredMenuItems : menuItems;

  return (
    <aside className="bg-gray-800 w-64 min-h-screen flex flex-col">
      <div className="flex items-center justify-center h-16 bg-gray-900">
        <span className="text-white text-lg font-semibold">SMS</span>
      </div>

      <nav className="mt-6 flex-1">
        <div className="px-4 space-y-1">
          {filteredMenuItems.length === 0 && (
            <div className="text-yellow-300 text-sm px-4 py-2 bg-yellow-800 rounded">
              No menu items for role: {userRole || 'undefined'}
            </div>
          )}
          {displayItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center px-4 py-2 transition-colors rounded-lg ${
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
            >
              <item.icon className="h-5 w-5 mr-3" />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar; 