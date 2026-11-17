import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  DATE,
  NEW_LAYOUT,
  monthBackup,
  splitDay,
} from '@/tests/services/exporters/clinicalDerivedBackupRestore.test-support';
import { firestoreError, resetParityWorld } from './dailyRecordWriteResultParity.test-support';
import { server, type ServerAnswer } from './dailyRecordWriteResultParityServer.test-support';

vi.mock('@/services/repositories/repositoryConfig', async () =>
  (await import('./dailyRecordWriteResultParityServer.test-support')).scriptedRepositoryConfig()
);
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal =>
  (await import('./dailyRecordWriteResultParityServer.test-support')).scriptedFirestoreRecordWrites(
    importOriginal
  )
);
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal =>
  (
    await import('./dailyRecordWriteResultParityServer.test-support')
  ).scriptedFirestoreRecordQueries(importOriginal)
);
// The server's read of the restored day: it holds the copy this computer stored after the save,
// recreated with a new layout and the embedded per-episode values (a kept restore).
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService')
  >()),
  readClinicalDerivedDaySnapshot: async (date: string) => {
    const stored = await hospitalDB.dailyRecords.get(date);
    return stored
      ? { status: 'resolved', day: { ...stored, clinicalDerivedLayout: NEW_LAYOUT }, docs: [] }
      : { status: 'missing' };
  },
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { getCurrentUser: () => ({ uid: 'synthetic-parity-A' }) },
}));

/**
 * W14-D1-1 — the backup restore's own «reached the server» rule (dataMaintenanceService.ts:318),
 * observed through the administrator's import report. The shipped repository saves the split
 * day (Dexie and real queue); the server's answer is the only scripted input. Replaces the copy
 * of that expression the parity table used to carry.
 */
describe('write-result parity: restoring a split day from a monthly backup', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await resetParityWorld();
    // No server copy of the backed-up day yet: nothing to compare the restore against.
    server.remoteDay = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each<[string, ServerAnswer, Record<string, unknown>]>([
    [
      'the server confirms the restored day: the report is clean',
      { kind: 'accepts_with_receipt' },
      { success: 1, failed: 0, repaired: 0, outcome: 'clean' },
    ],
    [
      'the restored day waits in the queue: the report lists it as incomplete',
      { kind: 'refuses', error: () => firestoreError('unavailable') },
      {
        success: 1,
        failed: 0,
        repaired: 0,
        outcome: 'partial',
        clinicalDerivedIncompleteDates: [DATE],
      },
    ],
  ])('%s', async (_label, answer, report) => {
    server.answer = answer;
    const backup = monthBackup([splitDay()]) as Parameters<typeof importRecordsFromBackup>[0];

    const result = await importRecordsFromBackup(backup);

    expect(result).toEqual(report);
    expect((await hospitalDB.dailyRecords.get(DATE)) as DailyRecord | undefined).toBeDefined();
  });
});
