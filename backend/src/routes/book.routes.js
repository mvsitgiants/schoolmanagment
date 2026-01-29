import express from 'express';
import { body } from 'express-validator';
import {
  getBooks,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
  } from '../controllers/book.controller.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get all books (Admin, Teacher, Staff)
router.get(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF']),
  getBooks
);

// Get book by ID (Admin, Teacher, Staff)
router.get(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF']),
  getBookById
);

// Create new book (Admin, Staff)
router.post(
  '/',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('author').notEmpty().withMessage('Author is required'),
    body('isbn').notEmpty().withMessage('ISBN is required'),
    body('category').notEmpty().withMessage('Category is required'),
    body('publisher').notEmpty().withMessage('Publisher is required'),
    body('publishYear').isNumeric().withMessage('Publish year must be a number'),
    body('quantity').isNumeric().withMessage('Quantity must be a number'),
    body('availableQuantity').isNumeric().withMessage('Available quantity must be a number'),
    body('location').notEmpty().withMessage('Location is required'),
  ],
  validateRequest,
  createBook
);

// Update book (Admin, Staff)
router.put(
  '/:id',
  auth(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('author').optional().notEmpty().withMessage('Author cannot be empty'),
    body('isbn').optional().notEmpty().withMessage('ISBN cannot be empty'),
    body('quantity').optional().isNumeric().withMessage('Quantity must be a number'),
    body('availableQuantity').optional().isNumeric().withMessage('Available quantity must be a number'),
  ],
  validateRequest,
  updateBook
);

// Delete book (Admin only)
router.delete('/:id', auth(['SUPER_ADMIN', 'ADMIN']), deleteBook);

export default router; 