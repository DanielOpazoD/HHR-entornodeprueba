import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  extractEquivalentBedSourceCollisions,
  type ActivePrincipalPlacement,
} from '@/features/rayen-import/domain/bedOccupancyCollisionPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const placement = (
  clinicalEpisodeId: string,
  bedId: 'R1' | 'R2',
  isCma: boolean
): ActivePrincipalPlacement => ({
  encounter: { encounterId: clinicalEpisodeId } as never,
  mapped: {
    bedId,
    isCma,
    patient: {
      ...EMPTY_PATIENT,
      bedId,
      patientName: clinicalEpisodeId,
      clinicalEpisodeId,
    },
  } as never,
});

describe('equivalent source collision uniqueness', () => {
  it('never offers the same episode in two collision decisions', () => {
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const result = extractEquivalentBedSourceCollisions(
      current,
      [
        placement('EP-REPEATED', 'R1', true),
        placement('EP-R1', 'R1', false),
        placement('EP-REPEATED', 'R2', true),
        placement('EP-R2', 'R2', false),
      ],
      () => undefined
    );

    expect(result.collisions).toHaveLength(1);
    const candidateEpisodes = result.collisions.flatMap(collision =>
      collision.candidates.map(candidate => candidate.clinicalEpisodeId)
    );
    expect(candidateEpisodes).toHaveLength(new Set(candidateEpisodes).size);
    expect(result.remaining.map(item => item.encounter.encounterId)).not.toContain('EP-REPEATED');
  });
});
