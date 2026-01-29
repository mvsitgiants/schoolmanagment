// Authentication utility functions

export const isValidToken = (token: string): boolean => {
  try {
    // Basic JWT structure validation
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('Invalid token structure - expected 3 parts, got:', parts.length);
      return false;
    }
    
    // Check if token is expired
    const payload = JSON.parse(atob(parts[1]));
    const currentTime = Date.now() / 1000;
    
    console.log('Token payload:', payload);
    console.log('Current time:', currentTime);
    console.log('Token expiry:', payload.exp);
    
    if (payload.exp && payload.exp < currentTime) {
      console.log('Token is expired');
      return false;
    }
    
    console.log('Token is valid');
    return true;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
};

export const getTokenFromStorage = (): string | null => {
  return localStorage.getItem('token');
};

export const setTokenInStorage = (token: string): void => {
  localStorage.setItem('token', token);
};

export const removeTokenFromStorage = (): void => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

export const getUserFromStorage = (): any => {
  try {
    const userData = localStorage.getItem('user');
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error('Error parsing user data from localStorage:', error);
    return null;
  }
};

export const setUserInStorage = (user: any): void => {
  localStorage.setItem('user', JSON.stringify(user));
};

export const clearAuthData = (): void => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

export const isAuthenticated = (): boolean => {
  const token = getTokenFromStorage();
  return token ? isValidToken(token) : false;
}; 