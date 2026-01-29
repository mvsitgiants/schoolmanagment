import Exam from '../models/exam.model.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/response.js';

class ExamService {
  /**
   * Get all exams with pagination and filters
   * @param {Object} filters - Query filters
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Object} Paginated exams data
   */
  async getExams(filters = {}, page = 1, limit = 10) {
    const query = {};

    // Apply search filter
    if (filters.search) {
      query.$or = [
        { title: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Apply subject filter
    if (filters.subjectId) {
      query.subjectId = filters.subjectId;
    }

    // Apply class filter
    if (filters.classId) {
      query.classId = filters.classId;
    }

    // Apply exam type filter
    if (filters.examType) {
      query.examType = filters.examType;
    }

    // Apply date range filter
    if (filters.startDate && filters.endDate) {
      query.examDate = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate)
      };
    }

    const total = await Exam.countDocuments(query);
    const exams = await Exam.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('subjectId', 'name code')
      .populate('classId', 'name section')
      .sort({ examDate: -1 });

    return {
      exams,
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
   * Get exam by ID
   * @param {string} examId - Exam ID
   * @returns {Object} Exam data
   */
  async getExamById(examId) {
    const exam = await Exam.findById(examId)
      .populate('subjectId', 'name code')
      .populate('classId', 'name section');
    
    if (!exam) {
      throw new NotFoundError('Exam not found');
    }

    return exam;
  }

  /**
   * Create new exam
   * @param {Object} examData - Exam data
   * @returns {Object} Created exam
   */
  async createExam(examData) {
    // Check for duplicate exam on the same date for the same class and subject
    const existingExam = await Exam.findOne({
      subjectId: examData.subjectId,
      classId: examData.classId,
      examDate: examData.examDate
    });
    
    if (existingExam) {
      throw new ConflictError('An exam already exists for this subject and class on the specified date');
    }

    // Validate passing marks
    if (examData.passingMarks > examData.totalMarks) {
      throw new ConflictError('Passing marks cannot be greater than total marks');
    }

    const exam = new Exam(examData);
    await exam.save();

    return exam.populate([
      { path: 'subjectId', select: 'name code' },
      { path: 'classId', select: 'name section' }
    ]);
  }

  /**
   * Update exam
   * @param {string} examId - Exam ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated exam
   */
  async updateExam(examId, updateData) {
    const exam = await Exam.findById(examId);
    if (!exam) {
      throw new NotFoundError('Exam not found');
    }

    // Check for duplicate exam if date, subject, or class is being updated
    if ((updateData.subjectId && updateData.subjectId !== exam.subjectId) ||
        (updateData.classId && updateData.classId !== exam.classId) ||
        (updateData.examDate && updateData.examDate !== exam.examDate)) {
      
      const existingExam = await Exam.findOne({
        subjectId: updateData.subjectId || exam.subjectId,
        classId: updateData.classId || exam.classId,
        examDate: updateData.examDate || exam.examDate,
        _id: { $ne: examId }
      });
      
      if (existingExam) {
        throw new ConflictError('An exam already exists for this subject and class on the specified date');
      }
    }

    // Validate passing marks if being updated
    if (updateData.passingMarks && updateData.totalMarks) {
      if (updateData.passingMarks > updateData.totalMarks) {
        throw new ConflictError('Passing marks cannot be greater than total marks');
      }
    } else if (updateData.passingMarks && exam.totalMarks) {
      if (updateData.passingMarks > exam.totalMarks) {
        throw new ConflictError('Passing marks cannot be greater than total marks');
      }
    }

    const updatedExam = await Exam.findByIdAndUpdate(
      examId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate([
      { path: 'subjectId', select: 'name code' },
      { path: 'classId', select: 'name section' }
    ]);

    return updatedExam;
  }

  /**
   * Delete exam
   * @param {string} examId - Exam ID
   * @param {string} currentUserRole - Role of the user performing the action
   * @returns {Object} Success message
   */
  async deleteExam(examId, currentUserRole) {
    if (currentUserRole !== 'SUPER_ADMIN' && currentUserRole !== 'ADMIN') {
      throw new ForbiddenError('Only ADMIN and SUPER_ADMIN can delete exams');
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      throw new NotFoundError('Exam not found');
    }

    // Check if exam date is in the past
    if (new Date(exam.examDate) < new Date()) {
      throw new ConflictError('Cannot delete an exam that has already taken place');
    }

    await Exam.findByIdAndDelete(examId);
    return { message: 'Exam deleted successfully' };
  }

  /**
   * Get exams by subject
   * @param {string} subjectId - Subject ID
   * @returns {Array} Exams for the subject
   */
  async getExamsBySubject(subjectId) {
    const exams = await Exam.find({ subjectId })
      .populate('classId', 'name section')
      .sort({ examDate: -1 });

    return exams;
  }

  /**
   * Get exams by class
   * @param {string} classId - Class ID
   * @returns {Array} Exams for the class
   */
  async getExamsByClass(classId) {
    const exams = await Exam.find({ classId })
      .populate('subjectId', 'name code')
      .sort({ examDate: -1 });

    return exams;
  }

  /**
   * Get upcoming exams
   * @param {number} days - Number of days to look ahead
   * @returns {Array} Upcoming exams
   */
  async getUpcomingExams(days = 30) {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const exams = await Exam.find({
      examDate: {
        $gte: startDate,
        $lte: endDate
      }
    })
    .populate('subjectId', 'name code')
    .populate('classId', 'name section')
    .sort({ examDate: 1 });

    return exams;
  }

  /**
   * Get exam statistics
   * @returns {Object} Exam statistics
   */
  async getExamStatistics() {
    const totalExams = await Exam.countDocuments();
    
    const examTypeStats = await Exam.aggregate([
      {
        $group: {
          _id: '$examType',
          count: { $sum: 1 }
        }
      }
    ]);

    const monthlyStats = await Exam.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$examDate' },
            month: { $month: '$examDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } }
    ]);

    const subjectStats = await Exam.aggregate([
      {
        $group: {
          _id: '$subjectId',
          examCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'subjects',
          localField: '_id',
          foreignField: '_id',
          as: 'subject'
        }
      },
      {
        $unwind: '$subject'
      },
      {
        $project: {
          subjectName: '$subject.name',
          examCount: 1
        }
      }
    ]);

    return {
      totalExams,
      examTypeDistribution: examTypeStats,
      monthlyDistribution: monthlyStats,
      subjectDistribution: subjectStats
    };
  }
}

export default new ExamService(); 