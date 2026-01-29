import Notice from '../models/notice.model.js';

// Get all notices with pagination and filters
export const getNotices = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const typeFilter = req.query.type;
    const isPublishedFilter = req.query.isPublished;

    const query = {};

    if (searchQuery) {
      query.$or = [
        { title: { $regex: searchQuery, $options: 'i' } },
        { content: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (typeFilter) query.type = typeFilter;
    if (isPublishedFilter !== undefined) query.isPublished = isPublishedFilter === 'true';

    const total = await Notice.countDocuments(query);
    const notices = await Notice.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('targetClasses', 'name')
      .sort({ startDate: -1 });

    res.json({
      notices,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notices' });
  }
};

// Get notice by ID
export const getNoticeById = async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('targetClasses', 'name');
    
    if (!notice) {
      return res.status(404).json({ message: 'Notice not found' });
    }

    res.json(notice);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notice' });
  }
};

// Create new notice
export const createNotice = async (req, res) => {
  try {
    const newNotice = new Notice(req.body);
    await newNotice.save();

    res.status(201).json(newNotice);
  } catch (error) {
    res.status(500).json({ message: 'Error creating notice' });
  }
};

// Update notice
export const updateNotice = async (req, res) => {
  try {
    const notice = await Notice.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!notice) {
      return res.status(404).json({ message: 'Notice not found' });
    }

    res.json(notice);
  } catch (error) {
    res.status(500).json({ message: 'Error updating notice' });
  }
};

// Delete notice
export const deleteNotice = async (req, res) => {
  try {
    const notice = await Notice.findByIdAndDelete(req.params.id);

    if (!notice) {
      return res.status(404).json({ message: 'Notice not found' });
    }

    res.json({ message: 'Notice deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting notice' });
  }
}; 