import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagement } from '@/hooks/useBedManagement';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import { DataFactory } from '@/tests/factories/DataFactory';

// Mock audit context
vi.mock('../../context/AuditContext', () => ({
  useAuditContext: () => ({
    logDebouncedEvent: vi.fn(),
    userId: 'test-user',
  }),
}));

// Mock hook dependencies
vi.mock('../../hooks/usePatientValidation', () => ({
  usePatientValidation: () => ({
    processFieldValue: (field: string, value: unknown) => ({ valid: true, value }),
  }),
}));

vi.mock('../../hooks/useBedOperations', () => ({
  useBedOperations: () => ({
    clearPatient: vi.fn(),
    clearAllBeds: vi.fn(),
    moveOrCopyPatient: vi.fn(),
    toggleBlockBed: vi.fn(),
    updateBlockedReason: vi.fn(),
    toggleExtraBed: vi.fn(),
  }),
}));

vi.mock('../../hooks/useClinicalCrib', () => ({
  useClinicalCrib: () => ({
    createCrib: vi.fn(),
    removeCrib: vi.fn(),
    updateCribField: vi.fn(),
    updateCribMultiple: vi.fn(),
    updateCribCudyr: vi.fn(),
    updateCribMultipleFields: vi.fn(),
  }),
}));

describe('Identity-based Diagnosis Clearing', () => {
  let mockRecord: DailyRecord;
  let patchRecord: ApplyDailyRecordPatch;
  let saveAndUpdate: PersistDailyRecord;

  beforeEach(() => {
    mockRecord = DataFactory.createMockDailyRecord('2026-01-18', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Patient A',
          rut: '11.111.111-1',
          age: '30',
          pathology: 'Old Pathology',
          cie10Code: 'A00',
          cie10Description: 'Old Diagnosis',
          specialty: Specialty.MEDICINA,
          status: PatientStatus.ESTABLE,
          admissionDate: '2026-01-10',
          devices: [],
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
          hasWristband: true,
          surgicalComplication: false,
          isUPC: false,
          clinicalEvents: [],
        }),
      },
      lastUpdated: '2026-01-18T00:00:00.000Z',
    });

    patchRecord = vi.fn().mockResolvedValue(undefined) as ApplyDailyRecordPatch;
    saveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
  });

  it('should clear diagnosis fields when RUT changes', async () => {
    const { result } = renderHook(() => useBedManagement(mockRecord, saveAndUpdate, patchRecord));

    // Update RUT to a different one
    await act(async () => {
      result.current.updatePatient('R1', 'rut', '22.222.222-2');
    });

    // El cambio de identidad mezcla campos estructurales con la limpieza del
    // envelope clínico; el despacho lo divide en dos comandos secuenciales
    // (la separación enforced rechaza el patch mezclado).
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        [`beds.R1.rut`]: '22.222.222-2',
        [`beds.R1.clinicalEvents`]: [],
        [`beds.R1.cudyr`]: undefined,
        [`beds.R1.deviceDetails`]: {},
        [`beds.R1.devices`]: [],
      })
    );
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        [`beds.R1.cie10Code`]: undefined,
        [`beds.R1.cie10Description`]: undefined,
        [`beds.R1.pathology`]: '',
      })
    );
  });

  it('should ALSO clear diagnosis fields when patientName changes significantly', async () => {
    const { result } = renderHook(() => useBedManagement(mockRecord, saveAndUpdate, patchRecord));

    // Update Name to a different one
    await act(async () => {
      result.current.updatePatient('R1', 'patientName', 'Different Patient');
    });

    // Igual que con el RUT: estructural/identidad primero, envelope clínico después.
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        [`beds.R1.patientName`]: 'Different Patient',
        [`beds.R1.clinicalEvents`]: [],
        [`beds.R1.cudyr`]: undefined,
        [`beds.R1.deviceDetails`]: {},
        [`beds.R1.devices`]: [],
      })
    );
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        [`beds.R1.cie10Code`]: undefined,
        [`beds.R1.cie10Description`]: undefined,
        [`beds.R1.pathology`]: '',
      })
    );
  });
});
