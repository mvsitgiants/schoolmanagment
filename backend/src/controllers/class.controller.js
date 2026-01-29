import Class from '../models/class.model.js';

// Get all classes with pagination and filters
export const getClasses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const academicYearFilter = req.query.academicYear;
    const isActiveFilter = req.query.isActive;

    const query = {};

    if (searchQuery) {
      query.name = { $regex: searchQuery, $options: 'i' };
    }

    if (academicYearFilter) query.academicYear = academicYearFilter;
    if (isActiveFilter !== undefined) query.isActive = isActiveFilter === 'true';

    const total = await Class.countDocuments(query);
    const classes = await Class.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('classTeacher', 'name email')
      .populate('subjects', 'name code')
      .sort({ createdAt: -1 });

    res.json({
      classes,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching classes' });
  }
};

// Get class by ID
export const getClassById = async (req, res) => {
  try {
    const classData = await Class.findById(req.params.id)
      .populate('classTeacher', 'name email')
      .populate('subjects', 'name code');
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching class' });
  }
};

// Create new class
export const createClass = async (req, res) => {
  try {
    const newClass = new Class(req.body);
    await newClass.save();

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({ message: 'Error creating class' });
  }
};

// Update class
export const updateClass = async (req, res) => {
  try {
    const classData = await Class.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error updating class' });
  }
};

// Delete class
export const deleteClass = async (req, res) => {
  try {
    const classData = await Class.findByIdAndDelete(req.params.id);

    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting class' });
  }
}; 