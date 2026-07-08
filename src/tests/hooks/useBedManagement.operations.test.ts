import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagement } from '@/hooks/useBedManagement';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import { mockAuditContextValue } from '../setup';

vi.mock('@/services/factories/patientFactory', () => ({
  createEmptyPatient: vi.fn((bedId: string) => ({
    bedId,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    isBlocked: false,
    bedMode: 'Cama' as const,
    hasCompanionCrib: false,
  })),
  clonePatient: vi.fn((patient: PatientData, newBedId: string) => ({
    ...patient,
    bedId: newBedId,
  })),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn(() => 'Test Author'),
}));

describe('useBedManagement operations', () => {
  const mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
  const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

  const runBedAction = async (action: () => void) => {
    await act(async () => {
      action();
      await Promise.resolve();
    });
  };

  const createMockPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
    bedId,
    patientName: 'Test Patient',
    rut: '12.345.678-9',
    age: '45',
    pathology: 'Test Diagnosis',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2025-01-01',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    ...overrides,
  });

  const createMockRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
    date: '2025-01-01',
    beds,
    discharges: [],
    transfers: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
    cma: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('bulk and UI actions', () => {
    it('handles moveOrCopyPatient move', async () => {
      const patient = createMockPatient('R1');
      const targetEmpty = createMockPatient('R2', { patientName: '' });
      const record = createMockRecord({ R1: patient, R2: targetEmpty });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      await runBedAction(() => result.current.moveOrCopyPatient('move', 'R1', 'R2'));

      expect(mockPatchRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          'beds.R2': expect.any(Object),
          'beds.R1': expect.objectContaining({ patientName: '' }),
        })
      );
      expect(mockAuditContextValue.logEvent).toHaveBeenCalledWith(
        'PATIENT_BED_CHANGED',
        'patient',
        'R2',
        expect.objectContaining({
          clinicalEvent: 'Movimiento de paciente entre camas',
          movementKind: 'move',
          sourceBed: 'R1',
          targetBed: 'R2',
          patientName: 'Test Patient',
        }),
        '12.345.678-9',
        '2025-01-01'
      );
      expect(mockAuditContextValue.logDebouncedEvent).not.toHaveBeenCalledWith(
        'PATIENT_MODIFIED',
        'patient',
        'R2',
        expect.objectContaining({ movementKind: 'move' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('handles moveOrCopyPatient copy', async () => {
      const patient = createMockPatient('R1');
      const targetEmpty = createMockPatient('R2', { patientName: '' });
      const record = createMockRecord({ R1: patient, R2: targetEmpty });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      await runBedAction(() => result.current.moveOrCopyPatient('copy', 'R1', 'R2'));

      expect(mockPatchRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          'beds.R2': expect.any(Object),
        })
      );
      expect(mockAuditContextValue.logEvent).toHaveBeenCalledWith(
        'PATIENT_MODIFIED',
        'patient',
        'R2',
        expect.objectContaining({
          clinicalEvent: 'Copia de paciente a otra cama',
          movementKind: 'copy',
          sourceBed: 'R1',
          targetBed: 'R2',
          patientName: 'Test Patient',
        }),
        '12.345.678-9',
        '2025-01-01'
      );
    });

    it('clears UPC automatically when moving to a non-eligible bed', () => {
      const patient = createMockPatient('R1', { isUPC: true });
      const targetEmpty = createMockPatient('H1C1', { patientName: '', isUPC: false });
      const record = createMockRecord({ R1: patient, H1C1: targetEmpty });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.moveOrCopyPatient('move', 'R1', 'H1C1');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          'beds.H1C1': expect.objectContaining({ bedId: 'H1C1', isUPC: false }),
        })
      );
    });

    it('handles clearAllBeds', () => {
      const record = createMockRecord({ R1: createMockPatient('R1'), R2: createMockPatient('R2') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.clearAllBeds();
      });

      expect(mockPatchRecord).toHaveBeenCalled();
    });

    it('toggles block bed and updates reason', () => {
      const record = createMockRecord({ R1: createMockPatient('R1') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.toggleBlockBed('R1', 'Maintenance');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.isBlocked': true,
        'beds.R1.blockedReason': 'Maintenance',
      });

      act(() => {
        result.current.updateBlockedReason('R1', 'New Reason');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.blockedReason': 'New Reason',
      });
    });

    it('toggles extra bed', () => {
      const record = createMockRecord({ R1: createMockPatient('R1') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.toggleExtraBed('R10');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        activeExtraBeds: expect.arrayContaining(['R10']),
      });
    });

    it('toggles bed type', () => {
      const record = createMockRecord({ R1: createMockPatient('R1') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.toggleBedType('R1');
      });

      expect(mockPatchRecord).toHaveBeenCalled();
    });
  });

  describe('error handling and edge cases', () => {
    it('ignores actions when record is null', () => {
      const { result } = renderHook(() =>
        useBedManagement(null, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'age', '50');
      });

      expect(mockPatchRecord).not.toHaveBeenCalled();
    });

    it('handles dispatch errors gracefully', async () => {
      const record = createMockRecord({ R1: createMockPatient('R1') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      vi.mocked(mockAuditContextValue.logDebouncedEvent).mockImplementationOnce(() => {
        throw new Error('Audit fail');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runBedAction(() => result.current.updatePatient('R1', 'age', '50'));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audit logging failed'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles clearPatient audit when name is present', async () => {
      const patient = createMockPatient('R1', { patientName: 'John' });
      const record = createMockRecord({ R1: patient });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      await runBedAction(() => result.current.clearPatient('R1'));

      expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
        'PATIENT_CLEARED',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        patient.rut,
        record.date
      );
    });

    it('handles multiple clinical crib update and audit', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: { patientName: 'Baby', rut: '1-1' } as PatientData,
      });
      const record = createMockRecord({ R1: patient });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateClinicalCribMultiple('R1', { patientName: 'New' });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.patientName': 'New',
      });
    });
  });
});
