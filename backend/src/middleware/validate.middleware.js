import Joi from 'joi';
import { ValidationError } from '../utils/response.js';

/**
 * Generic Joi validation middleware
 * @param {Joi.ObjectSchema} schema - Joi validation schema
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Replace the request property with validated data
    req[property] = value;
    next();
  };
};

/**
 * Validate request body
 * @param {Joi.ObjectSchema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export const validateBody = (schema) => validate(schema, 'body');

/**
 * Validate request query parameters
 * @param {Joi.ObjectSchema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export const validateQuery = (schema) => validate(schema, 'query');

/**
 * Validate request parameters
 * @param {Joi.ObjectSchema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export const validateParams = (schema) => validate(schema, 'params');

/**
 * Legacy validation middleware for backward compatibility
 * @deprecated Use validate() instead
 */
export const validateRequest = (req, res, next) => {
  // This is kept for backward compatibility
  // In the future, this should be replaced with specific Joi validations
  next();
}; 