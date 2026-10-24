import * as z from 'zod';

const BackupDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido. Use YYYY-MM-DD.');

const isValidCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

export type BackupDateParts = {
  year: string;
  month: string;
  day: string;
};

export const parseBackupDateParts = (date: string, context: string): BackupDateParts => {
  const parsedDate = BackupDateSchema.parse(date);
  const [yearRaw, monthRaw, dayRaw] = parsedDate.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!isValidCalendarDate(year, month, day)) {
    throw new Error(`[${context}] Fecha inválida: ${date}`);
  }

  return { year: yearRaw, month: monthRaw, day: dayRaw };
};

export const isBackupDateValidationError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('formato de fecha inválido') ||
    (message.includes('fecha inválida') && message.includes('['))
  );
};
