import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import { DailyRecord, PatientData } from '@/types';
import * as auditService from '@/services/admin/auditService';

// Mock dependencies
vi.mock('@/services/admin/auditService', () => ({
  logPatientTransfer: vi.fn(),
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
  let mockSaveAndUpdate: (updatedRecord: DailyRecord) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveAndUpdate = vi.fn();
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

  it('should add transfer for occupied bed', () => {
    const { result } = renderHook(() => usePatientTransfers(mockRecord, mockSaveAndUpdate));

    act(() => {
      result.current.addTransfer('R1', 'Ambulance', 'Hospital X', '');
    });

    expect(mockSaveAndUpdate).toHaveBeenCalled();
    expect(auditService.logPatientTransfer).toHaveBeenCalled();
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
    expect(payload.transfers).toEqual([]);
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
