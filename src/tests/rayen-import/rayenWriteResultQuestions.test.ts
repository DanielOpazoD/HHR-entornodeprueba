import { describe, expect, it, vi } from 'vitest';
import {
  isRayenCensusWriteSettled,
  assertRayenCensusPersistenceConfirmed,
} from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import {
  isHistoricalPatchOnlyQueued,
  persistHistoricalOccupancyCorrection,
} from '@/features/rayen-import/domain/historicalCorrectionPersistence';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
  type SaveDailyRecordResult,
  type UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';

/**
 * Rayen asks its own two questions of a write result (W14-D1-5b): is the structure settled
 * (confirmed by the server, or stored with no server), and did a cross-day patch only stay in
 * this computer's queue. The shapes are the ones the shipped producers return (parity table).
 */
const DATE = '2026-11-17';

const save = (overrides: Partial<SaveDailyRecordResult>): SaveDailyRecordResult =>
  createSaveDailyRecordResult({
    date: DATE,
    outcome: 'clean',
    savedLocally: true,
    savedRemotely: true,
    queuedForRetry: false,
    autoMerged: false,
    ...overrides,
  });

const patch = (overrides: Partial<UpdatePartialDailyRecordResult>) =>
  createUpdatePartialDailyRecordResult({
    date: DATE,
    outcome: 'clean',
    savedLocally: true,
    updatedRemotely: true,
    queuedForRetry: false,
    autoMerged: false,
    ...overrides,
  });

const staleConfirmation = {
  outcome: 'unrecoverable' as const,
  savedLocally: false,
  userSafeMessage: 'Los cambios ya quedaron guardados en el servidor, pero no la copia local.',
  blockingError: new Error('copia local sin actualizar'),
};
const heldForReview = {
  outcome: 'unrecoverable' as const,
  savedLocally: true,
  userSafeMessage: 'Los cambios se guardaron localmente, pero requieren revisión manual.',
};

describe('Rayen: is the structural census settled?', () => {
  it.each([
    ['confirmed by the server', save({}), true],
    ['stored here with no server to send it to', save({ savedRemotely: false }), true],
    [
      'waiting in the queue',
      save({ outcome: 'queued', savedRemotely: false, queuedForRetry: true }),
      false,
    ],
    [
      'merged with another device',
      save({
        outcome: 'auto_merged',
        savedRemotely: false,
        queuedForRetry: true,
        autoMerged: true,
      }),
      false,
    ],
    ['confirmed while this computer could not keep its copy', save(staleConfirmation), false],
  ])('%s → %s', (_, result, settled) => {
    expect(isRayenCensusWriteSettled(result)).toBe(settled);
  });

  it('a stale confirmation stops the run with its own error, before clinical enrichment', () => {
    expect(() =>
      assertRayenCensusPersistenceConfirmed({
        record: DataFactory.createMockDailyRecord(DATE),
        result: save({ ...staleConfirmation, savedRemotely: true }),
      })
    ).toThrow('copia local sin actualizar');
  });
});

describe('Rayen: does a cross-day patch only wait in this computer?', () => {
  it('an accepted patch counts as applied', () => {
    expect(isHistoricalPatchOnlyQueued(patch({}))).toBe(false);
    expect(isHistoricalPatchOnlyQueued(null)).toBe(false);
  });

  it('a server-confirmed patch whose local copy lagged still counts as applied', () => {
    expect(isHistoricalPatchOnlyQueued(patch(staleConfirmation))).toBe(false);
  });

  it('a refused patch kept here waits in the queue', () => {
    expect(isHistoricalPatchOnlyQueued(patch({ ...heldForReview, updatedRemotely: false }))).toBe(
      true
    );
  });

  it('a refused patch that kept nothing throws, named for a conflict when it was one', () => {
    let thrown: unknown;
    try {
      isHistoricalPatchOnlyQueued(
        patch({
          outcome: 'unrecoverable',
          savedLocally: false,
          updatedRemotely: false,
          conflictSummary: {
            kind: 'concurrency',
            sourceOfTruth: 'local',
            message: 'Otro equipo cambió el día.',
          },
          userSafeMessage: 'El día cambió en otro equipo.',
        })
      );
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
    vi.mocked(repository.saveDetailed).mockResolvedValue(save({ savedRemotely: false }));

    await expect(persistHistoricalOccupancyCorrection(repository, base, base)).rejects.toThrow(
      'No se confirmó la conciliación del censo histórico.'
    );
  });
});
