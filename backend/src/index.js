import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/auth.routes.js';
import studentRoutes from './routes/student.routes.js';
import classRoutes from './routes/class.routes.js';
import subjectRoutes from './routes/subject.routes.js';
import examRoutes from './routes/exam.routes.js';
import noticeRoutes from './routes/notice.routes.js';
import bookRoutes from './routes/book.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import studyMaterialRoutes from './routes/studyMaterial.routes.js';
import timetableRoutes from './routes/timetable.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/study-materials', studyMaterialRoutes);
app.use('/api/timetables', timetableRoutes);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 