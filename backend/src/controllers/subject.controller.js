import Subject from '../models/subject.model.js';

// Get all subjects with pagination and filters
export const getSubjects = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const isActiveFilter = req.query.isActive;

    const query = {};

    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: 'i' } },
        { code: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (isActiveFilter !== undefined) query.isActive = isActiveFilter === 'true';

    const total = await Subject.countDocuments(query);
    const subjects = await Subject.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('teachers', 'name email')
      .populate('classes', 'name')
      .sort({ createdAt: -1 });

    res.json({
      subjects,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching subjects' });
  }
};

// Get subject by ID
export const getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id)
      .populate('teachers', 'name email')
      .populate('classes', 'name');
    
    if (!subject) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.json(subject);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching subject' });
  }
};

// Create new subject
export const createSubject = async (req, res) => {
  try {
    const newSubject = new Subject(req.body);
    await newSubject.save();

    res.status(201).json(newSubject);
  } catch (error) {
    res.status(500).json({ message: 'Error creating subject' });
  }
};

// Update subject
export const updateSubject = async (req, res) => {
  try {
    const subject = await Subject.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!subject) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.json(subject);
  } catch (error) {
    res.status(500).json({ message: 'Error updating subject' });
  }
};

// Delete subject
export const deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findByIdAndDelete(req.params.id);

    if (!subject) {
      return res.status(404).json({ message: 'Subject not found' });
    }

    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting subject' });
  }
}; 