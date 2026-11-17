import type { UserRole } from './authRoleTypes';

export type ReminderType = 'info' | 'warning' | 'urgent';
export type ReminderShift = 'day' | 'night';

export interface Reminder {
  id: string;
  title: string;
  message: string;
  imageUrl?: string;
  imagePath?: string;
  type: ReminderType;
  targetRoles: UserRole[];
  targetShifts: ReminderShift[];
  startDate: string;
  endDate: string;
  priority: number;
  isActive: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderReadReceipt {
  userId: string;
  userName: string;
  readAt: string;
  shift: ReminderShift;
  dateKey?: string;
}

export interface ReminderVisibilityContext {
  role?: UserRole;
  shift: ReminderShift;
  currentDate: string;
  readReminderIds?: string[];
}
