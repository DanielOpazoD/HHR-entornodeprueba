import { describe, expect, it } from 'vitest';
import {
  buildSystemHealthTriageModel,
  buildSystemHealthIncidentTimeline,
  buildSystemHealthIncidentRows,
  exportSystemHealthIncidentsCsv,
  filterSystemHealthStatsForTriage,
  resolveSystemHealthIncidentRow,
  shiftSystemHealthSelectedDate,
} from '@/features/admin/components/systemHealthIncidentUtils';
import { baseStatus } from './systemHealthIncidentTestFixtures';

describe('systemHealthIncidentUtils', () => {
  it('builds actionable incident rows from recent events and conflict counters', () => {
    const rows = buildSystemHealthIncidentRows(
      baseStatus({
        conflictSyncTasks: 2,
        recentEvents: [
          {
            id: 'event-1',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:03:00.000Z',
            message: 'Escritura remota bloqueada',
            operation: 'daily_record_remote_write',
            module: 'Censo diario',
            action: 'Guardar dia',
            route: '/censo',
            runtimeState: 'blocked',
            issues: ['permission-denied'],
          },
        ],
      })
    );

    expect(rows[0]).toMatchObject({
      id: 'event-1',
      resolutionKey: 'u1:event-1',
      title: 'Escritura remota bloqueada',
      sourceLabel: 'Operacional',
      categoryLabel: 'Sync',
      statusLabel: 'Abierto',
      originLabel: 'Censo diario / daily_record_remote_write',
      actionLabel: 'Guardar dia',
      routeLabel: '/censo',
      userLabel: 'User Example',
    });
    expect(rows[1]).toMatchObject({
      id: 'u1:sync-conflicts',
      title: '2 conflicto(s) de sincronizacion pendientes',
      sourceLabel: 'Conflicto',
      statusLabel: 'Abierto',
      originLabel: 'Sincronizacion local / outbox',
      actionLabel: 'Resolver conflicto pendiente',
      routeLabel: 'Modulo donde se genero la cola local',
    });
  });

  it('filters users by date range, severity and event type', () => {
    const stats = [
      baseStatus({
        uid: 'recent',
        email: 'recent@example.com',
        displayName: 'Recent User',
        lastSeen: '2026-05-21T14:10:00.000Z',
        failedSyncTasks: 1,
        recentEvents: [
          {
            id: 'recent-event',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:03:00.000Z',
            message: 'Sync fallido',
          },
        ],
      }),
      baseStatus({
        uid: 'old',
        email: 'old@example.com',
        displayName: 'Old User',
        lastSeen: '2026-05-18T10:00:00.000Z',
        localErrorCount: 1,
        recentEvents: [
          {
            id: 'old-event',
            source: 'local_error',
            category: 'local_error',
            severity: 'warning',
            status: 'open',
            timestamp: '2026-05-18T10:00:00.000Z',
            message: 'Error antiguo',
          },
        ],
      }),
    ];

    const filtered = filterSystemHealthStatsForTriage(stats, {
      searchTerm: 'recent',
      dateRange: 'day',
      selectedDate: '2026-05-21',
      severity: 'critical',
      eventType: 'sync',
      nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].uid).toBe('recent');
  });

  it('builds a triage model with prioritized incident queue, grouped causes and stable selected user', () => {
    const stats = [
      baseStatus({
        uid: 'warning',
        email: 'warning@example.com',
        displayName: 'Warning User',
        lastSeen: '2026-05-21T14:30:00.000Z',
        recentEvents: [
          {
            id: 'warning-event',
            source: 'operational',
            category: 'indexeddb',
            severity: 'warning',
            status: 'recovered',
            timestamp: '2026-05-21T14:30:00.000Z',
            message: 'IndexedDB recuperado',
          },
        ],
      }),
      baseStatus({
        uid: 'critical',
        email: 'critical@example.com',
        displayName: 'Critical User',
        lastSeen: '2026-05-21T14:00:00.000Z',
        recentEvents: [
          {
            id: 'critical-event',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:00:00.000Z',
            message: 'Sync bloqueado',
          },
        ],
      }),
    ];

    const model = buildSystemHealthTriageModel(stats, {
      selectedUid: 'missing',
      filters: {
        searchTerm: '',
        dateRange: 'last24h',
        severity: 'all',
        eventType: 'all',
        nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
      },
    });

    expect(model.selectedUser?.uid).toBe('warning');
    expect(model.incidentQueue.map(row => row.id)).toEqual(['critical-event', 'warning-event']);
    expect(model.incidentGroups).toEqual([
      expect.objectContaining({
        categoryLabel: 'Sync',
        occurrenceCount: 1,
        affectedUsers: 1,
        statusLabel: 'Abierto',
      }),
      expect.objectContaining({
        categoryLabel: 'IndexedDB',
        occurrenceCount: 1,
        affectedUsers: 1,
        statusLabel: 'Recuperado',
      }),
    ]);
    expect(model.totals).toMatchObject({
      totalIncidents: 2,
      criticalIncidents: 1,
      warningIncidents: 1,
      affectedUsers: 2,
      openIncidents: 1,
      recoveredIncidents: 1,
    });
  });

  it('moves the selected date without leaking locale formatting into the filter value', () => {
    expect(shiftSystemHealthSelectedDate('2026-05-21', -1)).toBe('2026-05-20');
    expect(shiftSystemHealthSelectedDate('2026-05-21', 1)).toBe('2026-05-22');
  });

  it('applies local resolution overlays to incident rows and triage totals', () => {
    const stats = [
      baseStatus({
        uid: 'critical',
        email: 'critical@example.com',
        displayName: 'Critical User',
        lastSeen: '2026-05-21T14:00:00.000Z',
        recentEvents: [
          {
            id: 'critical-event',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:00:00.000Z',
            message: 'Sync bloqueado',
          },
        ],
      }),
    ];

    const model = buildSystemHealthTriageModel(stats, {
      selectedUid: 'critical',
      resolutionState: {
        'critical:critical-event': {
          resolutionKey: 'critical:critical-event',
          status: 'resolved',
          updatedAt: '2026-05-21T14:10:00.000Z',
          resolvedAt: '2026-05-21T14:10:00.000Z',
          history: [],
        },
      },
      filters: {
        searchTerm: '',
        dateRange: 'last24h',
        severity: 'all',
        eventType: 'all',
        nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
      },
    });

    expect(model.selectedIncidents[0]).toMatchObject({
      id: 'critical-event',
      status: 'resolved',
      statusLabel: 'Resuelto',
      resolvedAt: '2026-05-21T14:10:00.000Z',
    });
    expect(model.totals.openIncidents).toBe(0);
    expect(model.totals.resolvedIncidents).toBe(1);
    expect(model.incidentQueue.map(row => row.status)).toEqual(['resolved']);
  });

  it('builds a resolved incident row without mutating the original object', () => {
    const [row] = buildSystemHealthIncidentRows(
      baseStatus({
        localErrorCount: 10,
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
    expect(row.statusLabel).not.toBe('Resuelto');
  });

  it('keeps locally resolved incidents below active incidents in the queue', () => {
    const model = buildSystemHealthTriageModel(
      [
        baseStatus({
          uid: 'resolved',
          email: 'resolved@example.com',
          displayName: 'Resolved User',
          recentEvents: [
            {
              id: 'resolved-critical',
              source: 'operational',
              category: 'sync',
              severity: 'critical',
              status: 'open',
              timestamp: '2026-05-21T14:20:00.000Z',
              message: 'Incidente ya resuelto',
            },
          ],
        }),
        baseStatus({
          uid: 'open',
          email: 'open@example.com',
          displayName: 'Open User',
          recentEvents: [
            {
              id: 'open-warning',
              source: 'operational',
              category: 'indexeddb',
              severity: 'warning',
              status: 'open',
              timestamp: '2026-05-21T14:00:00.000Z',
              message: 'Incidente abierto',
            },
          ],
        }),
      ],
      {
        selectedUid: null,
        resolutionState: {
          'resolved:resolved-critical': {
            resolutionKey: 'resolved:resolved-critical',
            status: 'resolved',
            updatedAt: '2026-05-21T14:30:00.000Z',
            resolvedAt: '2026-05-21T14:30:00.000Z',
            history: [],
          },
        },
        filters: {
          searchTerm: '',
          dateRange: 'last24h',
          severity: 'all',
          eventType: 'all',
          nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
        },
      }
    );

    expect(model.incidentQueue.map(row => row.id)).toEqual(['open-warning', 'resolved-critical']);
  });

  it('groups repeated incidents by cause across users and keeps recurrence metadata', () => {
    const model = buildSystemHealthTriageModel(
      [
        baseStatus({
          uid: 'u1',
          email: 'u1@example.com',
          displayName: 'User One',
          recentEvents: [
            {
              id: 'event-1',
              source: 'operational',
              category: 'sync',
              severity: 'critical',
              status: 'open',
              timestamp: '2026-05-21T14:00:00.000Z',
              message: 'Permiso Firestore bloqueado',
              module: 'Censo diario',
              operation: 'daily_record_remote_write',
              action: 'Guardar dia',
              route: '/censo',
            },
          ],
        }),
        baseStatus({
          uid: 'u2',
          email: 'u2@example.com',
          displayName: 'User Two',
          recentEvents: [
            {
              id: 'event-2',
              source: 'operational',
              category: 'sync',
              severity: 'critical',
              status: 'open',
              timestamp: '2026-05-21T14:20:00.000Z',
              message: 'Permiso Firestore bloqueado',
              module: 'Censo diario',
              operation: 'daily_record_remote_write',
              action: 'Guardar dia',
              route: '/censo',
            },
          ],
        }),
      ],
      {
        selectedUid: null,
        filters: {
          searchTerm: '',
          dateRange: 'last24h',
          severity: 'all',
          eventType: 'all',
          nowMs: Date.parse('2026-05-21T15:00:00.000Z'),
        },
      }
    );

    expect(model.incidentGroups).toHaveLength(1);
    expect(model.incidentGroups[0]).toMatchObject({
      title: 'Permiso Firestore bloqueado',
      categoryLabel: 'Sync',
      originLabel: 'Censo diario / daily_record_remote_write',
      occurrenceCount: 2,
      affectedUsers: 2,
      firstSeenAt: '2026-05-21T14:00:00.000Z',
      lastSeenAt: '2026-05-21T14:20:00.000Z',
      statusLabel: 'Recurrente',
    });
  });

  it('builds a daily timeline with first, last and duration metadata', () => {
    const timeline = buildSystemHealthIncidentTimeline([
      {
        ...buildSystemHealthIncidentRows(
          baseStatus({
            uid: 'u1',
            displayName: 'User One',
            recentEvents: [
              {
                id: 'event-1',
                source: 'operational',
                category: 'sync',
                severity: 'warning',
                status: 'open',
                timestamp: '2026-05-20T10:00:00.000Z',
                message: 'Primer evento',
              },
            ],
          })
        )[0],
        timestamp: '2026-05-20T10:00:00.000Z',
        severity: 'warning',
      },
      {
        ...buildSystemHealthIncidentRows(
          baseStatus({
            uid: 'u2',
            displayName: 'User Two',
            recentEvents: [
              {
                id: 'event-2',
                source: 'operational',
                category: 'sync',
                severity: 'critical',
                status: 'open',
                timestamp: '2026-05-20T13:30:00.000Z',
                message: 'Segundo evento',
              },
            ],
          })
        )[0],
        timestamp: '2026-05-20T13:30:00.000Z',
        severity: 'critical',
      },
    ]);

    expect(timeline).toEqual([
      expect.objectContaining({
        date: '2026-05-20',
        totalIncidents: 2,
        criticalIncidents: 1,
        affectedUsers: 2,
        firstSeenAt: '2026-05-20T10:00:00.000Z',
        lastSeenAt: '2026-05-20T13:30:00.000Z',
        durationMinutes: 210,
      }),
    ]);
  });

  it('exports visible incidents to csv with actionable columns', () => {
    const [row] = buildSystemHealthIncidentRows(
      baseStatus({
        recentEvents: [
          {
            id: 'event-1',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:00:00.000Z',
            message: 'Sync bloqueado',
            module: 'Censo diario',
            operation: 'daily_record_remote_write',
            action: 'Guardar dia',
            route: '/censo',
          },
        ],
      })
    );

    expect(exportSystemHealthIncidentsCsv([row])).toBe(
      [
        'fecha_hora,usuario,email,severidad,estado,tipo,origen,accion,ruta,titulo,detalles',
        '"2026-05-21T14:00:00.000Z","User Example","user@example.com","critical","Abierto","Sync","Censo diario / daily_record_remote_write","Guardar dia","/censo","Sync bloqueado",""',
      ].join('\n')
    );
  });
});
