import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUserHealthStatus } from '@/hooks/controllers/systemHealthReporterController';
import { reportUserHealth } from '@/services/admin/healthService';
import { firestoreDb } from '@/services/storage/firestore';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: { setDoc: vi.fn().mockResolvedValue(undefined) },
}));

const host = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = host ? describe : describe.skip;
const uid = 'u1';

const status = () =>
  buildUserHealthStatus({
    uid: 'u1',
    email: 'user@example.com',
    displayName: 'User',
    isFirebaseConnected: true,
    isOutdated: false,
    remoteSyncReason: 'ready',
    versionUpdateReason: 'current',
    mutatingCount: 2,
    localErrorCount: 3,
    degradedLocalPersistence: true,
    navigatorOnline: true,
    platform: 'MacIntel',
    userAgent: 'Vitest',
    syncTelemetry: {
      pending: 4,
      failed: 1,
      conflict: 2,
      retrying: 1,
      orphanedTasks: 2,
      oldestPendingAgeMs: 9000,
      batchSize: 25,
      oldestPendingBudgetState: 'ok',
      retryingBudgetState: 'warning',
      runtimeState: 'degraded',
    },
    repositoryPerformance: {
      totalRecorded: 12,
      warningCount: 3,
      slowestOperationMs: 480,
      slowestOperation: 'getForDate',
      latestWarningAt: '2026-03-01T00:00:00.000Z',
      recentWarningOperations: [],
    },
    operationalTelemetry: {
      recentEventCount: 5,
      recentFailedCount: 2,
      recentObservedCount: 3,
      recentRetryableCount: 1,
      recentRecoverableCount: 1,
      recentDegradedCount: 0,
      recentBlockedCount: 1,
      recentUnauthorizedCount: 0,
      lastHourObservedCount: 2,
      syncFailureCount: 1,
      syncObservedCount: 2,
      degradedLocalCount: 1,
      indexedDbObservedCount: 1,
      clinicalDocumentObservedCount: 1,
      createDayObservedCount: 1,
      handoffObservedCount: 1,
      exportObservedCount: 1,
      backupObservedCount: 1,
      exportOrBackupObservedCount: 2,
      dailyRecordRecoveredRealtimeNullCount: 1,
      dailyRecordConfirmedRealtimeNullCount: 0,
      syncReadUnavailableCount: 1,
      indexedDbFallbackModeCount: 1,
      authBootstrapTimeoutCount: 1,
      topObservedCategory: 'backup',
      topObservedOperation: 'backup_handoff_pdf',
      latestObservedOperation: 'backup_handoff_pdf',
      latestRuntimeState: 'recoverable',
      latestIssueAt: '2026-03-02T00:00:00.000Z',
    },
  });

describeEmulator('health report against the deployed rules', () => {
  let environment: RulesTestEnvironment;

  const reporter = () =>
    environment
      .authenticatedContext(uid, {
        email: 'admin@example.invalid',
        role: 'admin',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore()
      .doc(`stats/system_health/users/${uid}`);

  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host ?? '');
    if (!endpoint) throw new Error('Use the canonical loopback Firestore emulator launcher.');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-health-report',
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });
  beforeEach(async () => {
    await environment.clearFirestore();
    vi.mocked(firestoreDb.setDoc).mockClear();
    await environment.withSecurityRulesDisabled(context =>
      context.firestore().doc('config/roles').set({ 'admin@example.invalid': 'admin' })
    );
  });
  afterAll(async () => {
    await environment?.cleanup();
  });

  it('publishes what the rules accept', async () => {
    await reportUserHealth(status());
    const [, , published] = vi.mocked(firestoreDb.setDoc).mock.calls[0];

    await assertSucceeds(reporter().set(published as object));
    expect(published).not.toHaveProperty('recentEvents');
  });

  it('keeps recent events on the device, because the rules refuse them', async () => {
    await assertFails(reporter().set({ uid, recentEvents: [] }));
  });
});
