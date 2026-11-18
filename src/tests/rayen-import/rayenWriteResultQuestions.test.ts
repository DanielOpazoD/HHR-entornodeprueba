import { describe, expect, it, vi } from 'vitest';
import {
  isRayenCensusWriteSettled,
  assertRayenCensusPersistenceConfirmed,
} from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import {
  isHistoricalPatchOnlyQueued,
  persistHistoricalOccupancyCorrection,
} from '@/features/rayen-import/domain/historicalCorrectionPersistence';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';

/**
 * Rayen asks its own two questions of a write result (W14-D1-5b): is the structure settled
 * (confirmed by the server, or stored with no server), and did a cross-day patch only stay in
 * this computer's queue. The shapes are the ones the shipped producers return (parity table).
 */
const DATE = '2026-11-17';

const confirmed: DailyRecordWriteResult = {
  date: DATE,
  savedHere: true,
  state: 'confirmed',
  localCopy: 'current',
};
const storedHere: DailyRecordWriteResult = {
  date: DATE,
  savedHere: true,
  state: 'local',
  cause: 'stored',
};
const staleConfirmation: DailyRecordWriteResult = {
  date: DATE,
  savedHere: false,
  state: 'confirmed',
  localCopy: 'stale',
  userSafeMessage: 'Los cambios ya quedaron guardados en el servidor, pero no la copia local.',
  blockingError: new Error('copia local sin actualizar'),
};
const heldForReview: DailyRecordWriteResult = {
  date: DATE,
  savedHere: true,
  state: 'held',
  reason: 'needs_review',
  userSafeMessage: 'Los cambios se guardaron localmente, pero requieren revisión manual.',
};

describe('Rayen: is the structural census settled?', () => {
  it.each([
    ['confirmed by the server', confirmed, true],
    ['stored here with no server to send it to', storedHere, true],
    ['waiting in the queue', { ...storedHere, cause: 'retrying' }, false],
    ['merged with another device', { ...storedHere, cause: 'merged' }, false],
    ['confirmed while this computer could not keep its copy', staleConfirmation, false],
  ] as const)('%s → %s', (_, result, settled) => {
    expect(isRayenCensusWriteSettled(result)).toBe(settled);
  });

  it('a stale confirmation stops the run with its own error, before clinical enrichment', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        record: DataFactory.createMockDailyRecord(DATE),
        result: staleConfirmation,
      })
    ).toThrow('copia local sin actualizar');
  });
});

describe('Rayen: does a cross-day patch only wait in this computer?', () => {
  it('an accepted patch counts as applied', () => {
    expect(isHistoricalPatchOnlyQueued(confirmed)).toBe(false);
    expect(isHistoricalPatchOnlyQueued(null)).toBe(false);
  });

  it('a server-confirmed patch whose local copy lagged still counts as applied', () => {
    expect(isHistoricalPatchOnlyQueued(staleConfirmation)).toBe(false);
  });

  it('a refused patch kept here waits in the queue', () => {
    expect(isHistoricalPatchOnlyQueued(heldForReview)).toBe(true);
  });

  it('a refused patch that kept nothing throws, named for a conflict when it was one', () => {
    let thrown: unknown;
    try {
      isHistoricalPatchOnlyQueued({
        date: DATE,
        savedHere: false,
        state: 'not_saved',
        reason: 'local_failed',
        concurrencyConflict: true,
        userSafeMessage: 'El día cambió en otro equipo.',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'ConcurrencyError',
      message: 'El día cambió en otro equipo.',
    });
  });
});

describe('Rayen: a historical occupancy correction needs the server', () => {
  it('a save stored only on this computer is not a reconciled historical census', async () => {
    const base = DataFactory.createMockDailyRecord(DATE);
    const repository = buildMockDailyRecordRepository();
    vi.mocked(repository.saveDetailed).mockResolvedValue(storedHere);

    await expect(persistHistoricalOccupancyCorrection(repository, base, base)).rejects.toThrow(
      'No se confirmó la conciliación del censo histórico.'
    );
  });
});
