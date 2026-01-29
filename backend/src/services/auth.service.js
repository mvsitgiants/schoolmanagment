import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/user.model.js';
import { 
  UnauthorizedError, 
  ConflictError, 
  NotFoundError,
  ForbiddenError 
} from '../utils/response.js';

class AuthService {
  /**
   * Authenticate user login
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Object} User data and token
   */
  async login(email, password) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const token = this.generateToken(user);
    const userData = this.sanitizeUser(user);

    return {
      token,
      user: userData
    };
  }

  /**
   * Register new user
   * @param {Object} userData - User registration data
   * @param {string} currentUserRole - Role of the user creating the account
   * @returns {Object} User data and token
   */
  async register(userData, currentUserRole = null) {
    // Check if user already exists
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Role-based authorization
    // if (userData.role === 'ADMIN' || userData.role === 'SUPER_ADMIN') {
    //   if (!currentUserRole || currentUserRole !== 'SUPER_ADMIN') {
    //     throw new ForbiddenError('Only SUPER_ADMIN can create admin accounts');
    //   }
    // }

    // Create new user
    const user = new User(userData);
    await user.save();

    const token = this.generateToken(user);
    const userDataResponse = this.sanitizeUser(user);

    return {
      token,
      user: userDataResponse
    };
  }

  /**
   * Get user profile
   * @param {string} userId - User ID
   * @returns {Object} User profile data
   */
  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this.sanitizeUser(user);
  }

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated user data
   */
  async updateProfile(userId, updateData) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Prevent role changes through profile update
    if (updateData.role) {
      delete updateData.role;
    }

    // If email is being updated, check for duplicates
    if (updateData.email && updateData.email !== user.email) {
      const existingUser = await User.findOne({ email: updateData.email });
      if (existingUser) {
        throw new ConflictError('Email already in use');
      }
    }

    // If password is being updated, hash it
    if (updateData.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password, salt);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return this.sanitizeUser(updatedUser);
  }

  /**
   * Change user password
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Object} Success message
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return { message: 'Password changed successfully' };
  }

  /**
   * Deactivate user account
   * @param {string} userId - User ID to deactivate
   * @param {string} currentUserRole - Role of the user performing the action
   * @returns {Object} Success message
   */
  async deactivateUser(userId, currentUserRole) {
    if (currentUserRole !== 'SUPER_ADMIN' && currentUserRole !== 'ADMIN') {
      throw new ForbiddenError('Not authorized to deactivate users');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Prevent deactivating SUPER_ADMIN accounts
    if (user.role === 'SUPER_ADMIN' && currentUserRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Cannot deactivate SUPER_ADMIN accounts');
    }

    user.isActive = false;
    await user.save();

    return { message: 'User deactivated successfully' };
  }

  /**
   * Activate user account
   * @param {string} userId - User ID to activate
   * @param {string} currentUserRole - Role of the user performing the action
   * @returns {Object} Success message
   */
  async activateUser(userId, currentUserRole) {
    if (currentUserRole !== 'SUPER_ADMIN' && currentUserRole !== 'ADMIN') {
      throw new ForbiddenError('Not authorized to activate users');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    user.isActive = true;
    await user.save();

    return { message: 'User activated successfully' };
  }

  /**
   * Generate JWT token
   * @param {Object} user - User object
   * @returns {string} JWT token
   */
  generateToken(user) {
    return jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        email: user.email 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '1d' }
    );
  }

  /**
   * Sanitize user data (remove sensitive information)
   * @param {Object} user - User object
   * @returns {Object} Sanitized user data
   */
  sanitizeUser(user) {
    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded token payload
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}

export default new AuthService(); 