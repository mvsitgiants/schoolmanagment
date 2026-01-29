import mongoose from 'mongoose';

const examSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['MIDTERM', 'FINAL', 'TEST', 'ASSIGNMENT'],
      required: true,
    },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    section: { type: String, required: true },
    date: { type: Date, required: true },
    duration: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    passingMarks: { type: Number, required: true },
    academicYear: { type: String, required: true },
    conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isPublished: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

const gradeSchema = new mongoose.Schema(
  {
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    marksObtained: { type: Number, required: true },
    remarks: { type: String },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
examSchema.index({ subject: 1, class: 1, section: 1, academicYear: 1 });
examSchema.index({ date: 1 });
examSchema.index({ conductedBy: 1 });

gradeSchema.index({ exam: 1, student: 1 }, { unique: true });
gradeSchema.index({ student: 1 });

const Exam = mongoose.model('Exam', examSchema);
const Grade = mongoose.model('Grade', gradeSchema);

export { Exam, Grade }; 