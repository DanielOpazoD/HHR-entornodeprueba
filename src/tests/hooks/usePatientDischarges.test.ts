import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import { useAuditContext } from '@/context/AuditContext';
import {
  getActiveDischarges,
  isMovementDeleted,
} from '@/application/census/movementTombstonePolicy';

// Mock dependencies
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

describe('usePatientDischarges', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: PersistDailyRecord;
  let mockPatchRecord: ApplyDailyRecordPatch;
  const mockLogEvent = vi.fn();
  const mockLogPatientDischarge = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logEvent: mockLogEvent,
      logPatientDischarge: mockLogPatientDischarge,
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
        R2: {
          bedId: 'R2',
          patientName: '',
          location: 'Room 2',
        } as PatientData,
      },
      discharges: [],
      transfers: [],
      cma: [],
    } as unknown as DailyRecord;
  });

  it('should return all discharge functions', () => {
    const { result } = renderHook(() => usePatientDischarges(mockRecord, mockSaveAndUpdate));

    expect(typeof result.current.addDischarge).toBe('function');
    expect(typeof result.current.updateDischarge).toBe('function');
    expect(typeof result.current.deleteDischarge).toBe('function');
    expect(typeof result.current.undoDischarge).toBe('function');
  });

  it('should not add discharge when record is null', () => {
    const { result } = renderHook(() => usePatientDischarges(null, mockSaveAndUpdate));

    act(() => {
      result.current.addDischarge('R1', 'Vivo');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should not add discharge for empty bed', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientDischarges(mockRecord, mockSaveAndUpdate));

    act(() => {
      result.current.addDischarge('R2', 'Vivo');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should add discharge for occupied bed', async () => {
    const { result } = renderHook(() => usePatientDischarges(mockRecord, mockSaveAndUpdate));

    act(() => {
      result.current.addDischarge('R1', 'Vivo', undefined, 'Alta Médica');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
    await waitFor(() => expect(mockLogPatientDischarge).toHaveBeenCalled());
  });

  it('adds discharge and clears the source bed through one atomic patch when available', async () => {
    const { result } = renderHook(() =>
      usePatientDischarges(mockRecord, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.addDischarge('R1', 'Vivo', undefined, 'Alta Médica');
    });

    expect(mockPatchRecord).toHaveBeenCalledTimes(1);
    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        discharges: expect.arrayContaining([
          expect.objectContaining({
            bedId: 'R1',
            patientName: 'Test Patient',
          }),
        ]),
        'beds.R1': expect.objectContaining({
          bedId: 'R1',
          patientName: '',
          rut: '',
          firstSeenDate: undefined,
          location: 'Room 1',
        }),
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockLogPatientDischarge).toHaveBeenCalled());
  });

  it('should update discharge', () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [{ id: 'discharge-1', patientName: 'Test', status: 'Vivo', time: '' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate)
    );

    act(() => {
      result.current.updateDischarge('discharge-1', 'Fallecido');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
  });

  it('updates discharge through a movement patch when available', () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [{ id: 'discharge-1', patientName: 'Test', status: 'Vivo', time: '' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.updateDischarge('discharge-1', 'Fallecido');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        discharges: [
          expect.objectContaining({
            id: 'discharge-1',
            status: 'Fallecido',
          }),
        ],
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should delete discharge', () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [{ id: 'discharge-1', patientName: 'Test' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate)
    );

    act(() => {
      result.current.deleteDischarge('discharge-1');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
  });

  it('deletes discharge through a movement patch when available', () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [{ id: 'discharge-1', patientName: 'Test' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.deleteDischarge('discharge-1');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        discharges: [
          expect.objectContaining({
            id: 'discharge-1',
            deletedAt: expect.any(String),
          }),
        ],
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
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

  it('should handle mother-only discharge', () => {
    const recordWithCrib = {
      ...mockRecord,
      beds: {
        ...mockRecord.beds,
        R1: {
          ...mockRecord.beds['R1'],
          clinicalCrib: { patientName: 'Baby', rut: '98765432-1' },
        },
      },
    } as unknown as DailyRecord;

    const { result } = renderHook(() => usePatientDischarges(recordWithCrib, mockSaveAndUpdate));

    act(() => {
      result.current.addDischarge(
        'R1',
        'Vivo',
        undefined,
        'Alta Médica',
        undefined,
        undefined,
        'mother'
      );
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
  });

  it('should undo discharge and restore patient snapshot', async () => {
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [
        {
          id: 'd-1',
          bedId: 'R2',
          bedName: 'R2',
          patientName: 'Old Patient',
          originalData: {
            bedId: 'R2',
            patientName: 'Recovered',
            rut: '22-2',
            location: 'Old Location',
          },
          isNested: false,
        },
      ],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate)
    );

    await act(async () => {
      result.current.undoDischarge('d-1');
      await Promise.resolve();
    });

    expect(mockSaveAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_MODIFIED',
      'patient',
      'R2',
      expect.objectContaining({
        clinicalEvent: 'Reversión de alta',
        movementKind: 'undo_discharge',
        dischargeId: 'd-1',
        restoredBed: 'R2',
        patientName: 'Recovered',
      }),
      '22-2',
      '2024-12-28'
    );
    const payload = vi.mocked(mockSaveAndUpdate).mock.calls[0][0];
    expect(payload.beds.R2.patientName).toBe('Recovered');
    expect(getActiveDischarges(payload.discharges)).toEqual([]);
    expect(payload.discharges[0]).toEqual(
      expect.objectContaining({
        id: 'd-1',
        deletedAt: expect.any(String),
        deletedReason: 'manual_delete',
      })
    );
    expect(isMovementDeleted(payload.discharges[0])).toBe(true);
  });

  it('should notify runtime when undo is blocked by occupied bed', () => {
    const runtime = { alert: vi.fn() };
    const recordWithDischarge = {
      ...mockRecord,
      discharges: [
        {
          id: 'd-2',
          bedId: 'R1',
          bedName: 'R1',
          patientName: 'Blocked Patient',
          originalData: { bedId: 'R1', patientName: 'Recovered', rut: '22-2' },
          isNested: false,
        },
      ],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientDischarges(recordWithDischarge, mockSaveAndUpdate, runtime)
    );

    act(() => {
      result.current.undoDischarge('d-2');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(runtime.alert).toHaveBeenCalledTimes(1);
  });

  it('should use runtime.warn on discharge creation errors', () => {
    const runtime = { alert: vi.fn(), warn: vi.fn() };

    const { result } = renderHook(() =>
      usePatientDischarges(mockRecord, mockSaveAndUpdate, runtime)
    );

    act(() => {
      result.current.addDischarge('R2', 'Vivo');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(runtime.warn).toHaveBeenCalledTimes(1);
    expect(runtime.warn).toHaveBeenCalledWith('Attempted to discharge empty bed: R2');
  });
});
