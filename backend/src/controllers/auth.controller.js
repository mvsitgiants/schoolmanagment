import authService from '../services/auth.service.js';
import { ApiResponse } from '../utils/response.js';
import { asyncHandler } from '../middleware/error.middleware.js';

/**
 * User login
 * @route POST /api/auth/login
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  const result = await authService.login(email, password);
  
  res.json(ApiResponse.success(result, 'Login successful'));
});

/**
 * User registration
 * @route POST /api/auth/register
 */
export const register = asyncHandler(async (req, res) => {
  const userData = req.body;
  const currentUserRole = req.user?.role; // From auth middleware
  
  const result = await authService.register(userData, currentUserRole);
  
  res.status(201).json(ApiResponse.success(result, 'User registered successfully', 201));
});

/**
 * Get user profile
 * @route GET /api/auth/profile
 */
export const getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  const profile = await authService.getProfile(userId);
  
  res.json(ApiResponse.success(profile, 'Profile retrieved successfully'));
});

/**
 * Update user profile
 * @route PUT /api/auth/profile
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const updateData = req.body;
  
  const updatedProfile = await authService.updateProfile(userId, updateData);
  
  res.json(ApiResponse.success(updatedProfile, 'Profile updated successfully'));
});

/**
 * Change password
 * @route POST /api/auth/change-password
 */
export const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;
  
  const result = await authService.changePassword(userId, currentPassword, newPassword);
  
  res.json(ApiResponse.success(result, 'Password changed successfully'));
});

/**
 * Deactivate user account
 * @route POST /api/auth/deactivate/:userId
 */
export const deactivateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserRole = req.user.role;
  
  const result = await authService.deactivateUser(userId, currentUserRole);
  
  res.json(ApiResponse.success(result, 'User deactivated successfully'));
});

/**
 * Activate user account
 * @route POST /api/auth/activate/:userId
 */
export const activateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserRole = req.user.role;
  
  const result = await authService.activateUser(userId, currentUserRole);
  
  res.json(ApiResponse.success(result, 'User activated successfully'));
}); 