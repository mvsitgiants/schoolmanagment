import mongoose from 'mongoose';

const feeStructureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, required: true },
    fees: [{
      type: { type: String, required: true },
      amount: { type: Number, required: true },
      dueDate: { type: Date },
      isOptional: { type: Boolean, default: false },
      description: { type: String },
    }],
  },
  {
    timestamps: true,
  }
);

const paymentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    feeStructure: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure', required: true },
    academicYear: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'],
      required: true,
    },
    transactionId: { type: String },
    receiptNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
      required: true,
      default: 'PENDING',
    },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    remarks: { type: String },
  },
  {
    timestamps: true,
  }
);

// Create indexes for frequently queried fields
feeStructureSchema.index({ class: 1, academicYear: 1 }, { unique: true });

paymentSchema.index({ student: 1 });
paymentSchema.index({ feeStructure: 1 });
paymentSchema.index({ academicYear: 1 });
paymentSchema.index({ paymentDate: 1 });
paymentSchema.index({ receiptNumber: 1 }, { unique: true });
paymentSchema.index({ status: 1 });

const FeeStructure = mongoose.model('FeeStructure', feeStructureSchema);
const Payment = mongoose.model('Payment', paymentSchema);

export { FeeStructure, Payment }; 