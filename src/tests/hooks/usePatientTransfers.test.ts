import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import { useAuditContext } from '@/context/AuditContext';
import {
  getActiveTransfers,
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
    rut: '',
    location: '',
  }),
}));

describe('usePatientTransfers', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: PersistDailyRecord;
  let mockPatchRecord: ApplyDailyRecordPatch;
  const mockLogEvent = vi.fn();
  const mockLogPatientTransfer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logEvent: mockLogEvent,
      logPatientTransfer: mockLogPatientTransfer,
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
      transfers: [],
      discharges: [],
      cma: [],
    } as unknown as DailyRecord;
  });

  it('should return all transfer functions', () => {
    const { result } = renderHook(() => usePatientTransfers(mockRecord, mockSaveAndUpdate));

    expect(typeof result.current.addTransfer).toBe('function');
    expect(typeof result.current.updateTransfer).toBe('function');
    expect(typeof result.current.deleteTransfer).toBe('function');
    expect(typeof result.current.undoTransfer).toBe('function');
  });

  it('should not add transfer when record is null', () => {
    const { result } = renderHook(() => usePatientTransfers(null, mockSaveAndUpdate));

    act(() => {
      result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should not add transfer for empty bed', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientTransfers(mockRecord, mockSaveAndUpdate));

    act(() => {
      result.current.addTransfer('R2', 'Ambulance', 'Hospital X', '');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should add transfer for occupied bed', async () => {
    const { result } = renderHook(() => usePatientTransfers(mockRecord, mockSaveAndUpdate));

    act(() => {
      result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
    await waitFor(() => expect(mockLogPatientTransfer).toHaveBeenCalled());
  });

  it('adds transfer and clears the source bed through one atomic patch when available', async () => {
    const { result } = renderHook(() =>
      usePatientTransfers(mockRecord, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
    });

    expect(mockPatchRecord).toHaveBeenCalledTimes(1);
    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transfers: expect.arrayContaining([
          expect.objectContaining({
            bedId: 'R1',
            patientName: 'Test Patient',
          }),
        ]),
        'beds.R1': expect.objectContaining({
          bedId: 'R1',
          patientName: '',
          rut: '',
          location: 'Room 1',
        }),
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockLogPatientTransfer).toHaveBeenCalled());
  });

  it('should update transfer', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [{ id: 'transfer-1', patientName: 'Test', time: '' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() => usePatientTransfers(recordWithTransfer, mockSaveAndUpdate));

    act(() => {
      result.current.updateTransfer('transfer-1', { time: '10:00' });
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
  });

  it('updates transfer through a movement patch when available', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [{ id: 'transfer-1', patientName: 'Test', time: '' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientTransfers(recordWithTransfer, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.updateTransfer('transfer-1', { time: '10:00' });
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transfers: [
          expect.objectContaining({
            id: 'transfer-1',
            time: '10:00',
          }),
        ],
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('persists transfer diagnosis updates and logs the clinical diagnosis change', async () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [
        {
          id: 'transfer-1',
          patientName: 'Test Patient',
          rut: '12345678-9',
          diagnosis: 'Diagnóstico previo',
          time: '',
          clinicalEpisodeId: 'episode-1',
        },
      ],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientTransfers(recordWithTransfer, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.updateTransfer('transfer-1', {
        diagnosis: 'Diagnóstico actualizado',
        time: '10:00',
      });
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transfers: [
          expect.objectContaining({
            id: 'transfer-1',
            diagnosis: 'Diagnóstico actualizado',
            time: '10:00',
          }),
        ],
      })
    );
    await waitFor(() => expect(mockLogEvent).toHaveBeenCalledTimes(1));
    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
      'transfer',
      'transfer-1',
      expect.objectContaining({
        clinicalEvent: 'Actualización de diagnóstico de egreso',
        movementLabel: 'Traslado',
        clinicalEpisodeId: 'episode-1',
        changes: {
          diagnosis: {
            old: 'Diagnóstico previo',
            new: 'Diagnóstico actualizado',
          },
        },
      }),
      '12345678-9',
      '2024-12-28'
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should delete transfer', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [{ id: 'transfer-1', patientName: 'Test' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() => usePatientTransfers(recordWithTransfer, mockSaveAndUpdate));

    act(() => {
      result.current.deleteTransfer('transfer-1');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
  });

  it('deletes transfer through a movement patch when available', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [{ id: 'transfer-1', patientName: 'Test' }],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientTransfers(recordWithTransfer, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.deleteTransfer('transfer-1');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transfers: [
          expect.objectContaining({
            id: 'transfer-1',
            deletedAt: expect.any(String),
          }),
        ],
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should undo transfer and restore patient snapshot', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [
        {
          id: 't-1',
          bedId: 'R2',
          bedName: 'R2',
          patientName: 'Transferred',
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

    const { result } = renderHook(() => usePatientTransfers(recordWithTransfer, mockSaveAndUpdate));

    act(() => {
      result.current.undoTransfer('t-1');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(mockSaveAndUpdate).mock.calls[0][0];
    expect(payload.beds.R2.patientName).toBe('Recovered');
    expect(getActiveTransfers(payload.transfers)).toEqual([]);
    expect(payload.transfers[0]).toEqual(
      expect.objectContaining({
        id: 't-1',
        deletedAt: expect.any(String),
        deletedReason: 'manual_delete',
      })
    );
    expect(isMovementDeleted(payload.transfers[0])).toBe(true);
  });

  it('undoes transfer through a movement patch when available', () => {
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [
        {
          id: 't-1',
          bedId: 'R2',
          bedName: 'R2',
          patientName: 'Transferred',
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
      usePatientTransfers(recordWithTransfer, mockSaveAndUpdate, undefined, mockPatchRecord)
    );

    act(() => {
      result.current.undoTransfer('t-1');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        transfers: [
          expect.objectContaining({
            id: 't-1',
            deletedAt: expect.any(String),
          }),
        ],
        'beds.R2': expect.objectContaining({
          patientName: 'Recovered',
          rut: '22-2',
        }),
      })
    );
    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should notify runtime when undo transfer is blocked', () => {
    const runtime = { alert: vi.fn() };
    const recordWithTransfer = {
      ...mockRecord,
      transfers: [
        {
          id: 't-2',
          bedId: 'R1',
          bedName: 'R1',
          patientName: 'Transferred',
          originalData: { bedId: 'R1', patientName: 'Recovered', rut: '22-2' },
          isNested: false,
        },
      ],
    } as unknown as DailyRecord;

    const { result } = renderHook(() =>
      usePatientTransfers(recordWithTransfer, mockSaveAndUpdate, runtime)
    );

    act(() => {
      result.current.undoTransfer('t-2');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(runtime.alert).toHaveBeenCalledTimes(1);
  });

  it('should use runtime.warn on transfer creation errors', () => {
    const runtime = { alert: vi.fn(), warn: vi.fn() };

    const { result } = renderHook(() =>
      usePatientTransfers(mockRecord, mockSaveAndUpdate, runtime)
    );

    act(() => {
      result.current.addTransfer('R2', 'Ambulance', 'Hospital X', '');
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(runtime.warn).toHaveBeenCalledTimes(1);
    expect(runtime.warn).toHaveBeenCalledWith('Attempted to transfer empty bed: R2');
  });
});
