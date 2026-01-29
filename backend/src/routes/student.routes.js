import express from 'express';
import Joi from 'joi';
import {
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentsByClass,
  getStudentStatistics,
  bulkUpdateStudents,
  searchStudents
} from '../controllers/student.controller.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.middleware.js';
import { studentValidation, commonValidation } from '../utils/validation.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all students (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  validateQuery(studentValidation.query),
  getStudents
);

// Get student by ID (Admin, Teacher, Parent of the student)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'PARENT']),
  validateParams(commonValidation.id),
  getStudentById
);

// Create new student (Admin only)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN']),
  validateBody(studentValidation.create),
  createStudent
);

// Update student (Admin only)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN']),
  validateParams(commonValidation.id),
  validateBody(studentValidation.update),
  updateStudent
);

// Delete student (Super Admin only)
router.delete(
  '/:id', 
  auth(['SUPER_ADMIN']), 
  validateParams(commonValidation.id),
  deleteStudent
);

// Get students by class
router.get(
  '/class/:className',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getStudentsByClass
);

// Get student statistics
router.get(
  '/stats/statistics',
  auth(['SUPER_ADMIN', 'ADMIN']),
  getStudentStatistics
);

// Bulk update students
router.put(
  '/bulk-update',
  auth(['SUPER_ADMIN', 'ADMIN']),
  validateBody(Joi.object({
    studentIds: Joi.array().items(commonValidation.id.id).required(),
    updateData: Joi.object().required()
  })),
  bulkUpdateStudents
);

// Search students
router.get(
  '/search',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  validateQuery(Joi.object({
    q: Joi.string().min(1).required(),
    limit: Joi.number().integer().min(1).max(100).default(10)
  })),
  searchStudents
);

export default router; 