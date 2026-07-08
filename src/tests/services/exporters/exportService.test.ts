import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportDataJSON,
  exportDataJSONWithResult,
  exportDataCSV,
  exportDataCSVWithResult,
  importDataJSON,
  importDataJSONWithResult,
  importDataJSONDetailed,
  importDataCSV,
  importDataCSVWithResult,
} from '@/services/exporters/exportService';
import * as recordStorage from '@/services/storage/indexeddb/indexedDbRecordService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';

// Mock dependencies
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/indexeddb/indexedDbRecordService')>();
  return {
    ...actual,
    getAllRecords: vi.fn(),
    saveRecord: vi.fn(),
    saveRecordsStrict: vi.fn(() =>
      Promise.resolve({
        ok: true,
        operation: 'save_many',
        store: 'indexeddb',
        dates: ['2025-01-01'],
      })
    ),
  };
});

describe('exportService', () => {
  const mockRecord: DailyRecord = {
    date: '2025-01-01',
    beds: {
      'UTI-1': {
        patientName: 'Test Patient',
        rut: '12345678-9',
        pathology: 'Test',
        specialty: 'Medicina',
        status: 'Estable',
        admissionDate: '2025-01-01',
        devices: [],
        isUPC: false,
        isBlocked: false,
        location: 'UTI',
        deviceDetails: {},
      } as unknown as PatientData,
    },
    discharges: [
      {
        id: 'discharge-1',
        bedId: 'UTI-1',
        bedName: 'UTI 1',
        bedType: 'UTI',
        patientName: 'Paciente Alta',
        rut: '98765432-1',
        diagnosis: 'Recuperado',
        status: 'Vivo',
      },
    ] as unknown as DischargeData[],
    transfers: [
      {
        id: 'transfer-1',
        time: '10:00',
        bedId: 'UTI-2',
        bedName: 'UTI 2',
        bedType: 'UTI',
        patientName: 'Paciente Traslado',
        rut: '11111111-1',
        diagnosis: 'Fractura',
        evacuationMethod: 'Avión Comercial',
        receivingCenter: 'Hospital Regional',
      },
    ] as unknown as TransferData[],
    cma: [],
    nurses: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    activeExtraBeds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DOM methods
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
  });

  describe('exportDataJSON', () => {
    it('exports all records as JSON', async () => {
      const mockElement = { click: vi.fn() };
      vi.spyOn(document, 'createElement').mockReturnValue(
        mockElement as unknown as HTMLAnchorElement
      );
      vi.spyOn(document.body, 'appendChild').mockImplementation(node => node as unknown as Node);
      vi.spyOn(document.body, 'removeChild').mockImplementation(node => node as unknown as Node);

      vi.mocked(recordStorage.getAllRecords).mockResolvedValue({
        '2025-01-01': mockRecord,
      });

      await exportDataJSON();

      expect(recordStorage.getAllRecords).toHaveBeenCalled();
      expect(mockElement.click).toHaveBeenCalled();
    });

    it('returns a typed success when exporting JSON succeeds', async () => {
      const mockElement = { click: vi.fn() };
      vi.spyOn(document, 'createElement').mockReturnValue(
        mockElement as unknown as HTMLAnchorElement
      );
      vi.spyOn(document.body, 'appendChild').mockImplementation(node => node as unknown as Node);
      vi.spyOn(document.body, 'removeChild').mockImplementation(node => node as unknown as Node);
      vi.mocked(recordStorage.getAllRecords).mockResolvedValue({
        '2025-01-01': mockRecord,
      });

      const result = await exportDataJSONWithResult();

      expect(result.status).toBe('success');
      expect(result.data.exported).toBe(true);
    });
  });

  describe('exportDataCSV', () => {
    it('does nothing when record is null', () => {
      const createSpy = vi.spyOn(document, 'createElement');
      exportDataCSV(null);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('returns a typed validation failure when record is null', () => {
      const result = exportDataCSVWithResult(null);
      expect(result.status).toBe('failed');
      expect(result.issues[0]?.kind).toBe('validation');
    });
  });

  describe('importDataJSON', () => {
    it('imports valid JSON data', async () => {
      const validData = { '2025-01-01': mockRecord };
      vi.mocked(recordStorage.saveRecordsStrict).mockResolvedValue({
        ok: true,
        operation: 'save_many',
        store: 'indexeddb',
        dates: ['2025-01-01'],
      });

      const file = new File([JSON.stringify(validData)], 'backup.json', {
        type: 'application/json',
      });
      const result = await importDataJSON(file);

      expect(result).toBe(true);
      expect(recordStorage.saveRecordsStrict).toHaveBeenCalledWith([
        expect.objectContaining({ date: '2025-01-01' }),
      ]);
    });

    it('returns a typed success for valid JSON imports', async () => {
      const validData = { '2025-01-01': mockRecord };
      vi.mocked(recordStorage.saveRecordsStrict).mockResolvedValue({
        ok: true,
        operation: 'save_many',
        store: 'indexeddb',
        dates: ['2025-01-01'],
      });

      const file = new File([JSON.stringify(validData)], 'backup.json', {
        type: 'application/json',
      });
      const result = await importDataJSONWithResult(file);

      expect(result.status).toBe('success');
      expect(result.data.imported).toBe(true);
    });

    it('blocks JSON import when strict local persistence rejects the batch', async () => {
      const consoleSpies = suppressConsole(['error']);
      const validData = { '2025-01-01': mockRecord };
      vi.mocked(recordStorage.saveRecordsStrict).mockResolvedValue({
        ok: false,
        operation: 'save_many',
        store: 'none',
        dates: ['2025-01-01'],
        error: new Error('indexeddb unavailable'),
        userSafeMessage: 'No fue posible guardar registros locales.',
      });

      try {
        const file = new File([JSON.stringify(validData)], 'backup.json', {
          type: 'application/json',
        });
        const result = await importDataJSONDetailed(file);

        expect(result.success).toBe(false);
        expect(result.outcome).toBe('blocked');
        expect(result.importedCount).toBe(0);
        expect(recordStorage.saveRecordsStrict).toHaveBeenCalledWith([
          expect.objectContaining({ date: '2025-01-01' }),
        ]);
      } finally {
        restoreConsole(consoleSpies);
      }
    });

    it('rejects invalid JSON via outcome (no native alert)', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      const file = new File(['[{"invalid": true}]'], 'backup.json');
      const result = await importDataJSON(file);

      // Service no longer renders UI; it returns false through the outcome
      // contract and the caller (executeImportJsonBackup → UI consumer)
      // presents the failure via useNotification.
      expect(result).toBe(false);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('reports repaired imports without failing', async () => {
      vi.mocked(recordStorage.saveRecordsStrict).mockResolvedValue({
        ok: true,
        operation: 'save_many',
        store: 'indexeddb',
        dates: ['2025-01-01'],
      });
      const repairedData = {
        '2025-01-01': {
          ...mockRecord,
          beds: {
            'UTI-1': {
              patientName: 'Paciente Legacy',
              status: 'ESTADO_INVALIDO',
              clinicalEvents: [null],
            },
          },
        },
      };

      const file = new File([JSON.stringify(repairedData)], 'backup.json', {
        type: 'application/json',
      });
      const result = await importDataJSONDetailed(file);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('repaired');
      expect(result.repairedCount).toBe(1);
      expect(result.importedCount).toBe(1);
    });
  });

  describe('importDataCSV', () => {
    it('returns false as CSV import is not implemented', async () => {
      const file = new File(['data'], 'test.csv');
      const result = await importDataCSV(file);
      expect(result).toBe(false);
    });

    it('returns a typed validation failure as CSV import is not implemented', async () => {
      const file = new File(['data'], 'test.csv');
      const result = await importDataCSVWithResult(file);
      expect(result.status).toBe('failed');
      expect(result.issues[0]?.userSafeMessage).toContain('CSV');
    });
  });
});
