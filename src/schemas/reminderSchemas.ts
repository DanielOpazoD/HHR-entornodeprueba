import * as z from 'zod/mini';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-](\d{2}):(\d{2}))$/;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
};

export const isValidReminderCalendarDate = (value: string): boolean => {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
};

export const isValidReminderTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_REGEX.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  if (!isValidReminderCalendarDate(`${year}-${month}-${day}`)) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
};

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
  userId: z.string().check(z.trim(), z.minLength(1)),
  userName: z.string().check(z.trim(), z.minLength(1)),
  readAt: z.string().check(z.refine(isValidReminderTimestamp, 'Instante de lectura inválido')),
  shift: ReminderShiftSchema,
  dateKey: z.optional(
    z.string().check(z.refine(isValidReminderCalendarDate, 'Fecha de turno inválida'))
  ),
});
