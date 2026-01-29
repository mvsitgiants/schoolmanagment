import Timetable from '../models/timetable.model.js';

// Get all timetables with pagination and filters
export const getTimetables = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const classFilter = req.query.class;
    const sectionFilter = req.query.section;
    const academicYearFilter = req.query.academicYear;

    const query = {};

    if (searchQuery) {
      query.name = { $regex: searchQuery, $options: 'i' };
    }

    if (classFilter) query.class = classFilter;
    if (sectionFilter) query.section = sectionFilter;
    if (academicYearFilter) query.academicYear = academicYearFilter;

    const total = await Timetable.countDocuments(query);
    const timetables = await Timetable.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('class', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      timetables,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching timetables' });
  }
};

// Get timetable by ID
export const getTimetableById = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id)
      .populate('class', 'name')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');
    
    if (!timetable) {
      return res.status(404).json({ message: 'Timetable not found' });
    }

    res.json(timetable);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching timetable' });
  }
};

// Create new timetable
export const createTimetable = async (req, res) => {
  try {
    const newTimetable = new Timetable(req.body);
    await newTimetable.save();

    res.status(201).json(newTimetable);
  } catch (error) {
    res.status(500).json({ message: 'Error creating timetable' });
  }
};

// Update timetable
export const updateTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!timetable) {
      return res.status(404).json({ message: 'Timetable not found' });
    }

    res.json(timetable);
  } catch (error) {
    res.status(500).json({ message: 'Error updating timetable' });
  }
};

// Delete timetable
export const deleteTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findByIdAndDelete(req.params.id);

    if (!timetable) {
      return res.status(404).json({ message: 'Timetable not found' });
    }

    res.json({ message: 'Timetable deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting timetable' });
  }
}; 