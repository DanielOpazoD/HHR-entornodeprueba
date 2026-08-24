import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { applyCmaAdmissionResolutions } from '@/features/rayen-import/domain/cmaAdmissionReview';

const diffWithCmaAdmission = {
  admissions: [{ bedId: 'R1', isCma: true, patient: { patientName: 'Paciente CMA' } }],
} as CensusImportDiff;

describe('CMA admission confirmation guard', () => {
  it('rejects a CMA-source admission without an explicit decision', () => {
    expect(() => applyCmaAdmissionResolutions(diffWithCmaAdmission, [])).toThrow(
      'requiere decidir'
    );
  });

  it('keeps a CMA-source admission selected for incorporation', () => {
    const result = applyCmaAdmissionResolutions(diffWithCmaAdmission, [
      { admissionKey: '[null,"R1",null,null,"Paciente CMA"]', disposition: 'admit' },
    ]);

    expect(result.admissions).toHaveLength(1);
  });

  it('removes a deferred CMA-source admission from this import only', () => {
    const result = applyCmaAdmissionResolutions(diffWithCmaAdmission, [
      { admissionKey: '[null,"R1",null,null,"Paciente CMA"]', disposition: 'defer' },
    ]);

    expect(result.admissions).toEqual([]);
    expect(result.summary.admissions).toBe(0);
  });

  it('removes historical corrections tied to a deferred CMA admission', () => {
    const diff = {
      ...diffWithCmaAdmission,
      admissions: [
        {
          ...diffWithCmaAdmission.admissions[0],
          patient: {
            ...diffWithCmaAdmission.admissions[0].patient,
            clinicalEpisodeId: 'EP-CMA-1',
          },
        },
      ],
      previousDayAdmissionCandidates: [
        {
          ...diffWithCmaAdmission.admissions[0],
          patient: {
            ...diffWithCmaAdmission.admissions[0].patient,
            clinicalEpisodeId: 'EP-CMA-1',
          },
        },
      ],
      previousDayEdits: [
        {
          day: '2026-08-22',
          reason: 'admission-night-shift-correction' as const,
          patientNames: ['Paciente CMA'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
          admissionSubjects: [
            { kind: 'principal' as const, bedId: 'R0', clinicalEpisodeId: 'EP-CMA-1' },
          ],
        },
      ],
    } as CensusImportDiff;

    const result = applyCmaAdmissionResolutions(diff, [
      { admissionKey: '[null,"R1","EP-CMA-1",null,"Paciente CMA"]', disposition: 'defer' },
    ]);

    expect(result.previousDayAdmissionCandidates).toEqual([]);
    expect(result.previousDayEdits).toEqual([]);
  });
});
