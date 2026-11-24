import * as z from 'zod/mini';

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
  id: z.string().check(z.minLength(1)),
  title: z.string().check(z.trim(), z.minLength(1), z.maxLength(100)),
  message: z.string().check(z.trim(), z.minLength(1), z.maxLength(2000)),
  imageUrl: z.optional(z.url()),
  imagePath: z.optional(z.string()),
  type: ReminderTypeSchema,
  targetRoles: z.array(ReminderUserRoleSchema).check(z.minLength(1)),
  targetShifts: z.array(ReminderShiftSchema).check(z.minLength(1)),
  startDate: z.string().check(z.regex(ISO_DATE_REGEX)),
  endDate: z.string().check(z.regex(ISO_DATE_REGEX)),
  priority: z.int().check(z.minimum(1), z.maximum(3)),
  isActive: z.boolean(),
  createdBy: z.string().check(z.minLength(1)),
  createdByName: z.string().check(z.minLength(1)),
  createdAt: z.string().check(z.minLength(1)),
  updatedAt: z.string().check(z.minLength(1)),
});

export const ReminderReadReceiptSchema = z.object({
  userId: z.string().check(z.minLength(1)),
  userName: z.string().check(z.minLength(1)),
  readAt: z.string().check(z.minLength(1)),
  shift: ReminderShiftSchema,
  dateKey: z.optional(z.string().check(z.regex(ISO_DATE_REGEX))),
});
