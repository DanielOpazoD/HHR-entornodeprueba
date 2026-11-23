import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportDataJSONWithResult,
  exportDataCSVWithResult,
  importDataJSON,
  importDataJSONWithResult,
  importDataJSONDetailed,
} from '@/services/exporters/exportService';
import * as backupStorage from '@/services/repositories/dailyRecordBackupImportWriteService';
import * as recordStorage from '@/services/storage/indexeddb/indexedDbRecordService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

// Mock dependencies
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/indexeddb/indexedDbRecordService')>();
  return {
    ...actual,
    getAllRecords: vi.fn(),
    saveRecord: vi.fn(),
  };
});

vi.mock('@/services/repositories/dailyRecordBackupImportWriteService', () => ({
  saveBackupImport: vi.fn(async () => []),
}));

describe('exportService', () => {
  const mockRecord: DailyRecord = DataFactory.createMockDailyRecord('2025-01-01', {
    beds: {
      'UTI-1': DataFactory.createMockPatient('UTI-1', {
        patientName: 'Test Patient',
        rut: '12345678-9',
        pathology: 'Test',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2025-01-01',
        devices: [],
        isUPC: false,
        isBlocked: false,
        location: 'UTI',
        deviceDetails: {},
      }),
    },
    discharges: [
      DataFactory.createMockDischarge({
        id: 'discharge-1',
        bedId: 'UTI-1',
        bedName: 'UTI 1',
        bedType: 'UTI',
        patientName: 'Paciente Alta',
        rut: '98765432-1',
        diagnosis: 'Recuperado',
        status: 'Vivo',
      }),
    ],
    transfers: [
      DataFactory.createMockTransfer({
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
      }),
    ],
    cma: [],
    nurses: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    activeExtraBeds: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DOM methods
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
  });

  describe('exportDataJSONWithResult', () => {
    it('returns a typed success when exporting JSON succeeds', async () => {
      const anchor = document.createElement('a');
      const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
      vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);
      vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
      vi.spyOn(document.body, 'removeChild').mockImplementation(node => node);
      vi.mocked(recordStorage.getAllRecords).mockResolvedValue({
        '2025-01-01': mockRecord,
      });

      const result = await exportDataJSONWithResult();

      expect(result.status).toBe('success');
      expect(result.data.exported).toBe(true);
      expect(recordStorage.getAllRecords).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('exportDataCSVWithResult', () => {
    it('returns a typed validation failure and creates no link when record is null', () => {
      const createSpy = vi.spyOn(document, 'createElement');
      const result = exportDataCSVWithResult(null);
      expect(result.status).toBe('failed');
      expect(result.issues[0]?.kind).toBe('validation');
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('importDataJSON', () => {
    it('imports valid JSON data', async () => {
      const validData = { '2025-01-01': mockRecord };
      vi.mocked(backupStorage.saveBackupImport).mockResolvedValue([]);

      const file = new File([JSON.stringify(validData)], 'backup.json', {
        type: 'application/json',
      });
      const result = await importDataJSON(file);

      expect(result).toBe(true);
      expect(backupStorage.saveBackupImport).toHaveBeenCalledWith(
        [expect.objectContaining({ date: '2025-01-01' })],
        ['2025-01-01']
      );
    });

    it('returns a typed success for valid JSON imports', async () => {
      const validData = { '2025-01-01': mockRecord };
      vi.mocked(backupStorage.saveBackupImport).mockResolvedValue([]);

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
      vi.mocked(backupStorage.saveBackupImport).mockRejectedValueOnce(
        new Error('indexeddb unavailable')
      );

      try {
        const file = new File([JSON.stringify(validData)], 'backup.json', {
          type: 'application/json',
        });
        const result = await importDataJSONDetailed(file);

        expect(result.success).toBe(false);
        expect(result.outcome).toBe('blocked');
        expect(result.importedCount).toBe(0);
        expect(backupStorage.saveBackupImport).toHaveBeenCalledWith(
          [expect.objectContaining({ date: '2025-01-01' })],
          ['2025-01-01']
        );
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
      vi.mocked(backupStorage.saveBackupImport).mockResolvedValue([]);
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
});
