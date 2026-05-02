import type { ApplicationIssue } from '@/shared/contracts/applicationOutcomeTypes';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { HandoffPdfRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import type { DailyRecordCriticalValidationState } from '@/application/shared/dailyRecordBedContracts';
import type { DailyRecordCudyrExportState } from '@/application/shared/dailyRecordStaffContracts';

type HandoffBackupRecord = HandoffPdfRecord &
  DailyRecordCriticalValidationState &
  DailyRecordCudyrExportState;

export interface BackupCensusExcelInput {
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  currentDateString: string;
  record: CensusExportRecord | null;
}

export interface ExportHandoffPdfInput {
  record: HandoffPdfRecord | null;
  selectedShift: 'day' | 'night';
  isMedical?: boolean;
}

export interface BackupHandoffPdfInput {
  record: HandoffBackupRecord | null;
  selectedShift: 'day' | 'night';
}

export interface BackupHandoffPdfOutput {
  shift: 'day' | 'night';
  createdCudyrBackup: boolean;
}

const MIN_SUPPORTED_YEAR = 2000;
const MAX_SUPPORTED_YEAR = 2100;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_HANDOFF_SHIFT = 'day' as const;

const toSafeInteger = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
};

const toSafeString = (value: unknown): string =>
  typeof value === 'string' ? value : String(value ?? '');

const normalizeHandoffShift = (value: unknown): 'day' | 'night' =>
  value === 'night' || value === 'day' ? value : FALLBACK_HANDOFF_SHIFT;

const normalizeRecordDate = <T extends { date?: unknown }>(record: T): T => ({
  ...record,
  date: toSafeString(record.date).trim(),
});

const hasIsoDateFormat = (value: string): boolean => ISO_DATE_PATTERN.test(value);

export const normalizeBackupCensusExcelInput = (
  input: BackupCensusExcelInput
): BackupCensusExcelInput => ({
  ...input,
  selectedYear: toSafeInteger(input.selectedYear),
  selectedMonth: toSafeInteger(input.selectedMonth),
  selectedDay: toSafeInteger(input.selectedDay),
  currentDateString: input.currentDateString.trim(),
});

const buildExpectedDateFromSelection = (input: BackupCensusExcelInput): string =>
  `${input.selectedYear}-${String(input.selectedMonth + 1).padStart(2, '0')}-${String(
    input.selectedDay
  ).padStart(2, '0')}`;

export const validateBackupCensusExcelInput = (
  input: BackupCensusExcelInput
): ApplicationIssue[] => {
  const issues: ApplicationIssue[] = [];

  if (input.selectedYear < MIN_SUPPORTED_YEAR || input.selectedYear > MAX_SUPPORTED_YEAR) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-invalid-year',
      message: 'Selected year is outside supported range.',
    });
  }

  if (input.selectedMonth < 0 || input.selectedMonth > 11) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-invalid-month',
      message: 'Selected month must be between 0 and 11.',
    });
  }

  if (input.selectedDay < 1 || input.selectedDay > 31) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-invalid-day',
      message: 'Selected day must be between 1 and 31.',
    });
  }

  if (!ISO_DATE_PATTERN.test(input.currentDateString)) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-invalid-date-format',
      message: 'Current date must follow ISO format YYYY-MM-DD.',
    });
  }

  if (issues.length > 0) {
    return issues;
  }

  const expectedDate = buildExpectedDateFromSelection(input);
  if (input.currentDateString !== expectedDate) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-date-mismatch',
      message: 'Selected date fields do not match the active date string.',
    });
  }

  if (input.record && input.record.date !== input.currentDateString) {
    issues.push({
      kind: 'validation',
      code: 'backup/census-record-date-mismatch',
      message: 'Record date does not match the active export date.',
    });
  }

  return issues;
};

export const normalizeExportHandoffPdfInput = (
  input: ExportHandoffPdfInput
): ExportHandoffPdfInput => ({
  ...input,
  selectedShift: normalizeHandoffShift(input.selectedShift),
  isMedical: Boolean(input.isMedical),
  record: input.record ? normalizeRecordDate(input.record) : null,
});

export const validateExportHandoffPdfInput = (input: ExportHandoffPdfInput): ApplicationIssue[] => {
  if (!input.record) {
    return [
      {
        kind: 'validation',
        code: 'backup/handoff-export-missing-record',
        message: 'No handoff record is available for PDF export.',
      },
    ];
  }

  if (!hasIsoDateFormat(toSafeString(input.record.date))) {
    return [
      {
        kind: 'validation',
        code: 'backup/handoff-export-invalid-date',
        message: 'Handoff record date must follow ISO format YYYY-MM-DD.',
      },
    ];
  }

  return [];
};

export const normalizeBackupHandoffPdfInput = (
  input: BackupHandoffPdfInput
): BackupHandoffPdfInput => ({
  ...input,
  selectedShift: normalizeHandoffShift(input.selectedShift),
  record: input.record ? normalizeRecordDate(input.record) : null,
});

export const validateBackupHandoffPdfInput = (input: BackupHandoffPdfInput): ApplicationIssue[] => {
  if (!input.record) {
    return [
      {
        kind: 'validation',
        code: 'backup/handoff-backup-missing-record',
        message: 'No handoff record is available for backup.',
      },
    ];
  }

  if (!hasIsoDateFormat(toSafeString(input.record.date))) {
    return [
      {
        kind: 'validation',
        code: 'backup/handoff-backup-invalid-date',
        message: 'Handoff backup record date must follow ISO format YYYY-MM-DD.',
      },
    ];
  }

  return [];
};
