import { describe, expect, it } from 'vitest';
import { resolveHistoricalCudyrPatch } from '@/features/rayen-import/domain/historicalCudyrPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

const official: ImportedCudyr = {
  category: 'C1',
  recordedDate: '2026-07-15',
  recordedAt: '2026-07-16T14:25:00+00:00',
  author: 'Nicole Palma',
  source: 'Eloísa · Gestión de Camas',
};

const recordWith = (cudyr: ImportedCudyr): DailyRecord =>
  ({
    date: '2026-07-15',
    beds: {
      H5C1: {
        bedId: 'H5C1',
        patientName: 'Paciente',
        clinicalEpisodeId: 'episode-1',
        evaluationScores: { cudyr },
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
  }) as unknown as DailyRecord;

describe('resolveHistoricalCudyrPatch', () => {
  it('replaces an old imported score instead of only filling empty fields', () => {
    const stale: ImportedCudyr = {
      ...official,
      category: 'D3',
      recordedAt: '2026-07-15T06:54:00+00:00',
      author: 'Camila Leiva',
    };

    expect(resolveHistoricalCudyrPatch(recordWith(stale), 'episode-1', official)).toEqual({
      matched: true,
      patch: { 'beds.H5C1.evaluationScores.cudyr': official },
    });
  });

  it('does not write again when the official score is already identical', () => {
    expect(resolveHistoricalCudyrPatch(recordWith(official), 'episode-1', official)).toEqual({
      matched: true,
      patch: null,
    });
  });

  it('repairs the owning date even when the remaining official fields already match', () => {
    const misdated = { ...official, recordedDate: '2026-07-16' };
    expect(resolveHistoricalCudyrPatch(recordWith(misdated), 'episode-1', official)).toEqual({
      matched: true,
      patch: { 'beds.H5C1.evaluationScores.cudyr': official },
    });
  });
});
