// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  currentDay,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

const otherPatient = (admission: { admissionDate: string; admissionTime?: string }) => ({
  ...patient(),
  patientName: 'Otra Paciente Sintética',
  rut: '22.222.222-2',
  clinicalEpisodeId: 'synthetic-episode-b',
  ...admission,
});
const dayWith = (bedPatient: ReturnType<typeof patient>): DailyRecord => ({
  ...historicalDay(),
  beds: { R1: bedPatient },
});
const gapFor = (bedPatient: ReturnType<typeof patient>) => ({
  clinicalEpisodeId: bedPatient.clinicalEpisodeId,
  date: '2026-10-26',
  sourceDate: '2026-10-27',
  patient: bedPatient,
});
const recover = (bedPatient: ReturnType<typeof patient>) =>
  recoverDailyCudyrGap(gapFor(bedPatient), [dayWith(bedPatient)], parsedSource());

describe('CUDYR recovery for a patient under eight hours at the cutoff', () => {
  it.each([
    ['in the early hours of the next day', { admissionDate: '2026-10-27', admissionTime: '00:22' }],
    ['late on the same day', { admissionDate: '2026-10-26', admissionTime: '18:30' }],
  ])('expects no record when admitted %s', (_case, admission) => {
    expect(recover(otherPatient(admission))).toEqual({ kind: 'not_applicable' });
  });

  it('still reports the gap for an eligible patient with no record', () => {
    expect(recover(otherPatient({ admissionDate: '2026-10-20' }))).toEqual({
      kind: 'documentary_inconclusive',
    });
  });

  it('stays inconclusive when the admission date is missing, since nothing proves the short stay', () => {
    expect(recover(otherPatient({ admissionDate: '' }))).toEqual({
      kind: 'documentary_inconclusive',
    });
  });

  it('keeps a valid record found for a patient who was not eligible (CUD-02)', () => {
    const resolution = recover({
      ...patient(),
      admissionDate: '2026-10-27',
      admissionTime: '00:22',
    });

    expect(resolution).toMatchObject({ kind: 'recovered', cudyr: { category: 'C2' } });
  });

  it('does not turn the sync partial over it', async () => {
    const previous = dayWith(otherPatient({ admissionDate: '2026-10-27', admissionTime: '00:22' }));
    const current: DailyRecord = {
      ...currentDay(),
      discharges: [],
      beds: { R1: otherPatient({ admissionDate: '2026-10-27', admissionTime: '00:22' }) },
    };
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async date =>
        date === previous.date ? previous : date === current.date ? current : null,
      capture: vi.fn(async () => parsedSource()),
    });

    const result = await reader(current, ['synthetic-episode-b'], {
      map: new Map(),
      historyAvailable: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });
});
