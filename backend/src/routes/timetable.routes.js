import express from 'express';
import { body } from 'express-validator';
import {
  getTimetables,
  getTimetableById,
  createTimetable,
  updateTimetable,
  deleteTimetable,
  } from '../controllers/timetable.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all timetables (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getTimetables
);

// Get timetable by ID (Admin, Teacher)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getTimetableById
);

// Create new timetable (Admin only)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('class').notEmpty().withMessage('Class is required'),
    body('section').notEmpty().withMessage('Section is required'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
    body('schedule').isArray().withMessage('Schedule must be an array'),
    body('createdBy').notEmpty().withMessage('Created by is required'),
    body('updatedBy').notEmpty().withMessage('Updated by is required'),
  ],
  validateRequest,
  createTimetable
);

// Update timetable (Admin only)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN']),
  [
    body('schedule').optional().isArray().withMessage('Schedule must be an array'),
    body('updatedBy').notEmpty().withMessage('Updated by is required'),
  ],
  validateRequest,
  updateTimetable
);

// Delete timetable (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deleteTimetable);

export default router; 