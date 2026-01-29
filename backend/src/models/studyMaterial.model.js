import mongoose from 'mongoose';

const studyMaterialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    type: {
      type: String,
      enum: ['NOTES', 'ASSIGNMENT', 'SYLLABUS', 'WORKSHEET', 'OTHER'],
      required: true,
    },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    section: { type: String },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    isPublished: { type: Boolean, default: false },
    academicYear: { type: String, required: true },
    tags: [{ type: String }],
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
studyMaterialSchema.index({ subject: 1, class: 1 });
studyMaterialSchema.index({ uploadedBy: 1 });
studyMaterialSchema.index({ type: 1 });
studyMaterialSchema.index({ tags: 1 });
studyMaterialSchema.index({ academicYear: 1 });

const StudyMaterial = mongoose.model('StudyMaterial', studyMaterialSchema);

export default StudyMaterial; 