import { describe, expect, it } from 'vitest';
import {
  removeDeviceHistoryRecord,
  updateDeviceHistoryRecord,
} from '@/features/census/controllers/deviceHistoryModalController';
import { DeviceInstance } from '@/types';

const BASE_HISTORY: DeviceInstance[] = [
  {
    id: '1',
    type: 'CVC',
    installationDate: '2026-02-14',
    status: 'Active',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: '2',
    type: 'CUP',
    installationDate: '2026-02-14',
    status: 'Removed',
    removalDate: '2026-02-15',
    createdAt: 2,
    updatedAt: 2,
  },
];

describe('deviceHistoryModalController', () => {
  it('removes a device record by id', () => {
    const result = removeDeviceHistoryRecord(BASE_HISTORY, '1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('updates record fields and refreshes updatedAt', () => {
    const result = updateDeviceHistoryRecord({
      history: BASE_HISTORY,
      id: '2',
      updates: { location: 'Brazo derecho' },
      updatedAt: 100,
    });

    const updated = result.find(item => item.id === '2');
    expect(updated?.location).toBe('Brazo derecho');
    expect(updated?.updatedAt).toBe(100);
  });

  it('does not mutate non-target records', () => {
    const result = updateDeviceHistoryRecord({
      history: BASE_HISTORY,
      id: '2',
      updates: { location: 'Brazo derecho' },
      updatedAt: 100,
    });

    expect(result.find(item => item.id === '1')).toEqual(BASE_HISTORY[0]);
  });
});
