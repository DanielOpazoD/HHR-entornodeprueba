import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeBackupHandoffPdf,
  executeBackupCensusExcel,
  executeExportHandoffPdf,
} from '@/application/backup-export/backupExportArchiveUseCases';
import * as backupExportSupport from '@/application/backup-export/backupExportSupport';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import * as criticalFieldsValidator from '@/services/validation/criticalFieldsValidator';

const {
  generateHandoffPdf,
  uploadPdfWithResult,
  uploadCudyrExcelWithResult,
  buildHandoffPdfContent,
  generateCudyrMonthlyExcelBlob,
} = vi.hoisted(() => ({
  generateHandoffPdf: vi.fn(),
  uploadPdfWithResult: vi.fn(),
  uploadCudyrExcelWithResult: vi.fn(),
  buildHandoffPdfContent: vi.fn(),
  generateCudyrMonthlyExcelBlob: vi.fn(),
}));

vi.mock('@/services/pdf/handoffPdfGenerator', () => ({
  generateHandoffPdf,
}));

vi.mock('jspdf', () => ({
  default: vi.fn(function MockJsPdf() {
    return {
      output: vi.fn(() => new Blob(['pdf'])),
    };
  }),
}));

vi.mock('jspdf-autotable', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/backup/pdfContentBuilder', () => ({
  buildHandoffPdfContent,
}));

vi.mock('@/services/backup/pdfStorageService', () => ({
  uploadPdfWithResult,
}));

vi.mock('@/services/cudyr/cudyrExportService', () => ({
  generateCudyrMonthlyExcelBlob,
}));

vi.mock('@/services/backup/cudyrStorageService', () => ({
  uploadCudyrExcelWithResult,
}));

const createBackupRecord = (date = '2026-03-29') =>
  ({
    date,
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
  }) as never;

describe('backupExportArchiveUseCases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    generateHandoffPdf.mockReset();
    uploadPdfWithResult.mockReset();
    uploadCudyrExcelWithResult.mockReset();
    buildHandoffPdfContent.mockReset();
    generateCudyrMonthlyExcelBlob.mockReset();

    vi.spyOn(backupExportSupport, 'resolveHandoffBackupStaff').mockReturnValue({
      delivers: ['Enfermera A'],
      receives: ['Enfermera B'],
    });
    vi.spyOn(criticalFieldsValidator, 'validateCriticalFields').mockReturnValue({
      isValid: true,
      issues: [],
      issueCount: 0,
    });
    uploadPdfWithResult.mockResolvedValue({ status: 'success', data: 'https://pdf.local' });
    uploadCudyrExcelWithResult.mockResolvedValue({
      status: 'success',
      data: 'https://cudyr.local',
    });
    generateCudyrMonthlyExcelBlob.mockResolvedValue(new Blob(['cudyr']));
  });

  it('generates the paginated handoff PDF for local exports', async () => {
    const outcome = await executeExportHandoffPdf({
      record: {
        date: '2026-03-29',
        handoffNovedadesDayShift: '',
        handoffNovedadesNightShift: '',
      } as never,
      selectedShift: 'day',
      isMedical: false,
    });

    expect(generateHandoffPdf).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-03-29' }),
      false,
      'day',
      expect.any(Object)
    );
    expect(outcome.status).toBe('success');
  });

  it('fails gracefully when there is no record to print', async () => {
    const outcome = await executeExportHandoffPdf({
      record: null,
      selectedShift: 'day',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('backup_export_handoff_pdf_invalid_input');
    expect(generateHandoffPdf).not.toHaveBeenCalled();
  });

  it('fails fast for invalid handoff export date before generating pdf', async () => {
    const outcome = await executeExportHandoffPdf({
      record: {
        date: '2026/03/29',
        handoffNovedadesDayShift: '',
        handoffNovedadesNightShift: '',
      } as never,
      selectedShift: 'night',
      isMedical: false,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('backup_export_handoff_pdf_invalid_input');
    expect(generateHandoffPdf).not.toHaveBeenCalled();
  });

  it('fails fast for invalid handoff backup input before resolving staff or validating fields', async () => {
    const resolveStaffSpy = vi.spyOn(backupExportSupport, 'resolveHandoffBackupStaff');
    const validateCriticalFieldsSpy = vi.spyOn(criticalFieldsValidator, 'validateCriticalFields');

    const outcome = await executeBackupHandoffPdf({
      selectedShift: 'night',
      record: { date: '2026/04/20' } as never,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('backup_handoff_pdf_invalid_input');
    expect(resolveStaffSpy).not.toHaveBeenCalled();
    expect(validateCriticalFieldsSpy).not.toHaveBeenCalled();
  });

  it('fails fast for invalid census backup input before reading month records', async () => {
    const monthRecordsSpy = vi.spyOn(defaultDailyRecordReadPort, 'getMonthRecords');

    const outcome = await executeBackupCensusExcel({
      selectedYear: 2026,
      selectedMonth: 12,
      selectedDay: 20,
      currentDateString: '2026-04-20',
      record: null,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('backup_census_excel_invalid_input');
    expect(monthRecordsSpy).not.toHaveBeenCalled();
  });

  it('maps PDF backup permission failures to a typed failed outcome', async () => {
    uploadPdfWithResult.mockResolvedValue({
      status: 'permission_denied',
      data: null,
      error: new Error('storage forbidden'),
    });

    const outcome = await executeBackupHandoffPdf({
      selectedShift: 'day',
      record: createBackupRecord(),
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('backup_handoff_pdf_storage_failed');
    expect(outcome.issues[0]).toEqual(
      expect.objectContaining({
        kind: 'permission',
        code: 'backup/pdf-upload-failed',
        userSafeMessage: 'No tienes permisos para guardar el respaldo PDF.',
        retryable: false,
      })
    );
  });

  it('keeps the PDF backup as partial when the night CUDYR companion upload is denied', async () => {
    uploadCudyrExcelWithResult.mockResolvedValue({
      status: 'permission_denied',
      data: null,
      error: new Error('cudyr forbidden'),
    });

    const outcome = await executeBackupHandoffPdf({
      selectedShift: 'night',
      record: createBackupRecord(),
    });

    expect(outcome.status).toBe('partial');
    expect(outcome.data).toEqual({ shift: 'night', createdCudyrBackup: false });
    expect(outcome.issues[0]).toEqual(
      expect.objectContaining({
        kind: 'permission',
        code: 'backup/cudyr-upload-failed',
        userSafeMessage: 'PDF guardado, pero no tienes permisos para guardar CUDYR.',
      })
    );
  });
});
