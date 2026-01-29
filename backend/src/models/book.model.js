import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    author: { type: String, required: true },
    isbn: { type: String, required: true },
    category: { type: String, required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    publisher: { type: String, required: true },
    publishYear: { type: Number, required: true },
    edition: { type: String },
    quantity: { type: Number, required: true },
    availableQuantity: { type: Number, required: true },
    location: { type: String, required: true },
    description: { type: String },
    coverImage: { type: String },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

const bookIssueSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    issuedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    returnDate: { type: Date },
    returnedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fine: { type: Number },
    status: {
      type: String,
      enum: ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'],
      required: true,
      default: 'ISSUED',
    },
    remarks: { type: String },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
bookSchema.index({ isbn: 1 }, { unique: true });
bookSchema.index({ title: 1 });
bookSchema.index({ author: 1 });
bookSchema.index({ category: 1 });
bookSchema.index({ subject: 1 });

bookIssueSchema.index({ book: 1 });
bookIssueSchema.index({ issuedTo: 1 });
bookIssueSchema.index({ status: 1 });
bookIssueSchema.index({ dueDate: 1 });

const Book = mongoose.model('Book', bookSchema);
const BookIssue = mongoose.model('BookIssue', bookIssueSchema);

export { Book, BookIssue }; 