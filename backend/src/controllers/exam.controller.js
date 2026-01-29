import { Exam, Grade } from '../models/exam.model.js';

// Get all exams with pagination and filters
export const getExams = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const typeFilter = req.query.type;
    const classFilter = req.query.class;
    const subjectFilter = req.query.subject;
    const academicYearFilter = req.query.academicYear;

    const query = {};

    if (searchQuery) {
      query.name = { $regex: searchQuery, $options: 'i' };
    }

    if (typeFilter) query.type = typeFilter;
    if (classFilter) query.class = classFilter;
    if (subjectFilter) query.subject = subjectFilter;
    if (academicYearFilter) query.academicYear = academicYearFilter;

    const total = await Exam.countDocuments(query);
    const exams = await Exam.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('subject', 'name code')
      .populate('class', 'name')
      .populate('conductedBy', 'name email')
      .sort({ date: -1 });

    res.json({
      exams,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams' });
  }
};

// Get exam by ID
export const getExamById = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('subject', 'name code')
      .populate('class', 'name')
      .populate('conductedBy', 'name email');
    
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exam' });
  }
};

// Create new exam
export const createExam = async (req, res) => {
  try {
    const newExam = new Exam(req.body);
    await newExam.save();

    res.status(201).json(newExam);
  } catch (error) {
    res.status(500).json({ message: 'Error creating exam' });
  }
};

// Update exam
export const updateExam = async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error updating exam' });
  }
};

// Delete exam
export const deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findByIdAndDelete(req.params.id);

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // Also delete related grades
    await Grade.deleteMany({ exam: req.params.id });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting exam' });
  }
};

// Get grades for an exam
export const getExamGrades = async (req, res) => {
  try {
    const grades = await Grade.find({ exam: req.params.id })
      .populate('student', 'name rollNumber')
      .populate('gradedBy', 'name');

    res.json(grades);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching grades' });
  }
};

// Add grade for a student
export const addGrade = async (req, res) => {
  try {
    const newGrade = new Grade(req.body);
    await newGrade.save();

    res.status(201).json(newGrade);
  } catch (error) {
    res.status(500).json({ message: 'Error adding grade' });
  }
}; 