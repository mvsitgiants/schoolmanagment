import express from 'express';
import { body } from 'express-validator';
import {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
  } from '../controllers/subject.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all subjects (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getSubjects
);

// Get subject by ID (Admin, Teacher)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getSubjectById
);

// Create new subject (Admin only)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('code').notEmpty().withMessage('Code is required'),
  ],
  validateRequest,
  createSubject
);

// Update subject (Admin only)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('code').optional().notEmpty().withMessage('Code cannot be empty'),
  ],
  validateRequest,
  updateSubject
);

// Delete subject (Super Admin only)
router.delete('/:id', auth(['SUPER_ADMIN']), deleteSubject);

export default router; 