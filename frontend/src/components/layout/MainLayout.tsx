import React from 'react';
import { useSelector } from 'react-redux';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { RootState } from '../../store';

const MainLayout: React.FC = () => {
  const { isAuthenticated, user } = useSelector((state: RootState) => state.auth);

  // Debug logging
  console.log('MainLayout - Auth State:', { isAuthenticated, user });
  console.log('MainLayout - User role:', user?.role);

  if (!isAuthenticated) {
    console.log('User not authenticated, redirecting to login');
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout; 