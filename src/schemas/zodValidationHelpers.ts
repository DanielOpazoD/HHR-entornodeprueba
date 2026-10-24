import * as z from 'zod';

import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CudyrScore } from '@/types/domain/cudyr';

import { DATE_REGEX, RUT_REGEX } from './zod/helpers';
import { PatientDataSchema, CudyrScoreSchema } from './zod/patient';
import { DailyRecordSchema, FullBackupSchema } from './zod/dailyRecord';
import { DischargeDataSchema, TransferDataSchema } from './zod/movements';
import type { ValidationResult } from './zodParseReports';

const toValidationResult = <T>(result: z.ZodSafeParseResult<T>): ValidationResult<T> =>
  result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        errors: result.error.issues.map(
          error => `${error.path.map(String).join('.')}: ${error.message}`
        ),
      };

export const validatePatientData = (data: unknown): ValidationResult<PatientData> =>
  toValidationResult(PatientDataSchema.safeParse(data));

export const validateDailyRecord = (data: unknown): ValidationResult<DailyRecord> =>
  toValidationResult(DailyRecordSchema.safeParse(data)) as ValidationResult<DailyRecord>;

export const validateBackupData = (data: unknown): ValidationResult<Record<string, DailyRecord>> =>
  toValidationResult(FullBackupSchema.safeParse(data)) as ValidationResult<
    Record<string, DailyRecord>
  >;

export const validateRut = (rut: string): boolean => {
  if (!rut || rut.trim() === '') return true;
  return RUT_REGEX.test(rut);
};

export const validateAdmissionDate = (dateStr: string): ValidationResult<string> => {
  if (!dateStr || dateStr.trim() === '') return { success: true, data: '' };
  if (!DATE_REGEX.test(dateStr)) {
    return { success: false, errors: ['Formato de fecha inválido (YYYY-MM-DD)'] };
  }

  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date > today
    ? { success: false, errors: ['La fecha de ingreso no puede ser futura'] }
    : { success: true, data: dateStr };
};

export const validateCudyrScore = (score: unknown): ValidationResult<CudyrScore> =>
  toValidationResult(CudyrScoreSchema.safeParse(score));

export type PatientDataValidated = z.infer<typeof PatientDataSchema>;
export type DailyRecordValidated = z.infer<typeof DailyRecordSchema>;
export type CudyrScoreValidated = z.infer<typeof CudyrScoreSchema>;
export type DischargeDataValidated = z.infer<typeof DischargeDataSchema>;
export type TransferDataValidated = z.infer<typeof TransferDataSchema>;
