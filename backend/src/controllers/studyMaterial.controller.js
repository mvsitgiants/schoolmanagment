import StudyMaterial from '../models/studyMaterial.model.js';

// Get all study materials with pagination and filters
export const getStudyMaterials = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const subjectFilter = req.query.subject;
    const classFilter = req.query.class;

    const query = {};

    if (searchQuery) {
      query.$or = [
        { title: { $regex: searchQuery, $options: 'i' } },
        { description: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (subjectFilter) query.subject = subjectFilter;
    if (classFilter) query.class = classFilter;

    const total = await StudyMaterial.countDocuments(query);
    const studyMaterials = await StudyMaterial.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('subject', 'name code')
      .populate('class', 'name')
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      studyMaterials,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching study materials' });
  }
};

// Get study material by ID
export const getStudyMaterialById = async (req, res) => {
  try {
    const studyMaterial = await StudyMaterial.findById(req.params.id)
      .populate('subject', 'name code')
      .populate('class', 'name')
      .populate('uploadedBy', 'name email');
    
    if (!studyMaterial) {
      return res.status(404).json({ message: 'Study material not found' });
    }

    res.json(studyMaterial);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching study material' });
  }
};

// Create new study material
export const createStudyMaterial = async (req, res) => {
  try {
    const newStudyMaterial = new StudyMaterial(req.body);
    await newStudyMaterial.save();

    res.status(201).json(newStudyMaterial);
  } catch (error) {
    res.status(500).json({ message: 'Error creating study material' });
  }
};

// Update study material
export const updateStudyMaterial = async (req, res) => {
  try {
    const studyMaterial = await StudyMaterial.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!studyMaterial) {
      return res.status(404).json({ message: 'Study material not found' });
    }

    res.json(studyMaterial);
  } catch (error) {
    res.status(500).json({ message: 'Error updating study material' });
  }
};

// Delete study material
export const deleteStudyMaterial = async (req, res) => {
  try {
    const studyMaterial = await StudyMaterial.findByIdAndDelete(req.params.id);

    if (!studyMaterial) {
      return res.status(404).json({ message: 'Study material not found' });
    }

    res.json({ message: 'Study material deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting study material' });
  }
}; 