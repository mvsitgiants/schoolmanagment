# School Management System Backend

A comprehensive backend API for school management with proper validation, service layer architecture, and standardized response formats.

## 🏗️ Architecture

The application follows a layered architecture pattern:

```
src/
├── config/          # Configuration files
├── controllers/     # Request handlers (thin layer)
├── middleware/      # Express middleware
├── models/          # Database models
├── routes/          # API route definitions
├── services/        # Business logic layer
├── utils/           # Utility functions and helpers
└── index.js         # Application entry point
```

## 🚀 Features

- **Joi Validation**: Comprehensive field validation using Joi schemas
- **Service Layer**: Business logic separated from controllers
- **Standardized Responses**: Consistent API response format
- **Error Handling**: Centralized error handling with custom error classes
- **Authentication & Authorization**: JWT-based auth with role-based access
- **Pagination**: Built-in pagination support
- **Search & Filtering**: Advanced search and filtering capabilities

## 📦 Installation

```bash
npm install
```

## 🔧 Configuration

Create a `.env` file in the root directory:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/school_management
JWT_SECRET=your-secret-key
NODE_ENV=development
```

## 🏃‍♂️ Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## 📚 API Documentation

### Response Format

All API responses follow a standardized format:

#### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "statusCode": 200,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Paginated Response
```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10,
    "hasNext": true,
    "hasPrev": false
  },
  "statusCode": 200,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Email is required",
      "value": null
    }
  ],
  "statusCode": 400,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Authentication

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "TEACHER"
}
```

### Students

#### Get All Students
```http
GET /api/students?page=1&limit=10&search=john&class=10&section=A
Authorization: Bearer <token>
```

#### Create Student
```http
POST /api/students
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "rollNumber": "2024001",
  "admissionNumber": "ADM001",
  "dateOfBirth": "2010-01-01",
  "gender": "male",
  "contactNumber": "1234567890",
  "address": "123 Main St, City",
  "class": "10",
  "section": "A",
  "parentId": "parent_id_here"
}
```

## 🔒 Validation

### Joi Validation Schemas

The application uses Joi for comprehensive validation:

```javascript
// Example validation schema
export const studentValidation = {
  create: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    rollNumber: Joi.string().required(),
    // ... more fields
  })
};
```

### Validation Patterns

- **Email**: Valid email format
- **Password**: Minimum 6 characters
- **Phone**: 10-digit format
- **Date**: ISO date format
- **ObjectId**: MongoDB ObjectId format
- **Pagination**: Page and limit validation

## 🏛️ Service Layer

Business logic is separated into service classes:

```javascript
// Example service method
async createStudent(studentData) {
  // Check for duplicates
  const existingStudent = await Student.findOne({ email: studentData.email });
  if (existingStudent) {
    throw new ConflictError('Email already exists');
  }

  // Create student
  const student = new Student(studentData);
  await student.save();

  return student.populate('parentId', 'name email contactNumber');
}
```

## 🚨 Error Handling

### Custom Error Classes

```javascript
// Available error classes
ValidationError    // 400 - Validation failed
NotFoundError      // 404 - Resource not found
UnauthorizedError  // 401 - Unauthorized access
ForbiddenError     // 403 - Access forbidden
ConflictError      // 409 - Resource conflict
```

### Error Middleware

The application includes comprehensive error handling middleware that:

- Catches Joi validation errors
- Handles Mongoose validation errors
- Manages duplicate key errors
- Processes JWT errors
- Provides development/production error responses

## 🔐 Authentication & Authorization

### JWT Authentication

- Token-based authentication
- Role-based access control
- Token expiration handling

### Role Hierarchy

1. **SUPER_ADMIN**: Full system access
2. **ADMIN**: Administrative access
3. **TEACHER**: Teacher-specific access
4. **STUDENT**: Student-specific access
5. **PARENT**: Parent-specific access
6. **STAFF**: Staff-specific access

### Protected Routes

```javascript
// Example route protection
router.get('/students', auth(['SUPER_ADMIN', 'ADMIN', 'TEACHER']), getStudents);
```

## 📊 Database Models

### User Model
- Authentication and authorization
- Role-based access control
- Password hashing

### Student Model
- Student information
- Parent relationship
- Academic details

### Class Model
- Class management
- Teacher assignment
- Capacity management

## 🛠️ Development Patterns

### Controller Pattern
```javascript
export const createStudent = asyncHandler(async (req, res) => {
  const studentData = req.body;
  const student = await studentService.createStudent(studentData);
  res.status(201).json(ApiResponse.success(student, 'Student created successfully', 201));
});
```

### Service Pattern
```javascript
class StudentService {
  async createStudent(studentData) {
    // Business logic here
    return student;
  }
}
```

### Validation Pattern
```javascript
router.post('/students', 
  validateBody(studentValidation.create), 
  createStudent
);
```

## 🧪 Testing

The application is structured to support easy testing:

- Service layer can be unit tested independently
- Controllers are thin and focused
- Validation is separated and testable
- Error handling is centralized

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `MONGODB_URI` | MongoDB connection string | Required |
| `JWT_SECRET` | JWT signing secret | Required |
| `NODE_ENV` | Environment mode | `development` |

## 🤝 Contributing

1. Follow the established patterns
2. Use Joi validation for all inputs
3. Implement service layer for business logic
4. Use standardized response formats
5. Add proper error handling
6. Include authentication/authorization where needed

## 📄 License

This project is licensed under the MIT License. 