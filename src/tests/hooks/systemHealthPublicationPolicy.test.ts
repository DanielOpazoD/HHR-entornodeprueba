import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserHealthStatus } from '@/services/admin/healthService.contracts';
import {
  buildSystemHealthSignature,
  markSystemHealthReported,
  markSystemHealthSignature,
  readLastSystemHealthReportAt,
  readLastSystemHealthSignature,
  shouldPublishSystemHealth,
  SYSTEM_HEALTH_KEEP_ALIVE_MS,
} from '@/hooks/controllers/systemHealthReporterController';

const base = {
  uid: 'u1',
  email: 'a@b.cl',
  displayName: 'A',
  lastSeen: '',
  isOnline: true,
  isOutdated: false,
  pendingSyncTasks: 0,
  failedSyncTasks: 0,
  conflictSyncTasks: 0,
  retryingSyncTasks: 0,
  syncOrphanedTasks: 0,
  pendingMutations: 0,
  localErrorCount: 0,
  repositoryWarningCount: 0,
  oldestPendingAgeMs: 0,
  oldestDirectQueueAgeMs: 0,
  slowestRepositoryOperationMs: 0,
  operationalFailureCount: 0,
  recentEvents: [],
} as unknown as UserHealthStatus;

const publish = (signature: string, lastSignature: string | null, elapsed = 0) =>
  shouldPublishSystemHealth({
    now: 1_000_000 + elapsed,
    lastReportedAt: 1_000_000,
    signature,
    lastSignature,
    keepAliveMs: SYSTEM_HEALTH_KEEP_ALIVE_MS,
  });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('when the health report is worth publishing', () => {
  it('publishes the first picture of a user', () => {
    expect(publish(buildSystemHealthSignature(base), null)).toBe(true);
  });

  it('stays silent while nothing operationally relevant changes', () => {
    const signature = buildSystemHealthSignature(base);
    expect(publish(signature, signature)).toBe(false);
  });

  it('ignores routine noise while the user just types', () => {
    const typing = { ...base, pendingMutations: 1 } as UserHealthStatus;
    const stillTyping = { ...base, pendingMutations: 4 } as UserHealthStatus;
    expect(buildSystemHealthSignature(typing)).toBe(buildSystemHealthSignature(stillTyping));
  });

  it.each([
    ['se pierde la conexión', { isOnline: false }],
    ['aparecen tareas sin sincronizar', { pendingSyncTasks: 1 }],
    ['falla una sincronización', { failedSyncTasks: 1 }],
    ['hay un conflicto', { conflictSyncTasks: 1 }],
    ['aparecen errores locales', { localErrorCount: 1 }],
    ['la versión queda desactualizada', { isOutdated: true }],
    ['algo lleva mucho tiempo pendiente', { oldestPendingAgeMs: 60_000 }],
  ])('publishes when %s', (_label, change) => {
    const before = buildSystemHealthSignature(base);
    const after = buildSystemHealthSignature({ ...base, ...change } as UserHealthStatus);
    expect(after).not.toBe(before);
    expect(publish(after, before)).toBe(true);
  });

  it('publishes a keep-alive so a healthy session still proves it is alive', () => {
    const signature = buildSystemHealthSignature(base);
    expect(publish(signature, signature, SYSTEM_HEALTH_KEEP_ALIVE_MS - 1)).toBe(false);
    expect(publish(signature, signature, SYSTEM_HEALTH_KEEP_ALIVE_MS)).toBe(true);
  });

  it('publishes rather than staying silent when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(readLastSystemHealthSignature('u1')).toBeNull();
    expect(readLastSystemHealthReportAt('u1')).toBe(0);
    expect(publish('cualquiera', readLastSystemHealthSignature('u1'))).toBe(true);
  });

  it('keeps each user independent and never throws on write failures', () => {
    markSystemHealthSignature('u1', 'firma-1');
    markSystemHealthReported('u1', 123);
    expect(readLastSystemHealthSignature('u2')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => markSystemHealthSignature('u1', 'firma-2')).not.toThrow();
  });
});
