/**
 * Standardized API Response Format
 */

export class ApiResponse {
  static success(data = null, message = 'Success', statusCode = 200) {
    return {
      success: true,
      message,
      data,
      statusCode,
      timestamp: new Date().toISOString()
    };
  }

  static error(message = 'Error occurred', statusCode = 500, errors = null) {
    return {
      success: false,
      message,
      errors,
      statusCode,
      timestamp: new Date().toISOString()
    };
  }

  static paginated(data, page, limit, total, message = 'Data retrieved successfully') {
    return {
      success: true,
      message,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      statusCode: 200,
      timestamp: new Date().toISOString()
    };
  }
}

export class CustomError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends CustomError {
  constructor(message = 'Validation failed', errors = null) {
    super(message, 400, errors);
  }
}

export class NotFoundError extends CustomError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class UnauthorizedError extends CustomError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
  }
}

export class ForbiddenError extends CustomError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
  }
}

export class ConflictError extends CustomError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
} 