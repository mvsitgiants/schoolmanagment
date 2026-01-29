export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
  PARENT = 'PARENT',
  ACCOUNTANT = 'ACCOUNTANT',
  LIBRARIAN = 'LIBRARIAN'
}

export interface IUser {
  _id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  profilePicture?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStudent extends IUser {
  class: string;
  section: string;
  rollNumber: string;
  parentId: string;
  admissionNumber: string;
  dateOfBirth: Date;
  gender: 'male' | 'female' | 'other';
  address: string;
  contactNumber: string;
}

export interface ITeacher extends IUser {
  subjects: string[];
  classTeacherOf?: string;
  qualification: string;
  experience: number;
  contactNumber: string;
}

export interface IParent extends IUser {
  children: string[];
  occupation: string;
  contactNumber: string;
  alternateContactNumber?: string;
} 