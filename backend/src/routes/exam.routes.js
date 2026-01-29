import express from 'express';
import { body } from 'express-validator';
import {
  getExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  getExamGrades,
  addGrade,
  } from '../controllers/exam.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all exams (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getExams
);

// Get exam by ID (Admin, Teacher)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getExamById
);

// Create new exam (Admin, Teacher)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('type').isIn(['MIDTERM', 'FINAL', 'TEST', 'ASSIGNMENT']).withMessage('Invalid exam type'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('class').notEmpty().withMessage('Class is required'),
    body('section').notEmpty().withMessage('Section is required'),
    body('date').isISO8601().withMessage('Invalid date'),
    body('duration').isNumeric().withMessage('Duration must be a number'),
    body('totalMarks').isNumeric().withMessage('Total marks must be a number'),
    body('passingMarks').isNumeric().withMessage('Passing marks must be a number'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
  ],
  validateRequest,
  createExam
);

// Update exam (Admin, Teacher)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('type').optional().isIn(['MIDTERM', 'FINAL', 'TEST', 'ASSIGNMENT']).withMessage('Invalid exam type'),
    body('date').optional().isISO8601().withMessage('Invalid date'),
    body('duration').optional().isNumeric().withMessage('Duration must be a number'),
    body('totalMarks').optional().isNumeric().withMessage('Total marks must be a number'),
    body('passingMarks').optional().isNumeric().withMessage('Passing marks must be a number'),
  ],
  validateRequest,
  updateExam
);

// Delete exam (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deleteExam);

// Get grades for an exam (Admin, Teacher)
router.get(
  '/:id/grades',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getExamGrades
);

// Add grade for a student (Admin, Teacher)
router.post(
  '/:id/grades',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  [
    body('student').notEmpty().withMessage('Student is required'),
    body('marksObtained').isNumeric().withMessage('Marks obtained must be a number'),
  ],
  validateRequest,
  addGrade
);

export default router; 