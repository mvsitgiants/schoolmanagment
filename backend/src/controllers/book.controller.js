import { Book } from '../models/book.model.js';

// Get all books with pagination and filters
export const getBooks = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const categoryFilter = req.query.category;
    const isAvailableFilter = req.query.isAvailable;

    const query = {};

    if (searchQuery) {
      query.$or = [
        { title: { $regex: searchQuery, $options: 'i' } },
        { author: { $regex: searchQuery, $options: 'i' } },
        { isbn: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (categoryFilter) query.category = categoryFilter;
    if (isAvailableFilter !== undefined) query.isAvailable = isAvailableFilter === 'true';

    const total = await Book.countDocuments(query);
    const books = await Book.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.json({
      books,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching books' });
  }
};

// Get book by ID
export const getBookById = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json(book);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching book' });
  }
};

// Create new book
export const createBook = async (req, res) => {
  try {
    const newBook = new Book(req.body);
    await newBook.save();

    res.status(201).json(newBook);
  } catch (error) {
    res.status(500).json({ message: 'Error creating book' });
  }
};

// Update book
export const updateBook = async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json(book);
  } catch (error) {
    res.status(500).json({ message: 'Error updating book' });
  }
};

// Delete book
export const deleteBook = async (req, res) => {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);

    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting book' });
  }
}; 