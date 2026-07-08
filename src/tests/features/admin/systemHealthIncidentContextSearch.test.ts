import { describe, expect, it } from 'vitest';
import {
  buildSystemHealthIncidentRows,
  filterSystemHealthStatsForTriage,
  resolveSystemHealthIncidentRow,
} from '@/features/admin/components/systemHealthIncidentUtils';
import { baseStatus } from './systemHealthIncidentTestFixtures';

describe('systemHealthIncidentContextSearch', () => {
  it('filters users by incident module, bed and field context', () => {
    const stats = [
      baseStatus({
        uid: 'clinical-context',
        email: 'clinical@example.com',
        displayName: 'Clinical Context',
        lastSeen: '2026-05-21T14:10:00.000Z',
        recentEvents: [
          {
            id: 'clinical-event',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:03:00.000Z',
            message: 'Conflicto diferido',
            module: 'Censo diario',
            operation: 'partial_update_retry',
            action: 'Reintentar sincronizacion',
            route: 'daily:2026-05-21',
            contextSummary: [
              'fecha clinica: 2026-05-21',
              'cama: Cama R1',
              'campo: Diagnostico',
              'tipo: UPDATE_DAILY_RECORD',
            ],
          },
        ],
      }),
      baseStatus({
        uid: 'other',
        email: 'other@example.com',
        displayName: 'Other User',
        lastSeen: '2026-05-21T14:10:00.000Z',
        recentEvents: [
          {
            id: 'other-event',
            source: 'operational',
            category: 'indexeddb',
            severity: 'warning',
            status: 'open',
            timestamp: '2026-05-21T14:03:00.000Z',
            message: 'IndexedDB degradado',
          },
        ],
      }),
    ];

    const filtered = filterSystemHealthStatsForTriage(stats, {
      searchTerm: 'diagnostico',
      dateRange: 'last24h',
      selectedDate: '2026-05-21',
      severity: 'all',
      eventType: 'all',
      nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
    });

    expect(filtered.map(user => user.uid)).toEqual(['clinical-context']);
  });

  it('does not hide a newer incident behind an older resolution window', () => {
    const [row] = buildSystemHealthIncidentRows(
      baseStatus({
        recentEvents: [
          {
            id: 'same-operational-key',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:20:00.000Z',
            message: 'Sync volvio a fallar',
          },
        ],
      })
    );

    const resolved = resolveSystemHealthIncidentRow(row, {
      resolutionKey: row.resolutionKey,
      status: 'resolved',
      updatedAt: '2026-05-21T14:10:00.000Z',
      resolvedAt: '2026-05-21T14:10:00.000Z',
      history: [],
    });

    expect(resolved.status).toBe('open');
    expect(resolved.statusLabel).toBe('Abierto');
  });

  it('keeps a same-window incident resolved after a current resolution', () => {
    const [row] = buildSystemHealthIncidentRows(
      baseStatus({
        recentEvents: [
          {
            id: 'same-operational-key',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:00:00.000Z',
            message: 'Sync ya cerrado',
          },
        ],
      })
    );

    const resolved = resolveSystemHealthIncidentRow(row, {
      resolutionKey: row.resolutionKey,
      status: 'resolved',
      updatedAt: '2026-05-21T14:10:00.000Z',
      resolvedAt: '2026-05-21T14:10:00.000Z',
      history: [],
    });

    expect(resolved.status).toBe('resolved');
    expect(resolved.statusLabel).toBe('Resuelto');
  });
});
