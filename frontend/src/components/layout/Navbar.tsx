import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Menu } from '@headlessui/react';
import { UserCircleIcon, BellIcon } from '@heroicons/react/24/outline';
import { RootState } from '../../store';
import { logout } from '../../store/slices/authSlice';

const Navbar: React.FC = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);

  const handleLogout = () => {
    dispatch(logout());
  };

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-2.5">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <span className="text-xl font-semibold text-gray-800">
            School Management System
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-gray-500 hover:text-gray-600">
            <BellIcon className="h-6 w-6" />
          </button>

          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center text-gray-500 hover:text-gray-600">
              <UserCircleIcon className="h-8 w-8" />
            </Menu.Button>

            <Menu.Items className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1">
              <Menu.Item>
                {({ active }) => (
                  <div className="px-4 py-2 text-sm text-gray-700">
                    <p className="font-medium">{user?.name}</p>
                    <p className="text-gray-500">{user?.email}</p>
                  </div>
                )}
              </Menu.Item>

              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={handleLogout}
                    className={`${
                      active ? 'bg-gray-100' : ''
                    } block w-full text-left px-4 py-2 text-sm text-gray-700`}
                  >
                    Logout
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 