import Student from '../models/student.model.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/response.js';

class StudentService {
  /**
   * Get all students with pagination and filters
   * @param {Object} filters - Query filters
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Object} Paginated students data
   */
  async getStudents(filters = {}, page = 1, limit = 10) {
    const query = {};

    // Apply search filter
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { rollNumber: { $regex: filters.search, $options: 'i' } },
        { admissionNumber: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Apply class filter
    if (filters.class) {
      query.class = filters.class;
    }

    // Apply section filter
    if (filters.section) {
      query.section = filters.section;
    }

    // Apply active status filter
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    const total = await Student.countDocuments(query);
    const students = await Student.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('parentId', 'name email contactNumber')
      .sort({ createdAt: -1 });

    return {
      students,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  /**
   * Get student by ID
   * @param {string} studentId - Student ID
   * @returns {Object} Student data
   */
  async getStudentById(studentId) {
    const student = await Student.findById(studentId)
      .populate('parentId', 'name email contactNumber');
    
    if (!student) {
      throw new NotFoundError('Student not found');
    }

    return student;
  }

  /**
   * Create new student
   * @param {Object} studentData - Student data
   * @returns {Object} Created student
   */
  async createStudent(studentData) {
    // Check for duplicate roll number
    const existingRollNumber = await Student.findOne({ 
      rollNumber: studentData.rollNumber,
      class: studentData.class,
      section: studentData.section
    });
    
    if (existingRollNumber) {
      throw new ConflictError('Roll number already exists in this class and section');
    }

    // Check for duplicate admission number
    const existingAdmissionNumber = await Student.findOne({ 
      admissionNumber: studentData.admissionNumber 
    });
    
    if (existingAdmissionNumber) {
      throw new ConflictError('Admission number already exists');
    }

    // Check for duplicate email
    const existingEmail = await Student.findOne({ 
      email: studentData.email 
    });
    
    if (existingEmail) {
      throw new ConflictError('Email already exists');
    }

    const student = new Student(studentData);
    await student.save();

    return student.populate('parentId', 'name email contactNumber');
  }

  /**
   * Update student
   * @param {string} studentId - Student ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated student
   */
  async updateStudent(studentId, updateData) {
    const student = await Student.findById(studentId);
    if (!student) {
      throw new NotFoundError('Student not found');
    }

    // Check for duplicate roll number if being updated
    if (updateData.rollNumber && 
        (updateData.rollNumber !== student.rollNumber || 
         updateData.class !== student.class || 
         updateData.section !== student.section)) {
      
      const existingRollNumber = await Student.findOne({
        rollNumber: updateData.rollNumber,
        class: updateData.class || student.class,
        section: updateData.section || student.section,
        _id: { $ne: studentId }
      });
      
      if (existingRollNumber) {
        throw new ConflictError('Roll number already exists in this class and section');
      }
    }

    // Check for duplicate admission number if being updated
    if (updateData.admissionNumber && updateData.admissionNumber !== student.admissionNumber) {
      const existingAdmissionNumber = await Student.findOne({
        admissionNumber: updateData.admissionNumber,
        _id: { $ne: studentId }
      });
      
      if (existingAdmissionNumber) {
        throw new ConflictError('Admission number already exists');
      }
    }

    // Check for duplicate email if being updated
    if (updateData.email && updateData.email !== student.email) {
      const existingEmail = await Student.findOne({
        email: updateData.email,
        _id: { $ne: studentId }
      });
      
      if (existingEmail) {
        throw new ConflictError('Email already exists');
      }
    }

    const updatedStudent = await Student.findByIdAndUpdate(
      studentId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('parentId', 'name email contactNumber');

    return updatedStudent;
  }

  /**
   * Delete student
   * @param {string} studentId - Student ID
   * @param {string} currentUserRole - Role of the user performing the action
   * @returns {Object} Success message
   */
  async deleteStudent(studentId, currentUserRole) {
    if (currentUserRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only SUPER_ADMIN can delete students');
    }

    const student = await Student.findById(studentId);
    if (!student) {
      throw new NotFoundError('Student not found');
    }

    await Student.findByIdAndDelete(studentId);
    return { message: 'Student deleted successfully' };
  }

  /**
   * Get students by class
   * @param {string} className - Class name
   * @param {string} section - Section (optional)
   * @returns {Array} Students in the class
   */
  async getStudentsByClass(className, section = null) {
    const query = { class: className, isActive: true };
    if (section) {
      query.section = section;
    }

    const students = await Student.find(query)
      .populate('parentId', 'name email contactNumber')
      .sort({ rollNumber: 1 });

    return students;
  }

  /**
   * Get student statistics
   * @returns {Object} Student statistics
   */
  async getStudentStatistics() {
    const totalStudents = await Student.countDocuments({ isActive: true });
    const totalInactiveStudents = await Student.countDocuments({ isActive: false });
    
    const classStats = await Student.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$class', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const genderStats = await Student.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$gender', count: { $sum: 1 } } }
    ]);

    return {
      totalStudents,
      totalInactiveStudents,
      classDistribution: classStats,
      genderDistribution: genderStats
    };
  }

  /**
   * Bulk update students
   * @param {Array} studentIds - Array of student IDs
   * @param {Object} updateData - Data to update
   * @returns {Object} Update result
   */
  async bulkUpdateStudents(studentIds, updateData) {
    const result = await Student.updateMany(
      { _id: { $in: studentIds } },
      { $set: updateData },
      { runValidators: true }
    );

    return {
      message: `Updated ${result.modifiedCount} students`,
      modifiedCount: result.modifiedCount
    };
  }

  /**
   * Search students
   * @param {string} searchTerm - Search term
   * @param {number} limit - Maximum results
   * @returns {Array} Matching students
   */
  async searchStudents(searchTerm, limit = 10) {
    const students = await Student.find({
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } },
        { rollNumber: { $regex: searchTerm, $options: 'i' } },
        { admissionNumber: { $regex: searchTerm, $options: 'i' } },
      ],
      isActive: true
    })
    .limit(limit)
    .populate('parentId', 'name email contactNumber')
    .sort({ name: 1 });

    return students;
  }
}

export default new StudentService(); 