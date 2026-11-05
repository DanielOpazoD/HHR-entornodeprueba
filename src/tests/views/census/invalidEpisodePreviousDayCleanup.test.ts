// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  cleanInvalidEpisodeFromPreviousDay,
  describePreviousDayCleanup,
} from '@/features/census/controllers/invalidEpisodePreviousDayCleanup';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// 13:00 in Rapa Nui on 2026-11-05: today's census day is 2026-11-05.
const now = new Date('2026-11-05T18:00:00Z');
const EPISODE = '900200';

const yesterday = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-11-04', {
    lastUpdated: '2026-11-04T23:00:00.000Z',
    beds: {
      BOX2: DataFactory.createMockPatient('BOX2', {
        patientName: 'Ingreso Duplicado',
        clinicalEpisodeId: EPISODE,
      }),
      H1C1: DataFactory.createMockPatient('H1C1', {
        patientName: 'Otra Paciente',
        clinicalEpisodeId: '900100',
      }),
    },
    discharges: [
      DataFactory.createMockDischarge({ id: 'd-dup', clinicalEpisodeId: EPISODE }),
      DataFactory.createMockDischarge({ id: 'd-other', clinicalEpisodeId: '900100' }),
    ],
    ...overrides,
  });

const repositoryFor = (record: DailyRecord | null, accepted = true) => ({
  getAuthoritativeForDate: vi.fn(async () => record),
  updatePartialDetailed: vi.fn(async () =>
    accepted
      ? { status: 'success' as const, updatedRemotely: true }
      : { status: 'blocked' as const, updatedRemotely: false, outcome: 'blocked' }
  ),
});

const clean = (repository: ReturnType<typeof repositoryFor>, censusDate = '2026-11-05') =>
  cleanInvalidEpisodeFromPreviousDay({
    repository: repository as never,
    censusDate,
    clinicalEpisodeId: EPISODE,
    now,
  });

describe('cleanInvalidEpisodeFromPreviousDay', () => {
  it('clears the bed through «Limpiar» and removes only that episode’s alta', async () => {
    const repository = repositoryFor(yesterday());

    expect(await clean(repository)).toEqual({ status: 'cleaned', day: '2026-11-04' });

    const [bedCall, movementCall] = repository.updatePartialDetailed.mock.calls as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ][];
    expect(bedCall[0]).toBe('2026-11-04');
    expect(Object.keys(bedCall[1])).toEqual(['beds.BOX2']);
    expect(bedCall[2]).toMatchObject({
      requireConfirmedRecord: true,
      intentionalBedClear: {
        bedId: 'BOX2',
        confirmedLastUpdated: '2026-11-04T23:00:00.000Z',
        confirmedOccupant: expect.objectContaining({ clinicalEpisodeId: EPISODE }),
      },
    });
    const discharges = movementCall[1].discharges as Array<{
      id: string;
      deletedAt?: string;
      deletedReason?: string;
    }>;
    expect(discharges.find(item => item.id === 'd-dup')).toMatchObject({
      deletedReason: 'invalid_episode',
      deletedAt: expect.any(String),
    });
    expect(discharges.find(item => item.id === 'd-other')?.deletedAt).toBeUndefined();
  });

  it('never writes a day past its 48 h, even before the morning handoff', async () => {
    // 07:00 on 2026-11-05 in Rapa Nui: the census day is still 2026-11-04, and 2026-11-03 began
    // 55 hours earlier.
    const early = repositoryFor(yesterday({ date: '2026-11-03' }));

    expect(
      await cleanInvalidEpisodeFromPreviousDay({
        repository: early as never,
        censusDate: '2026-11-04',
        clinicalEpisodeId: EPISODE,
        now: new Date('2026-11-05T12:00:00Z'),
      })
    ).toEqual({ status: 'not_applicable' });
    expect(early.getAuthoritativeForDate).not.toHaveBeenCalled();
    expect(early.updatePartialDetailed).not.toHaveBeenCalled();
  });

  it('leaves past census days, days without the episode and missing days alone', async () => {
    const past = repositoryFor(yesterday());
    expect(await clean(past, '2026-11-04')).toEqual({ status: 'not_applicable' });
    expect(past.getAuthoritativeForDate).not.toHaveBeenCalled();

    const unrelated = repositoryFor(
      yesterday({ beds: {}, discharges: [DataFactory.createMockDischarge({ id: 'x' })] })
    );
    expect(await clean(unrelated)).toEqual({ status: 'not_applicable' });

    expect(await clean(repositoryFor(null))).toEqual({ status: 'not_applicable' });
    expect(unrelated.updatePartialDetailed).not.toHaveBeenCalled();
  });

  it('does not touch a signed day or a newborn’s crib', async () => {
    const signed = repositoryFor(yesterday({ medicalSignature: { signedBy: 'Dr' } as never }));
    expect(await clean(signed)).toEqual({ status: 'skipped', day: '2026-11-04', reason: 'signed' });

    const withCrib = yesterday();
    withCrib.beds.BOX2 = {
      ...withCrib.beds.BOX2,
      clinicalCrib: DataFactory.createMockPatient('BOX2', { clinicalEpisodeId: '900300' }),
    };
    const crib = repositoryFor(withCrib);
    expect(await clean(crib)).toEqual({
      status: 'skipped',
      day: '2026-11-04',
      reason: 'clinical_crib',
    });
    expect(signed.updatePartialDetailed).not.toHaveBeenCalled();
    expect(crib.updatePartialDetailed).not.toHaveBeenCalled();
  });

  it('reports a write the server did not accept', async () => {
    expect(await clean(repositoryFor(yesterday(), false))).toEqual({
      status: 'failed',
      day: '2026-11-04',
    });
  });

  it('tells the person what is left to review', () => {
    expect(describePreviousDayCleanup({ status: 'cleaned', day: '2026-11-04' })).toBeNull();
    expect(describePreviousDayCleanup({ status: 'failed', day: '2026-11-04' })).toContain(
      'no se pudo limpiar el 04-11-2026'
    );
    expect(
      describePreviousDayCleanup({ status: 'skipped', day: '2026-11-04', reason: 'signed' })
    ).toBe('El 04-11-2026 está firmado y no se modificó.');
  });
});
