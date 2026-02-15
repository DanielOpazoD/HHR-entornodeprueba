import { describe, expect, it } from 'vitest';
import type { DeviceDetails, DeviceInstance } from '@/types';
import {
  buildDeviceHistoryTimestamp,
  buildInitialDeviceHistory,
  resolveActiveDeviceTypesFromHistory,
  syncDeviceHistoryForDetails,
  syncDeviceHistoryForSelection,
} from '@/features/census/controllers/deviceHistoryController';

const createId = (() => {
  let n = 0;
  return () => `id-${++n}`;
})();

describe('deviceHistoryController', () => {
  it('builds deterministic timestamp shape from Date', () => {
    const timestamp = buildDeviceHistoryTimestamp({
      now: new Date('2026-02-15T04:05:00.000Z'),
    });

    expect(timestamp.date).toBe('2026-02-15');
    expect(typeof timestamp.time).toBe('string');
    expect(timestamp.nowMs).toBe(new Date('2026-02-15T04:05:00.000Z').getTime());
  });

  it('backfills active history from current devices and keeps active first', () => {
    const history: DeviceInstance[] = [
      {
        id: 'x',
        type: 'CVC',
        status: 'Removed',
        installationDate: '2026-02-10',
        removalDate: '2026-02-12',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const deviceDetails: DeviceDetails = {
      'VVP#1': { installationDate: '2026-02-11' },
    };

    const result = buildInitialDeviceHistory({
      history,
      currentDevices: ['VVP#1'],
      deviceDetails,
      timestamp: { date: '2026-02-15', time: '10:00', nowMs: 10 },
      createId,
    });

    expect(result[0].type).toBe('VVP#1');
    expect(result[0].status).toBe('Active');
    expect(result[0].installationDate).toBe('2026-02-11');
  });

  it('syncs history when selection removes and adds devices', () => {
    const previousHistory: DeviceInstance[] = [
      {
        id: 'h1',
        type: 'CVC',
        status: 'Active',
        installationDate: '2026-02-10',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const sync = syncDeviceHistoryForSelection({
      previousDevices: ['CVC'],
      nextDevices: ['VVP#1'],
      previousHistory,
      deviceDetails: {},
      timestamp: { date: '2026-02-15', time: '10:00', nowMs: 100 },
      createId,
    });

    expect(sync.changed).toBe(true);
    expect(sync.history.some(item => item.type === 'CVC' && item.status === 'Removed')).toBe(true);
    expect(sync.history.some(item => item.type === 'VVP#1' && item.status === 'Active')).toBe(true);
  });

  it('syncs installation date changes and missing active entries from details', () => {
    const previousHistory: DeviceInstance[] = [
      {
        id: 'h1',
        type: 'CVC',
        status: 'Active',
        installationDate: '2026-02-10',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const sync = syncDeviceHistoryForDetails({
      nextDetails: {
        CVC: { installationDate: '2026-02-12' },
        SNG: { installationDate: '2026-02-13' },
      },
      activeDevices: ['CVC', 'SNG'],
      previousHistory,
      timestamp: { date: '2026-02-15', time: '10:00', nowMs: 200 },
      createId,
    });

    expect(sync.changed).toBe(true);
    expect(sync.history.find(item => item.type === 'CVC')?.installationDate).toBe('2026-02-12');
    expect(sync.history.some(item => item.type === 'SNG' && item.status === 'Active')).toBe(true);
  });

  it('resolves unique active device types from history', () => {
    const types = resolveActiveDeviceTypesFromHistory([
      {
        id: '1',
        type: 'CVC',
        status: 'Active',
        installationDate: '2026-02-10',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: '2',
        type: 'CVC',
        status: 'Removed',
        installationDate: '2026-02-09',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: '3',
        type: 'VVP#1',
        status: 'Active',
        installationDate: '2026-02-11',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(types).toEqual(['CVC', 'VVP#1']);
  });
});
