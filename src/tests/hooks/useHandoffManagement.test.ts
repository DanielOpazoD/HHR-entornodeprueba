import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockNotifySuccess = vi.fn();
const mockNotifyError = vi.fn();
const auditContextMocks = vi.hoisted(() => ({
  logDebouncedEvent: vi.fn(),
  logEvent: vi.fn(),
  logHandoffNovedadesModified: vi.fn(),
}));

// Mock dependencies before importing the hook
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    success: mockNotifySuccess,
    error: mockNotifyError,
  }),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logEvent: auditContextMocks.logEvent,
    logDebouncedEvent: auditContextMocks.logDebouncedEvent,
    logHandoffNovedadesModified: auditContextMocks.logHandoffNovedadesModified,
    userId: 'test-user',
  }),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn().mockReturnValue(''),
}));

import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/services/factories/patientFactory';

describe('useHandoffManagement', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>;
  let mockPatchRecord: (partial: DailyRecordPatch) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined);
    mockPatchRecord = vi.fn().mockResolvedValue(undefined);
    mockRecord = DataFactory.createMockDailyRecord('2024-12-28', {
      beds: { R1: { ...createEmptyPatient('R1'), patientName: 'Test' } },
      handoffDayChecklist: {},
      handoffNightChecklist: {},
      handoffNovedadesDayShift: '',
      handoffNovedadesNightShift: '',
    });
  });

  it('should return all management functions', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    expect(typeof result.current.updateHandoffChecklist).toBe('function');
    expect(typeof result.current.updateHandoffNovedades).toBe('function');
    expect(typeof result.current.updateHandoffStaff).toBe('function');
    expect(Object.keys(result.current).sort()).toEqual([
      'updateHandoffChecklist',
      'updateHandoffNovedades',
      'updateHandoffStaff',
    ]);
  });

  it('should not update checklist when record is null', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(null, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('day', 'checked', true);
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should update day checklist', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('day', 'checked', true);
    });

    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should update night checklist', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('night', 'checked', true);
    });

    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should update novedades for day shift', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      result.current.updateHandoffNovedades('day', 'Test novedades');
    });

    expect(mockPatchRecord).toHaveBeenCalled();
    await waitFor(() => {
      expect(auditContextMocks.logHandoffNovedadesModified).toHaveBeenCalledWith(
        'day',
        'Test novedades',
        '',
        '2024-12-28',
        ''
      );
    });
    expect(auditContextMocks.logDebouncedEvent).not.toHaveBeenCalledWith(
      'HANDOFF_NOVEDADES_MODIFIED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should update staff list', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffStaff('day', 'delivers', ['Nurse 1', 'Nurse 2']);
    });

    // Implementation now uses patchRecord instead of saveAndUpdate
    expect(mockPatchRecord).toHaveBeenCalled();
  });
});
