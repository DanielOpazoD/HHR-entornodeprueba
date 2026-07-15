import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { useAuditContext } from '@/context/AuditContext';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import type { PatientData } from '@/types/domain/patient';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: vi.fn(),
}));

vi.mock('@/services/factories/patientFactory', () => ({
  createEmptyPatient: (bedId: string) => ({
    bedId,
    patientName: '',
    firstSeenDate: undefined,
    rut: '',
    location: '',
  }),
}));

describe('usePatientDischarges reclassification', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: PersistDailyRecord;
  let mockPatchRecord: ApplyDailyRecordPatch;
  const mockLogEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logEvent: mockLogEvent,
      logPatientDischarge: vi.fn(),
      userId: 'auditor@hospital.cl',
    } as unknown as ReturnType<typeof useAuditContext>);
    mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
    mockPatchRecord = vi.fn().mockResolvedValue(undefined) as ApplyDailyRecordPatch;
    mockRecord = {
      date: '2024-12-28',
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'Test Patient',
          rut: '12345678-9',
          pathology: 'Test Diagnosis',
          age: '30',
          location: 'Room 1',
        } as PatientData,
      },
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
  });

  it('converts a home discharge into CMA in one movement patch', async () => {
    const originalData = {
      bedId: 'R1',
      patientName: 'Test Patient',
      rut: '12345678-9',
      birthDate: '1980-01-01',
      biologicalSex: 'Femenino',
      clinicalEpisodeId: 'episode-discharge',
    } as PatientData;
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [
        {
          id: 'discharge-1',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Test Patient',
          rut: '12345678-9',
          diagnosis: 'Test Diagnosis',
          age: '44',
          time: '10:20',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          clinicalEpisodeId: 'episode-discharge',
          originalData,
        },
      ],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.convertDischargeToCma('discharge-1');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        discharges: [
          expect.objectContaining({
            id: 'discharge-1',
            deletedAt: expect.any(String),
            deletedReason: 'converted_to_cma',
          }),
        ],
        cma: [
          expect.objectContaining({
            id: 'reclassified:discharge-1:cma',
            patientName: 'Test Patient',
            rut: '12345678-9',
            age: '44',
            birthDate: '1980-01-01',
            biologicalSex: 'Femenino',
            originalBedId: 'R1',
            dischargeTime: '10:20',
            interventionType: 'Cirugía Mayor Ambulatoria',
            clinicalEpisodeId: 'episode-discharge',
            movementProvenance: expect.objectContaining({
              source: 'reclassified',
              previousMovementId: 'discharge-1',
              previousClassification: 'discharge',
              classifiedBy: 'auditor@hospital.cl',
            }),
          }),
        ],
      })
    );
    await waitFor(() =>
      expect(mockLogEvent).toHaveBeenCalledWith(
        'PATIENT_DISCHARGE_RECLASSIFIED',
        'patient',
        'reclassified:discharge-1:cma',
        expect.objectContaining({
          from: 'Alta domicilio',
          to: 'CMA',
          lineageId: 'discharge-1',
        }),
        '12345678-9',
        '2024-12-28'
      )
    );
  });

  it('does not persist or audit competing reclassifications of the same discharge twice', async () => {
    let resolvePersistence: (() => void) | undefined;
    mockPatchRecord = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolvePersistence = resolve;
        })
    ) as ApplyDailyRecordPatch;
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [
        {
          id: 'discharge-concurrent',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Test Patient',
          rut: '12345678-9',
          diagnosis: 'Test Diagnosis',
          time: '10:20',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          originalData: mockRecord.beds.R1,
        },
      ],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.convertDischargeToCma('discharge-concurrent');
      result.current.convertDischargeToTransfer('discharge-concurrent');
    });
    expect(mockPatchRecord).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePersistence?.();
      await Promise.resolve();
    });
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_DISCHARGE_RECLASSIFIED',
      'patient',
      'reclassified:discharge-concurrent:cma',
      expect.any(Object),
      '12345678-9',
      '2024-12-28'
    );
  });

  it('converts a home discharge into transfer in one movement patch', () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [
        {
          id: 'discharge-transfer',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Test Patient',
          rut: '12345678-9',
          diagnosis: 'Test Diagnosis',
          time: '10:20',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          clinicalEpisodeId: 'episode-transfer',
        },
      ],
      transfers: [],
    } as unknown as DailyRecord;
    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => result.current.convertDischargeToTransfer('discharge-transfer'));

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        discharges: [
          expect.objectContaining({
            id: 'discharge-transfer',
            deletedReason: 'converted_to_transfer',
          }),
        ],
        transfers: [
          expect.objectContaining({
            patientName: 'Test Patient',
            evacuationMethod: '',
            receivingCenter: '',
            clinicalEpisodeId: 'episode-transfer',
          }),
        ],
      })
    );
  });
});
