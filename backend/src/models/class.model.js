import mongoose from 'mongoose';

const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sections: [{ type: String, required: true }],
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    classTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    academicYear: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
classSchema.index({ name: 1, academicYear: 1 }, { unique: true });
classSchema.index({ classTeacher: 1 });

const Class = mongoose.model('Class', classSchema);

export default Class; 