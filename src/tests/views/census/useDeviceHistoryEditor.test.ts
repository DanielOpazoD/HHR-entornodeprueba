import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDeviceHistoryEditor } from '@/features/census/components/patient-row/useDeviceHistoryEditor';

describe('useDeviceHistoryEditor', () => {
  it('initializes from current devices and supports update/delete flows', () => {
    const { result } = renderHook(() =>
      useDeviceHistoryEditor({
        history: [],
        currentDevices: ['CVC'],
        deviceDetails: { CVC: { installationDate: '2026-02-14' } },
        now: new Date('2026-02-15T06:00:00'),
        createId: vi.fn(() => 'mock-id'),
      })
    );

    expect(result.current.localHistory).toHaveLength(1);
    expect(result.current.localHistory[0].id).toBe('mock-id');

    act(() => {
      result.current.updateRecord('mock-id', { location: 'Brazo derecho' });
    });
    expect(result.current.localHistory[0].location).toBe('Brazo derecho');

    act(() => {
      result.current.deleteRecord('mock-id');
    });
    expect(result.current.localHistory).toHaveLength(0);
  });
});
