import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getErrorLogs, saveErrorLog } from '@/services/storage/indexeddb/indexedDbErrorLogService';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import {
  createMedicalHandoffDraftWriter,
  readMedicalHandoffDrafts,
  resetMedicalHandoffDraftMemoryForTests,
  writeMedicalHandoffDraft,
} from '@/services/storage/medicalHandoffDraftStorage';
import {
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
  resetMedicalHandoffDraftMemoryForTests();
  persistOperationalTelemetryEvents([]);
  await hospitalDB.errorLogs.clear();
  await reconcileAuthorizedSessionOwner(ownerA);
});
afterEach(async () => {
  await hospitalDB.errorLogs.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
  resetMedicalHandoffDraftMemoryForTests();
  persistOperationalTelemetryEvents([]);
});

describe('shared Chrome profile: retained drafts and accepted diagnostic residues', () => {
  // Pending accepted by the owner until after 2026-11-08: technical residues in a shared Chrome profile.
  it.fails('isolates A telemetry and error history from B local diagnostic readers', async () => {
    const event = {
      category: 'sync' as const,
      status: 'failed' as const,
      operation: 'synthetic_shared_computer_probe',
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

  it('preserves a durable handoff draft across logout and a reload, returning its text only to A', async () => {
    const draft = {
      date: day.date,
      documentType: 'Pasaporte',
      rut: 'SYNTHETIC-PASSPORT',
      patientName: 'SYNTHETIC PATIENT A',
      clinicalEpisodeId: 'synthetic-episode-a',
      entryId: 'primary-note',
      value: 'SYNTHETIC UNCONFIRMED HANDOFF',
    };
    expect(writeMedicalHandoffDraft(createMedicalHandoffDraftWriter(), draft)).toBe(true);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);
    resetMedicalHandoffDraftMemoryForTests();
    expect(readMedicalHandoffDrafts()).toEqual([]);
    const slots = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index)
    ).filter((key): key is string => Boolean(key?.startsWith('hhr.medicalHandoffDraft.v2:')));
    expect(slots).toHaveLength(1); // Isolation in the reader, not removal/encryption from this Chrome profile.
    expect(JSON.parse(localStorage.getItem(slots[0]) ?? '{}')).toEqual(draft);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerA);
    expect(readMedicalHandoffDrafts()).toEqual([
      expect.objectContaining({ ...draft, durable: true }),
    ]);
  });
});
