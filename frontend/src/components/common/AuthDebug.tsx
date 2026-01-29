import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { logout, clearInvalidToken } from '../../store/slices/authSlice';
import { clearAuthData, getTokenFromStorage, isValidToken } from '../../utils/auth';

const AuthDebug: React.FC = () => {
  const dispatch = useDispatch();
  const { token, user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  
  const handleClearAuth = () => {
    dispatch(logout());
  };

  const handleClearInvalidToken = () => {
    dispatch(clearInvalidToken());
  };

  const handleClearStorage = () => {
    clearAuthData();
    window.location.reload();
  };

  const checkTokenValidity = () => {
    const storedToken = getTokenFromStorage();
    if (storedToken) {
      const valid = isValidToken(storedToken);
      console.log('Stored token validity:', valid);
      alert(`Stored token is ${valid ? 'valid' : 'invalid'}`);
    } else {
      alert('No token found in storage');
    }
  };

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
      <h3 className="text-lg font-medium text-yellow-800 mb-2">Authentication Debug</h3>
      <div className="space-y-2 text-sm">
        <p><strong>Is Authenticated:</strong> {isAuthenticated ? 'Yes' : 'No'}</p>
        <p><strong>Has Token:</strong> {token ? 'Yes' : 'No'}</p>
        <p><strong>Has User:</strong> {user ? 'Yes' : 'No'}</p>
        {user && (
          <p><strong>User Role:</strong> {user.role}</p>
        )}
        {token && (
          <p><strong>Token Preview:</strong> {token.substring(0, 20)}...</p>
        )}
      </div>
      <div className="mt-3 space-x-2">
        <button
          onClick={checkTokenValidity}
          className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
        >
          Check Token
        </button>
        <button
          onClick={handleClearAuth}
          className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
        >
          Logout
        </button>
        <button
          onClick={handleClearInvalidToken}
          className="px-3 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600"
        >
          Clear Invalid Token
        </button>
        <button
          onClick={handleClearStorage}
          className="px-3 py-1 bg-purple-500 text-white rounded text-xs hover:bg-purple-600"
        >
          Clear Storage & Reload
        </button>
      </div>
    </div>
  );
};

export default AuthDebug; 