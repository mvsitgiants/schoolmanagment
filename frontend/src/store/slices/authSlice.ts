import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { 
  isValidToken, 
  getTokenFromStorage, 
  getUserFromStorage, 
  setTokenInStorage, 
  setUserInStorage, 
  clearAuthData 
} from '../../utils/auth';

interface AuthState {
  token: string | null;
  user: {
    _id: string;
    name: string;
    email: string;
    role: string;
    profilePicture?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
  isAuthenticated: boolean;
}

// Get valid token from localStorage
const getValidTokenFromStorage = (): string | null => {
  const token = getTokenFromStorage();
  if (token && isValidToken(token)) {
    return token;
  }
  // Clear invalid token
  clearAuthData();
  return null;
};

const initialState: AuthState = {
  token: getValidTokenFromStorage(),
  user: getUserFromStorage(),
  isAuthenticated: !!getValidTokenFromStorage(),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ token: string; user: AuthState['user'] }>
    ) => {
      const { token, user } = action.payload;
      
      console.log('Setting credentials with:', { token: token?.substring(0, 20) + '...', user });
      
      // Validate token before setting
      if (!isValidToken(token)) {
        console.error('Invalid token provided');
        return;
      }
      
      state.token = token;
      state.user = user;
      state.isAuthenticated = true;
      setTokenInStorage(token);
      setUserInStorage(user);
      
      console.log('Credentials set successfully');
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      clearAuthData();
    },
    clearInvalidToken: (state) => {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      clearAuthData();
    },
  },
});

export const { setCredentials, logout, clearInvalidToken } = authSlice.actions;
export default authSlice.reducer; 