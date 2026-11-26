// @vitest-environment node
import { captureAuthoringSession } from '@/services/session/authoringSession';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { createSavedByQueueRouteError } from '@/services/storage/syncErrorCatalog';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/sync', () => ({
  isRetryableSyncError: vi.fn(),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn(),
}));

import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import {
  isRetryableSyncError,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import {
  assertNoPatientErasures,
  assertRemoteSaveCompatibility,
  resolveRemoteWriteRecovery,
} from '@/services/repositories/dailyRecordRemoteWriteController';

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    activeExtraBeds: [],
    schemaVersion: 1,
  }) as DailyRecord;

const occupiedBed = (patientName: string, clinicalCribName?: string) =>
  ({
    patientName,
    ...(clinicalCribName ? { clinicalCrib: { patientName: clinicalCribName } } : {}),
  }) as never;

// A census of N occupied filler beds so a single-bed erasure stays below the
// density-regression thresholds and reaches the per-bed erasure guard.
const fillerBeds = (count: number): Record<string, unknown> => {
  const beds: Record<string, unknown> = {};
  for (let index = 1; index <= count; index += 1) {
    beds[`F${index}`] = occupiedBed(`Filler ${index}`);
  }
  return beds;
};

const recordWith = (
  beds: Record<string, unknown>,
  movements: { discharges?: unknown[]; transfers?: unknown[]; cma?: unknown[] } = {}
): DailyRecord =>
  ({
    date: '2026-06-25',
    beds,
    discharges: movements.discharges ?? [],
    transfers: movements.transfers ?? [],
    cma: movements.cma ?? [],
    lastUpdated: '2026-06-25T12:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
    schemaVersion: 1,
  }) as DailyRecord;

describe('dailyRecordRemoteWriteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks remote saves when Firestore already has a newer schema version', async () => {
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce({
      ...buildRecord('2026-04-16', '2026-04-16T12:00:00.000Z'),
      schemaVersion: 999,
    } as DailyRecord);

    await expect(
      assertRemoteSaveCompatibility(
        '2026-04-16',
        buildRecord('2026-04-16', '2026-04-16T12:00:00.000Z')
      )
    ).rejects.toThrow('Tu aplicación está desactualizada');
  });

  /** Recovery of a direct send that was stored here before its remote step failed. */
  const storedHere = (date = '2026-04-16'): DailyRecordWriteResult => ({
    date,
    savedHere: true,
    state: 'local',
    cause: 'stored',
  });
  const recover = (
    error: unknown,
    overrides: Partial<Parameters<typeof resolveRemoteWriteRecovery>[0]> = {}
  ) =>
    resolveRemoteWriteRecovery({
      date: '2026-04-16',
      record: buildRecord('2026-04-16', '2026-04-16T12:00:00.000Z'),
      changedPaths: ['beds.R1.patientName'],
      error,
      current: storedHere(),
      authoringSession: captureAuthoringSession(),
      ...overrides,
    });
  const queueRefuses = () =>
    vi.mocked(queueDailyRecordSyncTaskWithLocalRecord).mockResolvedValueOnce({
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks: 192,
      maxPendingTasks: 192,
    });

  it('queues retry recovery with retry metadata when the remote error is retryable', async () => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    vi.mocked(queueDailyRecordSyncTaskWithLocalRecord).mockResolvedValueOnce({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });

    const step = await recover(new Error('network down'));

    expect(step).toMatchObject({
      next: 'continue',
      result: { savedHere: true, state: 'local', cause: 'retrying' },
    });
    expect(queueDailyRecordSyncTaskWithLocalRecord).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-04-16' }),
      expect.objectContaining({
        origin: 'partial_update_retry',
      }),
      { authoringSession: captureAuthoringSession() }
    );
  });

  it('holds a retryable write for review when the queue is full', async () => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    queueRefuses();

    const step = await recover(new Error('network down'));

    expect(step).toMatchObject({
      next: 'continue',
      result: { state: 'held', reason: 'needs_review' },
    });
    expect(step.result.userSafeMessage).toContain('cola de sincronización alcanzó su límite');
    expect(step.result.blockingError).toBeUndefined();
  });

  it('holds a write with no safe recovery route for review', async () => {
    vi.mocked(isRetryableSyncError).mockReturnValue(false);

    const step = await recover(new Error('permission denied'));

    expect(step).toMatchObject({
      next: 'continue',
      result: { savedHere: true, state: 'held', reason: 'needs_review' },
    });
    expect(step.result.userSafeMessage).toBe(
      'Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.'
    );
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
  });

  it('keeps a write the server already took confirmed when a later step fails', async () => {
    const confirmed: DailyRecordWriteResult = {
      ...storedHere(),
      state: 'confirmed',
      localCopy: 'current',
    };
    vi.mocked(isRetryableSyncError).mockReturnValue(false);
    expect((await recover(new Error('ack failed'), { current: confirmed })).result).toMatchObject({
      state: 'confirmed',
      localCopy: 'stale',
    });

    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    const retried = await recover(new Error('ack failed'), {
      current: confirmed,
      localWriteAlreadyQueued: true,
    });
    expect(retried.result).toMatchObject({ state: 'confirmed', localCopy: 'current' });
  });

  it.each([
    new DataRegressionError('Synthetic regression', 1, 2),
    new VersionMismatchError('Synthetic version mismatch'),
  ])('stops a write the server blocked ($name) without queueing it', async error => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);

    const step = await recover(error);

    expect(step).toEqual({
      next: 'return',
      result: expect.objectContaining({
        savedHere: true,
        state: 'not_saved',
        reason: 'blocked',
        userSafeMessage: error.message,
        blockingError: error,
      }),
    });
    expect(step.result.concurrencyConflict).toBeUndefined();
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
  });

  it('names the queue route as the cause when only the day task saves the edit', async () => {
    const recoverRoute = (localWriteAlreadyQueued: boolean) =>
      recover(createSavedByQueueRouteError('synthetic movement from a bed'), {
        changedPaths: ['discharges'],
        expectedVersion: '2026-04-16T11:00:00.000Z',
        localWriteAlreadyQueued,
      });

    expect(await recoverRoute(true)).toMatchObject({
      next: 'continue',
      result: { state: 'local', cause: 'queue_route' },
    });
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();

    // Not stored in the queue: the edit was not routed anywhere and waits for review.
    queueRefuses();
    const refused = await recoverRoute(false);
    expect(refused).toMatchObject({
      next: 'continue',
      result: { state: 'held', reason: 'needs_review' },
    });
  });

  it('reuses durable acceptance without enqueueing or claiming a remote confirmation', async () => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);

    const step = await recover(new Error('network down'), {
      changedPaths: ['*'],
      expectedVersion: '2026-04-16T11:00:00.000Z',
      localWriteAlreadyQueued: true,
    });

    expect(step).toMatchObject({
      next: 'continue',
      result: {
        state: 'local',
        cause: 'retrying',
        userSafeMessage:
          'Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      },
    });
    expect(step.result.confirmedRecord).toBeUndefined();
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: new VersionMismatchError('Synthetic version mismatch'),
      kind: 'version_mismatch',
      expected: { state: 'not_saved', reason: 'blocked' },
    },
    {
      error: Object.assign(new Error('Synthetic conflict'), { name: 'ConcurrencyError' }),
      kind: 'concurrency',
      expected: { state: 'held', reason: 'needs_review', concurrencyConflict: true },
    },
  ])('preserves $kind despite prior durable acceptance', async ({ error, expected }) => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    const step = await recover(error, {
      changedPaths: ['*'],
      allowConflictAutoMerge: false,
      localWriteAlreadyQueued: true,
    });

    expect(step).toMatchObject({
      next: 'return',
      result: { ...expected, blockingError: error },
    });
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
  });

  describe('patient-erasure guard', () => {
    it('blocks a full save that would erase a patient still present in the cloud', async () => {
      const remote = recordWith({ ...fillerBeds(5), H5C2: occupiedBed('Josué Villagra Tolloza') });
      const local = recordWith(fillerBeds(5)); // H5C2 dropped locally

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).rejects.toThrow(
        /H5C2 \(Josué Villagra Tolloza\) tiene un paciente en la nube/
      );
    });

    it('allows the save when the empty bed is explained by a discharge naming that patient', async () => {
      const remote = recordWith({ ...fillerBeds(5), H5C2: occupiedBed('Josué Villagra Tolloza') });
      const local = recordWith(fillerBeds(5), {
        discharges: [{ patientName: 'Josué Villagra Tolloza', bedId: 'H5C2' }],
      });

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).resolves.toBeUndefined();
    });

    it('blocks a bed-reuse erasure when a same-bed discharge names a different patient', async () => {
      // The cloud has "Juan Pérez" in H1C1, but locally a DIFFERENT patient was discharged from
      // H1C1. The same-bed discharge must not vouch for the unrelated remote patient — saving the
      // empty bed would erase Juan.
      const remote = recordWith({ ...fillerBeds(5), H1C1: occupiedBed('Juan Pérez') });
      const local = recordWith(fillerBeds(5), {
        discharges: [{ patientName: 'Otro Nombre', bedId: 'H1C1' }],
      });

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).rejects.toThrow(
        /H1C1 \(Juan Pérez\) tiene un paciente en la nube/
      );
    });

    it('does not let a same-name discharge on a DIFFERENT bed mask an erasure', async () => {
      // Two patients share a name: one is discharged from H2C1, the other is still in H5C2 in the
      // cloud. The discharge must be tied to its own bed, not vouch for H5C2 by name alone.
      const remote = recordWith({ ...fillerBeds(4), H5C2: occupiedBed('Juan Soto') });
      const local = recordWith(fillerBeds(4), {
        discharges: [{ patientName: 'Juan Soto', bedId: 'H2C1' }],
      });

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).rejects.toThrow(
        /H5C2 \(Juan Soto\) tiene un paciente en la nube/
      );
    });

    it('accounts for an emptied bed via a CMA originalBedId match', async () => {
      // CMA movements carry the source bed in `originalBedId` (no `bedId`).
      const remote = recordWith({ ...fillerBeds(4), R2: occupiedBed('Omar Castillo') });
      const local = recordWith(fillerBeds(4), {
        cma: [{ patientName: 'Omar Castillo', originalBedId: 'R2' }],
      });

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).resolves.toBeUndefined();
    });

    it('blocks erasure of a nested Cuna RN occupant', async () => {
      const remote = recordWith({
        ...fillerBeds(4),
        H4C1: occupiedBed('Madre Galaz', 'Recién Nacido Galaz'),
      });
      const local = recordWith({ ...fillerBeds(4), H4C1: occupiedBed('Madre Galaz') }); // crib emptied

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).rejects.toThrow(
        /H4C1 \(cuna RN\) \(Recién Nacido Galaz\)/
      );
    });

    it('allows crib erasure when a discharge names the crib patient', async () => {
      const remote = recordWith({
        ...fillerBeds(4),
        H4C1: occupiedBed('Madre Galaz', 'Recién Nacido Galaz'),
      });
      const local = recordWith(
        { ...fillerBeds(4), H4C1: occupiedBed('Madre Galaz') },
        { discharges: [{ patientName: 'Recién Nacido Galaz', bedId: 'H4C1' }] }
      );

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).resolves.toBeUndefined();
    });

    it('does not let a bedId-only discharge mask an erased crib baby', async () => {
      const remote = recordWith({
        ...fillerBeds(4),
        H4C1: occupiedBed('Madre Galaz', 'Recién Nacido Galaz'),
      });
      // Main occupant still present; a discharge references the bed by id but NOT the baby.
      const local = recordWith(
        { ...fillerBeds(4), H4C1: occupiedBed('Madre Galaz') },
        { discharges: [{ patientName: 'Madre Galaz', bedId: 'H4C1' }] }
      );

      vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

      await expect(assertRemoteSaveCompatibility('2026-06-25', local)).rejects.toThrow(/cuna RN/);
    });
  });

  describe('assertNoPatientErasures (pure, used as the in-transaction backstop)', () => {
    it('throws when the cloud holds a patient missing locally with no movement', () => {
      const remote = recordWith({ ...fillerBeds(5), H5C2: occupiedBed('Josué Villagra Tolloza') });
      const local = recordWith(fillerBeds(5));

      expect(() => assertNoPatientErasures(remote, local)).toThrow(
        /H5C2 \(Josué Villagra Tolloza\)/
      );
    });

    it('blocks a newborn dropped while its mother with the same document remains', () => {
      const mother = {
        patientName: 'Madre Sintetica',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'ep_mother',
      };
      const newborn = {
        patientName: 'RN Sintetico',
        rut: mother.rut,
        clinicalEpisodeId: 'ep_newborn',
      };
      const remote = recordWith({ H4C1: { ...mother, clinicalCrib: newborn } });
      const local = recordWith({ H4C1: mother });

      expect(() => assertNoPatientErasures(remote, local)).toThrow(/H4C1 \(cuna RN\)/);
    });

    it('does not throw when the bed is empty in both copies', () => {
      const remote = recordWith(fillerBeds(5));
      const local = recordWith(fillerBeds(5));

      expect(() => assertNoPatientErasures(remote, local)).not.toThrow();
    });
  });
});
