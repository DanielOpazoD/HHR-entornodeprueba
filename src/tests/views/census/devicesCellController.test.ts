import { describe, expect, it, vi } from 'vitest';
import {
  buildDetailsChangeResult,
  buildModalSaveResult,
  buildSelectionChangeResult,
} from '@/features/census/controllers/devicesCellController';
import { DeviceInstance } from '@/types';

describe('devicesCellController', () => {
  it('builds selection result and produces history when a device is removed', () => {
    const previousHistory: DeviceInstance[] = [
      {
        id: 'a1',
        type: 'CVC',
        installationDate: '2026-02-14',
        installationTime: '01:00',
        status: 'Active',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const result = buildSelectionChangeResult({
      previousDevices: ['CVC'],
      nextDevices: [],
      previousHistory,
      deviceDetails: {},
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'x1'),
    });

    expect(result.nextDevices).toEqual([]);
    expect(result.nextHistory).toBeDefined();
    expect(result.nextHistory?.[0].status).toBe('Removed');
  });

  it('builds details result and creates history for active device without active entry', () => {
    const result = buildDetailsChangeResult({
      activeDevices: ['CUP'],
      nextDetails: { CUP: { installationDate: '2026-02-14' } },
      previousHistory: [],
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'new-id'),
    });

    expect(result.nextDetails).toEqual({ CUP: { installationDate: '2026-02-14' } });
    expect(result.nextHistory).toBeDefined();
    expect(result.nextHistory?.[0].id).toBe('new-id');
    expect(result.nextHistory?.[0].type).toBe('CUP');
    expect(result.nextHistory?.[0].status).toBe('Active');
  });

  it('resolves active device list from modal saved history', () => {
    const history: DeviceInstance[] = [
      {
        id: 'a1',
        type: 'CVC',
        installationDate: '2026-02-14',
        status: 'Active',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a2',
        type: 'CUP',
        installationDate: '2026-02-14',
        status: 'Removed',
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    const result = buildModalSaveResult(history);
    expect(result.nextHistory).toEqual(history);
    expect(result.nextDevices).toEqual(['CVC']);
  });
});
