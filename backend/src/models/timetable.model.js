import mongoose from 'mongoose';

const timeSlotSchema = new mongoose.Schema({
  startTime: { type: String, required: true }, // Format: "HH:mm"
  endTime: { type: String, required: true }, // Format: "HH:mm"
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  room: { type: String },
});

const timetableSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    section: { type: String, required: true },
    academicYear: { type: String, required: true },
    schedule: [
      {
        day: {
          type: String,
          enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
          required: true,
        },
        slots: [timeSlotSchema],
      },
    ],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
timetableSchema.index({ class: 1, section: 1, academicYear: 1 }, { unique: true });
timetableSchema.index({ 'schedule.slots.teacher': 1 });
timetableSchema.index({ isActive: 1 });

const Timetable = mongoose.model('Timetable', timetableSchema);

export default Timetable; 