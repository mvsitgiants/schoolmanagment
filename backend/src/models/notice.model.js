import mongoose from 'mongoose';

const noticeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    type: {
      type: String,
      enum: ['GENERAL', 'EXAM', 'EVENT', 'HOLIDAY', 'ANNOUNCEMENT'],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    targetAudience: [{
      type: String,
      enum: ['STUDENT', 'TEACHER', 'PARENT', 'STAFF'],
      required: true,
    }],
    targetClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    attachments: [{ type: String }],
    isPublished: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
noticeSchema.index({ startDate: 1, endDate: 1 });
noticeSchema.index({ type: 1 });
noticeSchema.index({ targetAudience: 1 });
noticeSchema.index({ targetClasses: 1 });
noticeSchema.index({ isPublished: 1 });

const Notice = mongoose.model('Notice', noticeSchema);

export default Notice;