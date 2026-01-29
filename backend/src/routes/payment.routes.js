import express from 'express';
import { body } from 'express-validator';
import {
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  deletePayment,
  } from '../controllers/payment.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all payments (Admin, Staff)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  getPayments
);

// Get payment by ID (Admin, Staff)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  getPaymentById
);

// Create new payment (Admin, Staff)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('student').notEmpty().withMessage('Student is required'),
    body('feeStructure').notEmpty().withMessage('Fee structure is required'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('paymentDate').isISO8601().withMessage('Invalid payment date'),
    body('paymentMethod').isIn(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']).withMessage('Invalid payment method'),
    body('receiptNumber').notEmpty().withMessage('Receipt number is required'),
    body('collectedBy').notEmpty().withMessage('Collected by is required'),
  ],
  validateRequest,
  createPayment
);

// Update payment (Admin, Staff)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('amount').optional().isNumeric().withMessage('Amount must be a number'),
    body('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']).withMessage('Invalid status'),
    body('paymentDate').optional().isISO8601().withMessage('Invalid payment date'),
  ],
  validateRequest,
  updatePayment
);

// Delete payment (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deletePayment);

export default router; 