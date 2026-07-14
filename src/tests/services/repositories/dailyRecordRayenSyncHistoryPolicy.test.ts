import { describe, expect, it } from 'vitest';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

const event = (
  id: string,
  startedAt: string,
  status: RayenSyncEvent['status']
): RayenSyncEvent => ({
  id,
  startedAt,
  by: 'Operador',
  status,
});

describe('dailyRecordRayenSyncHistoryPolicy', () => {
  it('preserves concurrent events, updates matching ids and keeps the daily bound', () => {
    const current = [
      event('shared', '2026-07-14T10:00:00.000Z', 'applied'),
      event('remote', '2026-07-14T09:00:00.000Z', 'complete'),
    ];
    const incoming = [
      event('shared', '2026-07-14T10:00:00.000Z', 'complete'),
      event('local', '2026-07-14T11:00:00.000Z', 'complete'),
    ];

    const merged = mergeRayenSyncHistory(current, incoming);

    expect(merged.map(item => item.id)).toEqual(['local', 'shared', 'remote']);
    expect(merged.find(item => item.id === 'shared')?.status).toBe('complete');
    expect(merged.map(item => item.startedAt)).toEqual(
      merged
        .map(item => item.startedAt)
        .sort()
        .reverse()
    );

    const bounded = mergeRayenSyncHistory(
      [],
      Array.from({ length: 25 }, (_, index) =>
        event(`run-${index}`, `2026-07-14T11:${String(index).padStart(2, '0')}:00.000Z`, 'complete')
      )
    );
    expect(bounded).toHaveLength(20);
  });
});
