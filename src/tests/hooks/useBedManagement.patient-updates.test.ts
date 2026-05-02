import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createEmptyPatient } from '@/services/factories/patientFactory';
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

describe('useBedManagement patient updates', () => {
  const mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
  const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

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

  describe('updatePatient', () => {
    it('updates a single patient field via patchRecord', () => {
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'age', '50');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.age': '50',
      });
    });

    it('logs patient admission when patientName is set for the first time', () => {
      const emptyPatient = createEmptyPatient('R1');
      const record = createMockRecord({ R1: emptyPatient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'patientName', 'New Name');
      });

      expect(mockAuditContextValue.logPatientAdmission).toHaveBeenCalled();
    });

    it('logs PATIENT_MODIFIED when patientName changes', () => {
      const patient = createMockPatient('R1', { patientName: 'Old Name' });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'patientName', 'New Name');
      });

      expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
        'PATIENT_MODIFIED',
        'patient',
        'R1',
        expect.objectContaining({ patientName: 'New Name' }),
        patient.rut,
        record.date
      );
    });

    it('logs PATIENT_MODIFIED for critical fields', () => {
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'status', PatientStatus.GRAVE);
      });

      expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalledWith(
        'PATIENT_MODIFIED',
        'patient',
        'R1',
        expect.objectContaining({
          changes: expect.objectContaining({
            status: expect.objectContaining({
              old: PatientStatus.ESTABLE,
              new: PatientStatus.GRAVE,
            }),
          }),
        }),
        patient.rut,
        record.date
      );
    });

    it('logs PATIENT_MODIFIED when devices change', () => {
      const patient = createMockPatient('R1', {
        deviceDetails: { VMI: { installationDate: '2025-01-01' } },
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'deviceDetails', {
          VMI: { installationDate: '2025-01-01' },
          CVC: { installationDate: '2025-01-02' },
        });
      });

      expect(mockAuditContextValue.logDebouncedEvent).toHaveBeenCalled();
    });

    it('handles validation failure', () => {
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatient('R1', 'admissionDate', '2099-01-01');
      });

      expect(mockPatchRecord).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('updates multiple patient fields', () => {
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatientMultiple('R1', {
          age: '50',
          pathology: 'New Diagnosis',
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.age': '50',
        'beds.R1.pathology': 'New Diagnosis',
      });
    });

    it('does not append gineco cleanup fields when updating only medical handoff fields', () => {
      const patient = createMockPatient('R1', {
        specialty: 'Med Interna' as PatientData['specialty'],
        ginecobstetriciaType: 'Obstétrica' as PatientData['ginecobstetriciaType'],
        deliveryRoute: 'Cesárea' as PatientData['deliveryRoute'],
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updatePatientMultiple('R1', {
          medicalHandoffNote: 'Evolución especialista',
          medicalHandoffEntries: [
            {
              id: 'entry-1',
              specialty: 'Med Interna',
              note: 'Evolución especialista',
            },
          ] as PatientData['medicalHandoffEntries'],
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.medicalHandoffNote': 'Evolución especialista',
        'beds.R1.medicalHandoffEntries': [
          {
            id: 'entry-1',
            specialty: 'Med Interna',
            note: 'Evolución especialista',
          },
        ],
      });
    });
  });

  describe('updateCudyr', () => {
    it('updates the Cudyr field and logs modification', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-23T10:15:00.000Z'));
      const patient = createMockPatient('R1');
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateCudyr('R1', 'changeClothes', 3);
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.cudyr.changeClothes': 3,
        cudyrUpdatedAt: '2026-03-23T10:15:00.000Z',
      });
      expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledWith(
        'R1',
        'Test Patient',
        patient.rut,
        'changeClothes',
        3,
        0,
        record.date,
        'Test Author'
      );
    });

    it('ignores CUDYR updates for beds without a real patient name', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-23T10:20:00.000Z'));
      const patient = createMockPatient('R1', {
        patientName: '   ',
        rut: '',
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateCudyr('R1', 'changeClothes', 3);
      });

      expect(mockPatchRecord).not.toHaveBeenCalled();
      expect(mockAuditContextValue.logDebouncedEvent).not.toHaveBeenCalled();
    });
  });

  describe('clinical crib helpers', () => {
    it('handles updateClinicalCrib create', () => {
      const record = createMockRecord({ R1: createMockPatient('R1') });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateClinicalCrib('R1', 'create');
      });
    });

    it('updates clinical crib CUDYR', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-23T11:05:00.000Z'));
      const patient = createMockPatient('R1', {
        clinicalCrib: { patientName: 'Baby', rut: '1-1', cudyr: {} } as PatientData,
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateClinicalCribCudyr('R1', 'feeding', 2);
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.cudyr.feeding': 2,
        cudyrUpdatedAt: '2026-03-23T11:05:00.000Z',
      });
      expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledWith(
        'R1-crib',
        'Baby',
        '1-1',
        'feeding',
        2,
        0,
        record.date,
        'Test Author'
      );
    });

    it('updates multiple clinical crib fields', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: { patientName: 'Baby', rut: '1-1', bedMode: 'Cuna' } as PatientData,
      });
      const record = createMockRecord({ R1: patient });

      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateClinicalCribMultiple('R1', {
          patientName: 'New Baby Name',
          age: '1',
        });
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib.patientName': 'New Baby Name',
        'beds.R1.clinicalCrib.age': '1',
      });
    });

    it('handles updateClinicalCrib remove', () => {
      const patient = createMockPatient('R1', {
        clinicalCrib: { patientName: 'Baby', rut: '1-1' } as PatientData,
      });
      const record = createMockRecord({ R1: patient });
      const { result } = renderHook(() =>
        useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
      );

      act(() => {
        result.current.updateClinicalCrib('R1', 'remove');
      });

      expect(mockPatchRecord).toHaveBeenCalledWith({
        'beds.R1.clinicalCrib': null,
      });
    });
  });
});
