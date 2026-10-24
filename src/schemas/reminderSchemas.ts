import * as z from 'zod';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const ReminderTypeSchema = z.enum(['info', 'warning', 'urgent']);
export const ReminderShiftSchema = z.enum(['day', 'night']);
export const ReminderUserRoleSchema = z.enum([
  'viewer',
  'editor',
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
]);

export const ReminderSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url().optional(),
  imagePath: z.string().optional(),
  type: ReminderTypeSchema,
  targetRoles: z.array(ReminderUserRoleSchema).min(1),
  targetShifts: z.array(ReminderShiftSchema).min(1),
  startDate: z.string().regex(ISO_DATE_REGEX),
  endDate: z.string().regex(ISO_DATE_REGEX),
  priority: z.number().int().min(1).max(3),
  isActive: z.boolean(),
  createdBy: z.string().min(1),
  createdByName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ReminderReadReceiptSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().min(1),
  readAt: z.string().min(1),
  shift: ReminderShiftSchema,
  dateKey: z.string().regex(ISO_DATE_REGEX).optional(),
});

export const ReminderDraftSchema = z.object({
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url().optional().or(z.literal('')),
  type: ReminderTypeSchema,
  targetRoles: z.array(ReminderUserRoleSchema).min(1),
  targetShifts: z.array(ReminderShiftSchema).min(1),
  startDate: z.string().regex(ISO_DATE_REGEX),
  endDate: z.string().regex(ISO_DATE_REGEX),
  priority: z.number().int().min(1).max(3),
  isActive: z.boolean(),
});
