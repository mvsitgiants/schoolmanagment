import { ApiResponse, CustomError } from '../utils/response.js';

/**
 * Global error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Handle Joi validation errors
  if (err.isJoi) {
    const errors = err.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    return res.status(400).json(ApiResponse.error('Validation failed', 400, errors));
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(error => ({
      field: error.path,
      message: error.message,
      value: error.value
    }));

    return res.status(400).json(ApiResponse.error('Validation failed', 400, errors));
  }

  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    
    return res.status(409).json(ApiResponse.error(
      `${field} with value '${value}' already exists`,
      409,
      [{ field, message: 'Duplicate value', value }]
    ));
  }

  // Handle Mongoose cast errors (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json(ApiResponse.error(
      `Invalid ${err.path}: ${err.value}`,
      400,
      [{ field: err.path, message: 'Invalid format', value: err.value }]
    ));
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json(ApiResponse.error('Invalid token', 401));
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json(ApiResponse.error('Token expired', 401));
  }

  // Handle custom errors
  if (err instanceof CustomError) {
    return res.status(err.statusCode).json(ApiResponse.error(err.message, err.statusCode, err.errors));
  }

  // Handle other known errors
  if (err.statusCode) {
    return res.status(err.statusCode).json(ApiResponse.error(err.message, err.statusCode));
  }

  // Default error response
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return res.status(500).json(ApiResponse.error(
    isDevelopment ? err.message : 'Internal server error',
    500,
    isDevelopment ? { stack: err.stack } : null
  ));
};

/**
 * Async error wrapper to catch async errors in route handlers
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 handler for undefined routes
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json(ApiResponse.error(
    `Route ${req.method} ${req.originalUrl} not found`,
    404
  ));
}; 