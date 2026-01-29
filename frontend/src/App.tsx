import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';
import Staff from './pages/Staff';
import Students from './pages/Students';
import Classes from './pages/Classes';
import Calendar from './pages/Calendar';
import Payments from './pages/Payments';
import Settings from './pages/Settings';
import SystemManagement from './pages/SystemManagement';
import Analytics from './pages/Analytics';

const App: React.FC = () => {
  return (
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="staff" element={<Staff />} />
            <Route path="students" element={<Students />} />
            <Route path="classes" element={<Classes />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="payments" element={<Payments />} />
            <Route path="settings" element={<Settings />} />
            <Route path="system" element={<SystemManagement />} />
            <Route path="analytics" element={<Analytics />} />
          </Route>
        </Routes>
      </Router>
    </Provider>
  );
};

export default App; 