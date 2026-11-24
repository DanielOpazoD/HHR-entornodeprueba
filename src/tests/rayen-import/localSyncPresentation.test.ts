import { describe, expect, it } from 'vitest';
import {
  hasLocalSyncAttention,
  listQuarantinedOperations,
  LOCAL_SYNC_PENDING_VISIBILITY_MS,
  type QuarantinedOperationView,
} from '@/features/rayen-import/components/localSyncPresentation';
import type {
  SyncQueueOperation,
  SyncQueueStats,
} from '@/features/rayen-import/hooks/useSyncQueueMonitor';

const makeStats = (overrides: Partial<SyncQueueStats> = {}): SyncQueueStats => ({
  pending: 0,
  failed: 0,
  retrying: 0,
  acked: 0,
  conflict: 0,
  oldestPendingAgeMs: 0,
  ...overrides,
});

describe('localSyncPresentation', () => {
  it('keeps normal saves quiet, including the visibility grace period', () => {
    expect(hasLocalSyncAttention(makeStats())).toBe(false);
    expect(
      hasLocalSyncAttention(
        makeStats({ pending: 1, oldestPendingAgeMs: LOCAL_SYNC_PENDING_VISIBILITY_MS - 1 })
      )
    ).toBe(false);
  });

  it('shows aged pending writes without requiring a failure', () => {
    expect(
      hasLocalSyncAttention(
        makeStats({ pending: 2, oldestPendingAgeMs: LOCAL_SYNC_PENDING_VISIBILITY_MS })
      )
    ).toBe(true);
    expect(hasLocalSyncAttention(makeStats({ pending: 1, oldestPendingAgeMs: 300_000 }))).toBe(
      true
    );
    expect(hasLocalSyncAttention(makeStats({ oldestPendingAgeMs: 300_000 }))).toBe(false);
  });

  it.each([
    { failed: 1 },
    { conflict: 1 },
    { retrying: 1 },
    { readState: 'unavailable' as const },
    { recentOperationsReadState: 'unavailable' as const },
  ])('shows interrupted saves immediately: %j', stats =>
    expect(hasLocalSyncAttention(makeStats(stats))).toBe(true)
  );

  it('presenta las operaciones en cuarentena con la taxonomía en castellano', () => {
    const operations: SyncQueueOperation[] = [
      {
        id: 7,
        type: 'UPDATE_DAILY_RECORD',
        status: 'FAILED',
        retryCount: 5,
        timestamp: 1,
        key: 'daily:2026-09-01',
        lastErrorCategory: 'authorization',
        lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
      },
      {
        id: 8,
        type: 'UPDATE_DAILY_RECORD',
        status: 'CONFLICT',
        retryCount: 0,
        timestamp: 2,
        key: 'daily:2026-09-02',
        lastErrorCategory: 'conflict',
      },
      // Activas o sin id: fuera de la lista de cuarentena.
      { id: 9, type: 'UPDATE_DAILY_RECORD', status: 'PENDING', retryCount: 0, timestamp: 3 },
      { type: 'UPDATE_DAILY_RECORD', status: 'FAILED', retryCount: 0, timestamp: 4 },
    ];

    expect(listQuarantinedOperations(operations)).toEqual([
      {
        id: 7,
        targetLabel: 'Censo del 01-09-2026',
        categoryLabel: 'Sin permisos',
        recovery: 'review_authorization',
        retryGuidance:
          'El servidor rechazó este envío por permisos. Revisa el acceso de tu cuenta antes de reenviarlo.',
        canRetire: true,
      },
      {
        id: 8,
        targetLabel: 'Censo del 02-09-2026',
        categoryLabel: 'El censo cambió antes del envío',
        recovery: 'retry',
        canRetire: true,
      },
    ]);
  });
});

it('distinguishes a preserved logout send from a server permission refusal', () => {
  const operations = listQuarantinedOperations([
    {
      id: 24,
      type: 'UPDATE_DAILY_RECORD',
      key: 'daily:2026-10-22',
      status: 'FAILED',
      retryCount: 0,
      timestamp: 1,
      lastErrorCategory: 'authorization',
      lastErrorCode: 'session_owner_logged_out',
    },
  ]);
  expect(operations).toEqual([
    expect.objectContaining({
      categoryLabel: 'Sesión cerrada',
      recovery: 'review_authorization',
      canRetire: true,
      retryGuidance:
        'Este envío quedó pendiente al cerrar sesión. Revisa que ingresaste con su cuenta original antes de reenviarlo.',
    }),
  ]);
});

describe('a census send refused after its editing window closed', () => {
  // Midnight of 01-11-2026 in Rapa Nui is 05:00 UTC; the nurse window closes 48 h later.
  const closesAt = Date.parse('2026-11-03T05:00:00Z');
  const refused = (overrides: Partial<SyncQueueOperation> = {}): SyncQueueOperation => ({
    id: 30,
    type: 'UPDATE_DAILY_RECORD',
    status: 'FAILED',
    retryCount: 0,
    timestamp: 1,
    key: 'daily:2026-11-01',
    lastErrorCategory: 'authorization',
    lastErrorCode: 'permission-denied',
    ...overrides,
  });
  const view = (operation: SyncQueueOperation, now: number, isAdmin = false) =>
    listQuarantinedOperations([operation], { now, isAdmin })[0];

  it.each(['permission-denied', 'functions/permission-denied'])(
    'names the closed window, not the account, for %s (rules and authority paths)',
    code => {
      expect(view(refused({ lastErrorCode: code }), closesAt + 60_000)).toEqual({
        id: 30,
        code,
        detail: undefined,
        targetLabel: 'Censo del 01-11-2026',
        categoryLabel: 'Plazo de edición cerrado',
        recovery: 'editing_window_closed',
        guidance:
          'El plazo de 48 h para editar este día cerró antes de que el cambio llegara al servidor. Quedó solo en este equipo y no se enviará; si hace falta ingresarlo, solicítalo a un administrador y descarta este envío.',
        canRetire: true,
      });
    }
  );

  it.each([
    ['a future day whose window has not opened', 'daily:2026-11-20'],
    ['a day that does not exist', 'daily:2026-02-30'],
    ['an unreadable day', 'daily:invalid'],
    ['no day at all', undefined],
  ])('keeps «Sin permisos» and its retry for %s: no closure is proven', (_label, key) => {
    expect(view(refused({ key }), Date.parse('2026-11-17T15:00:00Z'))).toMatchObject({
      categoryLabel: 'Sin permisos',
      recovery: 'review_authorization',
    });
  });

  it('keeps «Sin permisos» while the window is open and for the administrator', () => {
    expect(view(refused(), closesAt - 60_000)).toMatchObject({
      categoryLabel: 'Sin permisos',
      recovery: 'review_authorization',
    });
    expect(view(refused(), closesAt + 60_000, true)).toMatchObject({
      categoryLabel: 'Sin permisos',
      recovery: 'review_authorization',
    });
  });

  it.each<[string, Partial<SyncQueueOperation>, Partial<QuarantinedOperationView>]>([
    [
      'a conflict',
      {
        status: 'CONFLICT',
        lastErrorCategory: 'conflict',
        lastErrorCode: 'aborted',
      },
      { categoryLabel: 'El censo cambió antes del envío', recovery: 'retry' },
    ],
    [
      'a closed session',
      { lastErrorCode: 'session_owner_logged_out' },
      { categoryLabel: 'Sesión cerrada', recovery: 'review_authorization' },
    ],
    [
      'an unvalidated session',
      { lastErrorCode: 'functions/unauthenticated' },
      { categoryLabel: 'Sesión no validada', recovery: 'review_authorization' },
    ],
    [
      'a refused field outside the census day',
      { key: 'daily:2026-11-01:detached:30:[]' },
      { categoryLabel: 'Sin permisos', recovery: 'review_authorization', canRetire: false },
    ],
    [
      'a refused patient update',
      { type: 'UPDATE_PATIENT', key: 'patient:synthetic' },
      { categoryLabel: 'Sin permisos', recovery: 'review_authorization' },
    ],
  ])('leaves %s as it was, even after the window closed', (_label, overrides, expected) => {
    const operation = refused(overrides);
    expect(view(operation, closesAt + 60_000)).toEqual(view(operation, closesAt - 60_000));
    expect(view(operation, closesAt + 60_000)).toMatchObject(expected);
  });

  // W14-H1B: the queue releases the day of this refusal, so its copy left the stored day for the
  // closed window, and that stays its reason, also after a later logout. Inside the window a
  // released send (a logout) keeps its review.
  it('names the closed window for a released send too', () => {
    expect(view(refused({ projectionReleased: true }), closesAt + 60_000)).toMatchObject({
      categoryLabel: 'Plazo de edición cerrado',
      recovery: 'editing_window_closed',
    });
    expect(view(refused({ projectionReleased: true }), closesAt - 60_000)).toMatchObject({
      categoryLabel: 'Revisar antes de reenviar',
      recovery: 'review_base',
    });
  });
});
