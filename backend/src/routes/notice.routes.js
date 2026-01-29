import express from 'express';
import { body } from 'express-validator';
import {
  getNotices,
  getNoticeById,
  createNotice,
  updateNotice,
  deleteNotice,
  } from '../controllers/notice.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all notices (Admin, Teacher, Staff)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF']),
  getNotices
);

// Get notice by ID (Admin, Teacher, Staff)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF']),
  getNoticeById
);

// Create new notice (Admin, Staff)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('content').notEmpty().withMessage('Content is required'),
    body('type').isIn(['GENERAL', 'EXAM', 'EVENT', 'HOLIDAY', 'ANNOUNCEMENT']).withMessage('Invalid notice type'),
    body('startDate').isISO8601().withMessage('Invalid start date'),
    body('targetAudience').isArray().withMessage('Target audience must be an array'),
  ],
  validateRequest,
  createNotice
);

// Update notice (Admin, Staff)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('content').optional().notEmpty().withMessage('Content cannot be empty'),
    body('type').optional().isIn(['GENERAL', 'EXAM', 'EVENT', 'HOLIDAY', 'ANNOUNCEMENT']).withMessage('Invalid notice type'),
    body('startDate').optional().isISO8601().withMessage('Invalid start date'),
  ],
  validateRequest,
  updateNotice
);

// Delete notice (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deleteNotice);

export default router; 