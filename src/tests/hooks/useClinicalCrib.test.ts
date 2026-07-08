import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClinicalCrib } from '@/hooks/useClinicalCrib';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';

describe('useClinicalCrib', () => {
  const mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
  const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

  const createMockPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
    bedId,
    patientName: 'Mother Patient',
    rut: '12.345.678-9',
    age: '30',
    pathology: 'Post-parto',
    specialty: Specialty.GINECOBSTETRICIA,
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
  });

  describe('createCrib', () => {
    it('should create a clinical crib via patchRecord', () => {
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useClinicalCrib(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.createCrib('R1');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          'beds.R1.clinicalCrib': expect.objectContaining({
            bedMode: 'Cuna',
            identityStatus: 'provisional',
            patientName: 'RN de Mother Patient',
            rut: '',
          }),
        })
      );
    });
  });

  describe('removeCrib', () => {
    it('should remove clinical crib via patchRecord', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: createMockPatient('R1-crib', {
          patientName: 'Baby',
          bedMode: 'Cuna',
        }),
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useClinicalCrib(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.removeCrib('R1');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib': null, // Match actual implementation (it uses null for Firestore removals)
      });
    });
  });

  describe('updateCribField', () => {
    it('should update a crib field via patchRecord', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: createMockPatient('R1-crib', {
          patientName: 'Baby',
          bedMode: 'Cuna',
        }),
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useClinicalCrib(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateCribField('R1', 'patientName', 'Updated Baby Name');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.patientName': 'Updated Baby Name',
      });
    });

    it('handles rejected crib field persistence without an unhandled rejection', async () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: createMockPatient('R1-crib', {
          patientName: 'Baby',
          bedMode: 'Cuna',
        }),
      });
      const record = createMockRecord({ R1: patient });
      const failingPatchRecord = vi.fn().mockRejectedValue(new Error('blocked'));

      const { result } = renderHook(() =>
        useClinicalCrib(record, mockSaveAndUpdate, failingPatchRecord)
      );

      await expect(
        result.current.updateCribField('R1', 'patientName', 'Updated Baby Name')
      ).resolves.toBeUndefined();
      expect(failingPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.patientName': 'Updated Baby Name',
      });
    });
  });

  describe('updateCribMultiple', () => {
    it('should update multiple crib fields via patchRecord', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: createMockPatient('R1-crib', {
          patientName: 'Baby',
          bedMode: 'Cuna',
        }),
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useClinicalCrib(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateCribMultiple('R1', {
          patientName: 'New name',
          age: '10',
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.patientName': 'New name',
        'beds.R1.clinicalCrib.age': '10',
      });
    });
  });
});
