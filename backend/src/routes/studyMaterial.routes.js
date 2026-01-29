import express from 'express';
import { body } from 'express-validator';
import {
  getStudyMaterials,
  getStudyMaterialById,
  createStudyMaterial,
  updateStudyMaterial,
  deleteStudyMaterial,
  } from '../controllers/studyMaterial.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all study materials (Admin, Teacher)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getStudyMaterials
);

// Get study material by ID (Admin, Teacher)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  getStudyMaterialById
);

// Create new study material (Admin, Teacher)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('type').isIn(['NOTES', 'ASSIGNMENT', 'SYLLABUS', 'WORKSHEET', 'OTHER']).withMessage('Invalid type'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('class').notEmpty().withMessage('Class is required'),
    body('uploadedBy').notEmpty().withMessage('Uploaded by is required'),
    body('fileUrl').notEmpty().withMessage('File URL is required'),
    body('fileType').notEmpty().withMessage('File type is required'),
    body('fileSize').isNumeric().withMessage('File size must be a number'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
  ],
  validateRequest,
  createStudyMaterial
);

// Update study material (Admin, Teacher)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']),
  [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('description').optional().notEmpty().withMessage('Description cannot be empty'),
    body('fileUrl').optional().notEmpty().withMessage('File URL cannot be empty'),
  ],
  validateRequest,
  updateStudyMaterial
);

// Delete study material (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deleteStudyMaterial);

export default router; 