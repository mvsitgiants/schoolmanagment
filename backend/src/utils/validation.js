import Joi from 'joi';

/**
 * Common validation patterns
 */
const patterns = {
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  phone: Joi.string().pattern(/^[0-9]{10}$/).required(),
  date: Joi.date().iso(),
  objectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  }
};

/**
 * User validation schemas
 */
export const userValidation = {
  login: Joi.object({
    email: patterns.email,
    password: patterns.password
  }),

  register: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: patterns.email,
    password: patterns.password,
    role: Joi.string().valid('ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF','SUPER_ADMIN').required(),
    profilePicture: Joi.string().uri().optional()
  }),

  update: Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    email: patterns.email.optional(),
    role: Joi.string().valid('ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF').optional(),
    profilePicture: Joi.string().uri().optional(),
    isActive: Joi.boolean().optional()
  }),

  changePassword: Joi.object({
    currentPassword: patterns.password,
    newPassword: patterns.password
  })
};

/**
 * Student validation schemas
 */
export const studentValidation = {
  create: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: patterns.email,
    rollNumber: Joi.string().required(),
    admissionNumber: Joi.string().required(),
    dateOfBirth: patterns.date.required(),
    gender: Joi.string().valid('male', 'female', 'other').required(),
    contactNumber: patterns.phone,
    address: Joi.string().min(10).required(),
    class: Joi.string().required(),
    section: Joi.string().required(),
    parentId: patterns.objectId.required(),
    emergencyContact: patterns.phone.optional(),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').optional(),
    isActive: Joi.boolean().default(true)
  }),

  update: Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    email: patterns.email.optional(),
    rollNumber: Joi.string().optional(),
    admissionNumber: Joi.string().optional(),
    dateOfBirth: patterns.date.optional(),
    gender: Joi.string().valid('male', 'female', 'other').optional(),
    contactNumber: patterns.phone.optional(),
    address: Joi.string().min(10).optional(),
    class: Joi.string().optional(),
    section: Joi.string().optional(),
    parentId: patterns.objectId.optional(),
    emergencyContact: patterns.phone.optional(),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').optional(),
    isActive: Joi.boolean().optional()
  }),

  query: Joi.object({
    page: patterns.pagination.page,
    limit: patterns.pagination.limit,
    search: Joi.string().min(1).optional(),
    class: Joi.string().optional(),
    section: Joi.string().optional()
  })
};

/**
 * Class validation schemas
 */
export const classValidation = {
  create: Joi.object({
    name: Joi.string().required(),
    section: Joi.string().required(),
    capacity: Joi.number().integer().min(1).required(),
    teacherId: patterns.objectId.required(),
    academicYear: Joi.string().required(),
    description: Joi.string().optional()
  }),

  update: Joi.object({
    name: Joi.string().optional(),
    section: Joi.string().optional(),
    capacity: Joi.number().integer().min(1).optional(),
    teacherId: patterns.objectId.optional(),
    academicYear: Joi.string().optional(),
    description: Joi.string().optional()
  })
};

/**
 * Subject validation schemas
 */
export const subjectValidation = {
  create: Joi.object({
    name: Joi.string().required(),
    code: Joi.string().required(),
    description: Joi.string().optional(),
    teacherId: patterns.objectId.required(),
    classId: patterns.objectId.required(),
    credits: Joi.number().integer().min(1).optional()
  }),

  update: Joi.object({
    name: Joi.string().optional(),
    code: Joi.string().optional(),
    description: Joi.string().optional(),
    teacherId: patterns.objectId.optional(),
    classId: patterns.objectId.optional(),
    credits: Joi.number().integer().min(1).optional()
  })
};

/**
 * Exam validation schemas
 */
export const examValidation = {
  create: Joi.object({
    title: Joi.string().required(),
    description: Joi.string().optional(),
    subjectId: patterns.objectId.required(),
    classId: patterns.objectId.required(),
    examDate: patterns.date.required(),
    duration: Joi.number().integer().min(1).required(), // in minutes
    totalMarks: Joi.number().integer().min(1).required(),
    passingMarks: Joi.number().integer().min(1).required(),
    examType: Joi.string().valid('midterm', 'final', 'quiz', 'assignment').required()
  }),

  update: Joi.object({
    title: Joi.string().optional(),
    description: Joi.string().optional(),
    subjectId: patterns.objectId.optional(),
    classId: patterns.objectId.optional(),
    examDate: patterns.date.optional(),
    duration: Joi.number().integer().min(1).optional(),
    totalMarks: Joi.number().integer().min(1).optional(),
    passingMarks: Joi.number().integer().min(1).optional(),
    examType: Joi.string().valid('midterm', 'final', 'quiz', 'assignment').optional()
  })
};

/**
 * Notice validation schemas
 */
export const noticeValidation = {
  create: Joi.object({
    title: Joi.string().required(),
    content: Joi.string().required(),
    type: Joi.string().valid('general', 'academic', 'event', 'emergency').required(),
    targetAudience: Joi.array().items(Joi.string().valid('all', 'students', 'teachers', 'parents', 'staff')).required(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    publishDate: patterns.date.required(),
    expiryDate: patterns.date.optional()
  }),

  update: Joi.object({
    title: Joi.string().optional(),
    content: Joi.string().optional(),
    type: Joi.string().valid('general', 'academic', 'event', 'emergency').optional(),
    targetAudience: Joi.array().items(Joi.string().valid('all', 'students', 'teachers', 'parents', 'staff')).optional(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').optional(),
    publishDate: patterns.date.optional(),
    expiryDate: patterns.date.optional()
  })
};

/**
 * Book validation schemas
 */
export const bookValidation = {
  create: Joi.object({
    title: Joi.string().required(),
    author: Joi.string().required(),
    isbn: Joi.string().required(),
    category: Joi.string().required(),
    quantity: Joi.number().integer().min(1).required(),
    availableQuantity: Joi.number().integer().min(0).required(),
    description: Joi.string().optional(),
    publishedYear: Joi.number().integer().min(1900).max(new Date().getFullYear()).optional()
  }),

  update: Joi.object({
    title: Joi.string().optional(),
    author: Joi.string().optional(),
    isbn: Joi.string().optional(),
    category: Joi.string().optional(),
    quantity: Joi.number().integer().min(1).optional(),
    availableQuantity: Joi.number().integer().min(0).optional(),
    description: Joi.string().optional(),
    publishedYear: Joi.number().integer().min(1900).max(new Date().getFullYear()).optional()
  })
};

/**
 * Payment validation schemas
 */
export const paymentValidation = {
  create: Joi.object({
    studentId: patterns.objectId.required(),
    amount: Joi.number().positive().required(),
    paymentType: Joi.string().valid('tuition', 'library', 'transport', 'other').required(),
    paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'online').required(),
    dueDate: patterns.date.required(),
    description: Joi.string().optional(),
    receiptNumber: Joi.string().optional()
  }),

  update: Joi.object({
    amount: Joi.number().positive().optional(),
    paymentType: Joi.string().valid('tuition', 'library', 'transport', 'other').optional(),
    paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'online').optional(),
    dueDate: patterns.date.optional(),
    description: Joi.string().optional(),
    receiptNumber: Joi.string().optional(),
    status: Joi.string().valid('pending', 'paid', 'overdue', 'cancelled').optional()
  })
};

/**
 * Study Material validation schemas
 */
export const studyMaterialValidation = {
  create: Joi.object({
    title: Joi.string().required(),
    description: Joi.string().optional(),
    subjectId: patterns.objectId.required(),
    classId: patterns.objectId.required(),
    fileUrl: Joi.string().uri().required(),
    fileType: Joi.string().valid('pdf', 'doc', 'docx', 'ppt', 'pptx', 'video', 'image').required(),
    uploadedBy: patterns.objectId.required(),
    isPublic: Joi.boolean().default(true)
  }),

  update: Joi.object({
    title: Joi.string().optional(),
    description: Joi.string().optional(),
    subjectId: patterns.objectId.optional(),
    classId: patterns.objectId.optional(),
    fileUrl: Joi.string().uri().optional(),
    fileType: Joi.string().valid('pdf', 'doc', 'docx', 'ppt', 'pptx', 'video', 'image').optional(),
    isPublic: Joi.boolean().optional()
  })
};

/**
 * Timetable validation schemas
 */
export const timetableValidation = {
  create: Joi.object({
    classId: patterns.objectId.required(),
    subjectId: patterns.objectId.required(),
    teacherId: patterns.objectId.required(),
    dayOfWeek: Joi.number().integer().min(0).max(6).required(), // 0 = Sunday, 6 = Saturday
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    room: Joi.string().optional()
  }),

  update: Joi.object({
    classId: patterns.objectId.optional(),
    subjectId: patterns.objectId.optional(),
    teacherId: patterns.objectId.optional(),
    dayOfWeek: Joi.number().integer().min(0).max(6).optional(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    room: Joi.string().optional()
  })
};

/**
 * Common validation schemas
 */
export const commonValidation = {
  id: Joi.object({
    id: patterns.objectId.required()
  }),

  pagination: Joi.object({
    page: patterns.pagination.page,
    limit: patterns.pagination.limit
  })
};

export default {
  userValidation,
  studentValidation,
  classValidation,
  subjectValidation,
  examValidation,
  noticeValidation,
  bookValidation,
  paymentValidation,
  studyMaterialValidation,
  timetableValidation,
  commonValidation
}; 