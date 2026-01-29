import express from 'express';
import { body } from 'express-validator';
import {
  getClasses,
  getClassById,
  createClass,
  updateClass,
  deleteClass,
  } from '../controllers/class.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all classes (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getClasses
);

// Get class by ID (Admin, Teacher)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getClassById
);

// Create new class (Admin only)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('sections').isArray().withMessage('Sections must be an array'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
  ],
  validateRequest,
  createClass
);

// Update class (Admin only)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('sections').optional().isArray().withMessage('Sections must be an array'),
    body('academicYear').optional().notEmpty().withMessage('Academic year cannot be empty'),
  ],
  validateRequest,
  updateClass
);

// Delete class (Super Admin only)
router.delete('/:id', auth(['SUPER_ADMIN']), deleteClass);

export default router; 