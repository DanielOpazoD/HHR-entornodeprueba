import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagement } from '@/hooks/useBedManagement';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
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
    processFieldValue: (_field: string, value: unknown) => ({ valid: true, value }),
  }),
}));

describe('Manual identity edits preserve clinical data', () => {
  let mockRecord: DailyRecord;
  let patchRecord: ApplyDailyRecordPatch;

  beforeEach(() => {
    mockRecord = DataFactory.createMockDailyRecord('2026-01-18', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Patient A',
          rut: '11.111.111-1',
          documentType: 'RUT',
          clinicalEpisodeId: 'ep_synthetic_1',
          age: '30',
          pathology: 'Old Pathology',
          cie10Code: 'A00',
          cie10Description: 'Old Diagnosis',
          specialty: Specialty.MEDICINA,
          status: PatientStatus.ESTABLE,
          admissionDate: '2026-01-10',
          devices: ['VVP'],
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
  });

  it('keeps diagnosis, specialty, devices and clinicalEpisodeId when correcting RUT or switching to Pasaporte', async () => {
    const { result } = renderHook(() => useBedManagement(mockRecord, patchRecord));

    await act(async () => {
      result.current.updatePatientMultiple('R1', {
        documentType: 'Pasaporte',
        rut: 'P22222222',
      });
    });

    expect(patchRecord).toHaveBeenCalledTimes(1);
    expect(patchRecord).toHaveBeenCalledWith({
      'beds.R1.documentType': 'Pasaporte',
      'beds.R1.rut': 'P22222222',
      'beds.R1.documentManualOverride': true,
    });
    const [writtenPatch] = vi.mocked(patchRecord).mock.calls[0];
    expect(writtenPatch).not.toHaveProperty('beds.R1.pathology');
    expect(writtenPatch).not.toHaveProperty('beds.R1.cie10Code');
    expect(writtenPatch).not.toHaveProperty('beds.R1.cie10Description');
    expect(writtenPatch).not.toHaveProperty('beds.R1.specialty');
    expect(writtenPatch).not.toHaveProperty('beds.R1.devices');
    expect(writtenPatch).not.toHaveProperty('beds.R1.clinicalEpisodeId');
    expect(writtenPatch).not.toHaveProperty('bedTypeOverrides.R1');
  });

  it('cambiar solo el nombre con el MISMO RUT no limpia el diagnóstico (misma persona)', async () => {
    const { result } = renderHook(() => useBedManagement(mockRecord, patchRecord));

    await act(async () => {
      result.current.updatePatient('R1', 'patientName', 'Different Patient');
    });

    expect(patchRecord).toHaveBeenCalledTimes(1);
    expect(patchRecord).toHaveBeenCalledWith({
      'beds.R1.patientName': 'Different Patient',
    });
    for (const call of vi.mocked(patchRecord).mock.calls) {
      expect(call[0]).not.toHaveProperty(`beds.R1.pathology`);
      expect(call[0]).not.toHaveProperty(`beds.R1.clinicalEvents`);
      expect(call[0]).not.toHaveProperty(`bedTypeOverrides.R1`);
    }
  });
});
