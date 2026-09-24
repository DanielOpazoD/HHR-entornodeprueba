import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import {
  buildSpecialtyRoundCandidates,
  isCurrentSpecialtyCandidate,
} from '@/features/census/components/specialty-round/specialtyRoundModel';

const patient = (fields: Partial<PatientData>): PatientData => ({
  bedId: 'R1', patientName: 'Paciente sintético', specialty: '', ...fields,
} as PatientData);

describe('census-wide specialty round', () => {
  it('includes pending bed and crib independently, never empty or already assigned patients', () => {
    const beds = {
      R1: patient({ clinicalEpisodeId: 'episode-bed', cie10Code: ' m86.2 ',
        clinicalCrib: patient({ bedId: 'R1', patientName: 'RN sintético',
          clinicalEpisodeId: 'episode-crib', cie10Code: 'A09.0' }) }),
      R2: patient({ bedId: 'R2', patientName: 'Paciente asignado', specialty: 'Med Interna' }),
      R3: patient({ bedId: 'R3', patientName: '' }),
    };
    const candidates = buildSpecialtyRoundCandidates(beds, '2026-09-24');
    expect(candidates.map(candidate => [candidate.key, candidate.cie10Code,
      candidate.scope?.episodeId])).toEqual([
      ['R1:bed', 'M86.2', 'episode-bed'], ['R1:clinicalCrib', 'A09.0', 'episode-crib'],
    ]);
    expect(candidates[1].scope?.target).toBe('clinicalCrib');
  });

  it('invalidates a proposal after episode, diagnosis, specialty or provenance changes', () => {
    const current = patient({ clinicalEpisodeId: 'episode-1', cie10Code: 'M86.2' });
    const candidate = buildSpecialtyRoundCandidates({ R1: current }, '2026-09-24')[0];
    expect(isCurrentSpecialtyCandidate({ R1: current }, candidate)).toBe(true);
    expect(isCurrentSpecialtyCandidate({ R1: { ...current, clinicalEpisodeId: 'episode-2' } },
      candidate)).toBe(false);
    expect(isCurrentSpecialtyCandidate({ R1: { ...current, cie10Code: 'M86.3' } },
      candidate)).toBe(false);
    expect(isCurrentSpecialtyCandidate({ R1: { ...current, specialty: 'Cirugía' } },
      candidate)).toBe(false);
  });
});
