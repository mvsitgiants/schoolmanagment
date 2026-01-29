import Class from '../models/class.model.js';
import Student from '../models/student.model.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/response.js';

class ClassService {
  /**
   * Get all classes with pagination and filters
   * @param {Object} filters - Query filters
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Object} Paginated classes data
   */
  async getClasses(filters = {}, page = 1, limit = 10) {
    const query = {};

    // Apply search filter
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { section: { $regex: filters.search, $options: 'i' } },
        { academicYear: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Apply academic year filter
    if (filters.academicYear) {
      query.academicYear = filters.academicYear;
    }

    const total = await Class.countDocuments(query);
    const classes = await Class.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('teacherId', 'name email')
      .sort({ name: 1, section: 1 });

    return {
      classes,
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
   * Get class by ID
   * @param {string} classId - Class ID
   * @returns {Object} Class data
   */
  async getClassById(classId) {
    const classData = await Class.findById(classId)
      .populate('teacherId', 'name email');
    
    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    return classData;
  }

  /**
   * Create new class
   * @param {Object} classData - Class data
   * @returns {Object} Created class
   */
  async createClass(classData) {
    // Check for duplicate class name and section combination
    const existingClass = await Class.findOne({
      name: classData.name,
      section: classData.section,
      academicYear: classData.academicYear
    });
    
    if (existingClass) {
      throw new ConflictError('Class with this name, section, and academic year already exists');
    }

    const newClass = new Class(classData);
    await newClass.save();

    return newClass.populate('teacherId', 'name email');
  }

  /**
   * Update class
   * @param {string} classId - Class ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated class
   */
  async updateClass(classId, updateData) {
    const classData = await Class.findById(classId);
    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    // Check for duplicate class name and section combination if being updated
    if ((updateData.name && updateData.name !== classData.name) ||
        (updateData.section && updateData.section !== classData.section) ||
        (updateData.academicYear && updateData.academicYear !== classData.academicYear)) {
      
      const existingClass = await Class.findOne({
        name: updateData.name || classData.name,
        section: updateData.section || classData.section,
        academicYear: updateData.academicYear || classData.academicYear,
        _id: { $ne: classId }
      });
      
      if (existingClass) {
        throw new ConflictError('Class with this name, section, and academic year already exists');
      }
    }

    const updatedClass = await Class.findByIdAndUpdate(
      classId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('teacherId', 'name email');

    return updatedClass;
  }

  /**
   * Delete class
   * @param {string} classId - Class ID
   * @param {string} currentUserRole - Role of the user performing the action
   * @returns {Object} Success message
   */
  async deleteClass(classId, currentUserRole) {
    if (currentUserRole !== 'SUPER_ADMIN' && currentUserRole !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN and SUPER_ADMIN can delete classes');
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    // Check if there are students in this class
    const studentCount = await Student.countDocuments({
      class: classData.name,
      section: classData.section
    });

    if (studentCount > 0) {
      throw new ConflictError(`Cannot delete class. There are ${studentCount} students enrolled in this class.`);
    }

    await Class.findByIdAndDelete(classId);
    return { message: 'Class deleted successfully' };
  }

  /**
   * Get class details with students
   * @param {string} classId - Class ID
   * @returns {Object} Class details with students
   */
  async getClassWithStudents(classId) {
    const classData = await Class.findById(classId)
      .populate('teacherId', 'name email');
    
    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    const students = await Student.find({
      class: classData.name,
      section: classData.section,
      isActive: true
    })
    .populate('parentId', 'name email contactNumber')
    .sort({ rollNumber: 1 });

    return {
      class: classData,
      students,
      studentCount: students.length
    };
  }

  /**
   * Get class statistics
   * @returns {Object} Class statistics
   */
  async getClassStatistics() {
    const totalClasses = await Class.countDocuments();
    
    const classStats = await Class.aggregate([
      {
        $group: {
          _id: '$academicYear',
          count: { $sum: 1 },
          classes: { $push: { name: '$name', section: '$section' } }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    const teacherStats = await Class.aggregate([
      {
        $group: {
          _id: '$teacherId',
          classCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'teacher'
        }
      },
      {
        $unwind: '$teacher'
      },
      {
        $project: {
          teacherName: '$teacher.name',
          teacherEmail: '$teacher.email',
          classCount: 1
        }
      }
    ]);

    return {
      totalClasses,
      academicYearDistribution: classStats,
      teacherWorkload: teacherStats
    };
  }

  /**
   * Get available classes for enrollment
   * @returns {Array} Available classes
   */
  async getAvailableClasses() {
    const classes = await Class.find()
      .populate('teacherId', 'name email')
      .sort({ name: 1, section: 1 });

    // Get student count for each class
    const classesWithCount = await Promise.all(
      classes.map(async (classData) => {
        const studentCount = await Student.countDocuments({
          class: classData.name,
          section: classData.section,
          isActive: true
        });

        const classObj = classData.toObject();
        return {
          ...classObj,
          studentCount,
          availableSeats: classData.capacity - studentCount
        };
      })
    );

    return classesWithCount;
  }

  /**
   * Assign teacher to class
   * @param {string} classId - Class ID
   * @param {string} teacherId - Teacher ID
   * @returns {Object} Updated class
   */
  async assignTeacher(classId, teacherId) {
    const classData = await Class.findById(classId);
    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    const updatedClass = await Class.findByIdAndUpdate(
      classId,
      { teacherId },
      { new: true, runValidators: true }
    ).populate('teacherId', 'name email');

    return updatedClass;
  }

  /**
   * Get classes by teacher
   * @param {string} teacherId - Teacher ID
   * @returns {Array} Classes assigned to teacher
   */
  async getClassesByTeacher(teacherId) {
    const classes = await Class.find({ teacherId })
      .populate('teacherId', 'name email')
      .sort({ name: 1, section: 1 });

    return classes;
  }
}

export default new ClassService(); 