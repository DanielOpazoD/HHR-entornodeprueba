import { describe, expect, it } from 'vitest';
import {
  collectClinicalFillCandidates,
  countClinicalFillEligiblePatients,
} from '@/features/rayen-import/domain/clinicalFillCandidates';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = {
  date: '2026-07-28',
  beds: {
    H1C1: {
      bedId: 'H1C1',
      patientName: 'Paciente seguro',
      clinicalEpisodeId: 'episode-safe',
      clinicalCrib: {
        bedId: 'H1C1',
        patientName: 'RN seguro',
        clinicalEpisodeId: 'episode-crib',
      },
    },
    H2C1: {
      bedId: 'H2C1',
      patientName: 'Paciente en conflicto',
      clinicalEpisodeId: 'episode-blocked',
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-07-28T10:00:00.000Z',
} as unknown as DailyRecord;

describe('clinicalFillCandidates', () => {
  it('limits enrichment to structurally confirmed episodes, including an allowed crib', () => {
    const allowed = ['episode-safe', 'episode-crib'];

    expect(collectClinicalFillCandidates(record, allowed)).toEqual([
      expect.objectContaining({ bedId: 'H1C1', clinicalCrib: false }),
      expect.objectContaining({ bedId: 'H1C1', clinicalCrib: true }),
    ]);
    expect(countClinicalFillEligiblePatients(record, allowed)).toBe(2);
  });

  it('preserves the legacy all-eligible behavior when no structural filter is provided', () => {
    expect(countClinicalFillEligiblePatients(record)).toBe(3);
  });
});
