import jwt from 'jsonwebtoken';
import { ApiResponse, UnauthorizedError, ForbiddenError } from '../utils/response.js';

export const auth = (roles = []) => {
  return async (req, res, next) => {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json(ApiResponse.error('No auth token found', 401));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

      // Check if user has required role
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json(ApiResponse.error('Not authorized to access this resource', 403));
      }

      req.user = decoded;
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json(ApiResponse.error('Invalid token', 401));
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json(ApiResponse.error('Token expired', 401));
      }
      return res.status(401).json(ApiResponse.error('Please authenticate', 401));
    }
  };
};

// Convenience middleware for specific roles
export const isSuperAdmin = auth(['SUPER_ADMIN']);
export const isAdminOrSuperAdmin = auth(['ADMIN', 'SUPER_ADMIN']);
export const isTeacher = auth(['TEACHER']);
export const isStudent = auth(['STUDENT']);
export const isParent = auth(['PARENT']);
export const isStaff = auth(['STAFF']);

// Middleware for any authenticated user
export const isAuthenticated = auth([]); 