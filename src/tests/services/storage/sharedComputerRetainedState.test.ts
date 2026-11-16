import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as indexedDbCore from '@/services/storage/indexeddb/indexedDbCore';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearErrorLogs,
  getErrorLogs,
  saveErrorLog,
} from '@/services/storage/indexeddb/indexedDbErrorLogService';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import {
  appendOperationalTelemetryEvent,
  persistOperationalTelemetryEvents,
  readOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetryStore';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const ownerA = 'user:hhrn_synthetic-a';
const ownerB = 'user:hhrn_synthetic-b';
const day = { date: '2026-11-01' };

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  persistOperationalTelemetryEvents([]);
  await hospitalDB.errorLogs.clear();
  await reconcileAuthorizedSessionOwner(ownerA);
});
afterEach(async () => {
  await hospitalDB.errorLogs.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
  persistOperationalTelemetryEvents([]);
});

describe('shared Chrome profile: retained drafts and isolated diagnostics', () => {
  it('isolates A telemetry and error history from B local diagnostic readers', async () => {
    const event = {
      category: 'sync' as const,
      status: 'failed' as const,
      operation: 'firestore_write' as const,
      timestamp: new Date().toISOString(),
      context: { patientName: 'SYNTHETIC PATIENT A', actor: ownerA },
    };
    persistOperationalTelemetryEvents([event]);
    await saveErrorLog({
      id: 'synthetic-error-a',
      timestamp: event.timestamp,
      severity: 'medium',
      message: 'Synthetic unsent clinical operation',
      userId: ownerA,
      context: event.context,
    });
    localStorage.setItem('hhr_private_probe', 'SYNTHETIC PRIVATE');
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);

    expect(localStorage.getItem('hhr_private_probe')).toBeNull();
    expect(JSON.parse(localStorage.getItem('operationalTelemetryEvents') ?? '[]')).toEqual([event]);
    // Retention is deliberate; the unmet contract is reader isolation, never deletion.
    expect(await hospitalDB.errorLogs.get('synthetic-error-a')).toMatchObject({ userId: ownerA });
    const visible = { telemetry: readOperationalTelemetryEvents(), errors: await getErrorLogs() };
    expect(visible).toEqual({ telemetry: [], errors: [] });
  });

  it("clears only what the person can see: their own history, or the team's for an admin", async () => {
    const log = (id: string) => ({
      id,
      timestamp: new Date().toISOString(),
      severity: 'medium' as const,
      message: id,
    });
    await saveErrorLog(log('owned-a'));
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);
    await saveErrorLog(log('owned-b'));

    await clearErrorLogs();
    expect((await hospitalDB.errorLogs.toArray()).map(entry => entry.id)).toEqual(['owned-a']);

    await saveErrorLog(log('owned-b-again'));
    await clearErrorLogs('admin');
    expect(await hospitalDB.errorLogs.count()).toBe(0);
  });

  it('returns only own events across A/B/A, retaining legacy entries and foreign history on append', async () => {
    const event = {
      category: 'sync' as const,
      status: 'failed' as const,
      operation: 'firestore_write' as const,
      timestamp: new Date().toISOString(),
      context: { patientName: 'SYNTHETIC PATIENT A' },
    };
    persistOperationalTelemetryEvents([event]); // Legacy: cannot prove ownership.
    appendOperationalTelemetryEvent(event);
    await saveErrorLog({
      id: 'owned-a',
      timestamp: event.timestamp,
      severity: 'medium',
      message: 'A',
    });
    await hospitalDB.errorLogs.add({
      id: 'legacy',
      timestamp: event.timestamp,
      severity: 'medium',
      message: 'legacy',
    });
    expect(readOperationalTelemetryEvents()).toEqual([event]);
    expect((await getErrorLogs()).map(log => log.id)).toEqual(['owned-a']);
    const retainedA = JSON.parse(localStorage.getItem('operationalTelemetryEvents') ?? '[]');
    // Rehydrate the persisted copy after discarding the in-memory cache.
    persistOperationalTelemetryEvents([]);
    localStorage.setItem('operationalTelemetryEvents', JSON.stringify(retainedA));
    expect(readOperationalTelemetryEvents()).toEqual([event]);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);
    expect(readOperationalTelemetryEvents()).toEqual([]);
    expect(await getErrorLogs()).toEqual([]);
    appendOperationalTelemetryEvent({ ...event, context: { actor: ownerB } });
    await saveErrorLog({
      id: 'owned-b',
      timestamp: event.timestamp,
      severity: 'medium',
      message: 'B',
    });
    expect(readOperationalTelemetryEvents()).toHaveLength(1);
    expect((await getErrorLogs(1)).map(log => log.id)).toEqual(['owned-b']);
    expect(
      JSON.parse(localStorage.getItem('operationalTelemetryEvents') ?? '[]').slice(0, 2)
    ).toEqual(retainedA);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerA);
    expect(readOperationalTelemetryEvents()).toEqual([event]);
    expect((await getErrorLogs(1)).map(log => log.id)).toEqual(['owned-a']);
    expect(await hospitalDB.errorLogs.count()).toBe(3);
  });

  it('rejects an error history read overtaken by a session change', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = vi.spyOn(indexedDbCore, 'ensureDbReady').mockReturnValueOnce(waiting);
    const read = getErrorLogs();
    const rejected = expect(read).rejects.toThrow('La sesión cambió');
    setSessionGeneration('synthetic-replacement');
    release();
    await rejected;
    ready.mockRestore();
  });

  it('leaves a draft of the retired medical handoff untouched across logout', async () => {
    // Text typed in the old medical handoff view before it was retired: no code reads it now,
    // and nothing deletes it.
    const slot = `hhr.medicalHandoffDraft.v2:${ownerA}:synthetic-writer:synthetic-key`;
    const draft = JSON.stringify({ date: day.date, value: 'SYNTHETIC UNCONFIRMED HANDOFF' });
    localStorage.setItem(slot, draft);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);
    expect(localStorage.getItem(slot)).toBe(draft);
  });
});
