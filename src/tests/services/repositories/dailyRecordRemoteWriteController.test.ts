import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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

  it('queues retry recovery with retry metadata when the remote error is retryable', async () => {
    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    vi.mocked(queueDailyRecordSyncTaskWithLocalRecord).mockResolvedValueOnce({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });

    const result = await resolveRemoteWriteRecovery(
      '2026-04-16',
      buildRecord('2026-04-16', '2026-04-16T12:00:00.000Z'),
      ['beds.R1.patientName'],
      new Error('network down')
    );

    expect(result.status).toBe('queued_for_retry');
    expect(queueDailyRecordSyncTaskWithLocalRecord).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-04-16' }),
      expect.objectContaining({
        origin: 'partial_update_retry',
      })
    );
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

    it('does not throw when the bed is empty in both copies', () => {
      const remote = recordWith(fillerBeds(5));
      const local = recordWith(fillerBeds(5));

      expect(() => assertNoPatientErasures(remote, local)).not.toThrow();
    });
  });
});
