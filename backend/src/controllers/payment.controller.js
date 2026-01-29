import { Payment } from '../models/payment.model.js';

// Get all payments with pagination and filters
export const getPayments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search;
    const statusFilter = req.query.status;
    const typeFilter = req.query.type;

    const query = {};

    if (searchQuery) {
      query.$or = [
        { studentName: { $regex: searchQuery, $options: 'i' } },
        { receiptNumber: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (statusFilter) query.status = statusFilter;
    if (typeFilter) query.type = typeFilter;

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('student', 'name rollNumber')
      .populate('feeStructure', 'name')
      .populate('collectedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      payments,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payments' });
  }
};

// Get payment by ID
export const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('student', 'name rollNumber')
      .populate('feeStructure', 'name')
      .populate('collectedBy', 'name email');
    
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payment' });
  }
};

// Create new payment
export const createPayment = async (req, res) => {
  try {
    const newPayment = new Payment(req.body);
    await newPayment.save();

    res.status(201).json(newPayment);
  } catch (error) {
    res.status(500).json({ message: 'Error creating payment' });
  }
};

// Update payment
export const updatePayment = async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: 'Error updating payment' });
  }
};

// Delete payment
export const deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting payment' });
  }
}; 