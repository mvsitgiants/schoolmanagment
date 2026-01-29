import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String },
    teachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
subjectSchema.index({ code: 1 }, { unique: true });
subjectSchema.index({ name: 1 });
subjectSchema.index({ teachers: 1 });

const Subject = mongoose.model('Subject', subjectSchema);

export default Subject; 