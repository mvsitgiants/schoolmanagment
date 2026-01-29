import express from 'express';
import { 
  login, 
  register, 
  getProfile, 
  updateProfile, 
  changePassword,
  deactivateUser,
  activateUser
} from '../controllers/auth.controller.js';
import { validateBody, validateParams } from '../middleware/validate.middleware.js';
import { userValidation, commonValidation } from '../utils/validation.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public routes
router.post('/login', validateBody(userValidation.login), login);
router.post('/register', validateBody(userValidation.register), register);

// Protected routes
router.get('/profile', auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF']), getProfile);
router.put('/profile', auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF']), validateBody(userValidation.update), updateProfile);
router.post('/change-password', auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF']), validateBody(userValidation.changePassword), changePassword);

// Admin routes
router.post('/deactivate/:userId', auth(['SUPER_ADMIN', 'ADMIN']), validateParams(commonValidation.id), deactivateUser);
router.post('/activate/:userId', auth(['SUPER_ADMIN', 'ADMIN']), validateParams(commonValidation.id), activateUser);

export default router; 