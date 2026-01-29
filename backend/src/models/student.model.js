import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'STUDENT', required: true },
  profilePicture: { type: String },
  isActive: { type: Boolean, default: true },
  class: { type: String, required: true },
  section: { type: String, required: true },
  rollNumber: { type: String, required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  admissionNumber: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  gender: { 
    type: String, 
    enum: ['male', 'female', 'other'],
    required: true 
  },
  address: { type: String, required: true },
  contactNumber: { type: String, required: true },
}, {
  timestamps: true
});

// Create indexes for frequently queried fields
studentSchema.index({ class: 1, section: 1 });
studentSchema.index({ rollNumber: 1 }, { unique: true });
studentSchema.index({ admissionNumber: 1 }, { unique: true });

const Student = mongoose.model('Student', studentSchema);

export default Student; 