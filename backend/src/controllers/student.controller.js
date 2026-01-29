import studentService from '../services/student.service.js';
import { ApiResponse } from '../utils/response.js';
import { asyncHandler } from '../middleware/error.middleware.js';

/**
 * Get all students with pagination and filters
 * @route GET /api/students
 */
export const getStudents = asyncHandler(async (req, res) => {
  const { page, limit, search, class: classFilter, section } = req.query;
  const filters = { search, class: classFilter, section };
  
  const result = await studentService.getStudents(filters, parseInt(page), parseInt(limit));
  
  res.json(ApiResponse.paginated(
    result.students,
    result.pagination.page,
    result.pagination.limit,
    result.pagination.total,
    'Students retrieved successfully'
  ));
});

/**
 * Get student by ID
 * @route GET /api/students/:id
 */
export const getStudentById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const student = await studentService.getStudentById(id);
  
  res.json(ApiResponse.success(student, 'Student retrieved successfully'));
});

/**
 * Create new student
 * @route POST /api/students
 */
export const createStudent = asyncHandler(async (req, res) => {
  const studentData = req.body;
  
  const student = await studentService.createStudent(studentData);
  
  res.status(201).json(ApiResponse.success(student, 'Student created successfully', 201));
});

/**
 * Update student
 * @route PUT /api/students/:id
 */
export const updateStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  
  const student = await studentService.updateStudent(id, updateData);
  
  res.json(ApiResponse.success(student, 'Student updated successfully'));
});

/**
 * Delete student
 * @route DELETE /api/students/:id
 */
export const deleteStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const currentUserRole = req.user.role;
  
  const result = await studentService.deleteStudent(id, currentUserRole);
  
  res.json(ApiResponse.success(result, 'Student deleted successfully'));
});

/**
 * Get students by class
 * @route GET /api/students/class/:className
 */
export const getStudentsByClass = asyncHandler(async (req, res) => {
  const { className } = req.params;
  const { section } = req.query;
  
  const students = await studentService.getStudentsByClass(className, section);
  
  res.json(ApiResponse.success(students, 'Students retrieved successfully'));
});

/**
 * Get student statistics
 * @route GET /api/students/stats/statistics
 */
export const getStudentStatistics = asyncHandler(async (req, res) => {
  const statistics = await studentService.getStudentStatistics();
  
  res.json(ApiResponse.success(statistics, 'Student statistics retrieved successfully'));
});

/**
 * Bulk update students
 * @route PUT /api/students/bulk-update
 */
export const bulkUpdateStudents = asyncHandler(async (req, res) => {
  const { studentIds, updateData } = req.body;
  
  const result = await studentService.bulkUpdateStudents(studentIds, updateData);
  
  res.json(ApiResponse.success(result, 'Students updated successfully'));
});

/**
 * Search students
 * @route GET /api/students/search
 */
export const searchStudents = asyncHandler(async (req, res) => {
  const { q: searchTerm, limit } = req.query;
  
  const students = await studentService.searchStudents(searchTerm, parseInt(limit));
  
  res.json(ApiResponse.success(students, 'Search completed successfully'));
}); 