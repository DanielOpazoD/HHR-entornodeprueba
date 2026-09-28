// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildOccupiedPatientRowIndicators,
  EMPTY_PATIENT_ROW_INDICATORS,
  resolvePatientRowIndicators,
} from '@/features/census/controllers/patientRowIndicatorsController';

describe('patientRowIndicatorsController', () => {
  it('filters the clinical-document dot through row capabilities', () => {
    expect(
      resolvePatientRowIndicators({
        indicators: {
          hasClinicalDocument: true,
          isNewAdmission: true,
        },
        canShowClinicalDocumentIndicator: false,
      })
    ).toEqual({
      hasClinicalDocument: false,
      isNewAdmission: true,
    });
  });

  it('returns the shared empty state for sub rows', () => {
    expect(
      buildOccupiedPatientRowIndicators({
        isSubRow: true,
        currentDateString: '2026-03-10',
        firstSeenDate: '2026-03-10',
        admissionDate: '2026-03-10',
        admissionTime: '14:00',
        hasClinicalDocument: true,
      })
    ).toBe(EMPTY_PATIENT_ROW_INDICATORS);
  });

  it('classifies main-row admissions through the unified clinical-day logic', () => {
    expect(
      buildOccupiedPatientRowIndicators({
        isSubRow: false,
        currentDateString: '2026-03-10',
        firstSeenDate: '2026-03-10',
        admissionDate: '2026-03-11',
        admissionTime: '02:00',
        hasClinicalDocument: true,
      })
    ).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: true,
    });

    expect(
      buildOccupiedPatientRowIndicators({
        isSubRow: false,
        currentDateString: '2026-03-11',
        firstSeenDate: '2026-03-10',
        admissionDate: '2026-03-11',
        admissionTime: '02:00',
        hasClinicalDocument: true,
      })
    ).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: false,
    });
  });

  it('prefers firstSeenDate over a mistyped admissionDate when deciding new admission state', () => {
    expect(
      buildOccupiedPatientRowIndicators({
        isSubRow: false,
        currentDateString: '2026-03-10',
        firstSeenDate: '2026-03-10',
        admissionDate: '2026-03-11',
        admissionTime: '10:00',
        hasClinicalDocument: false,
      })
    ).toEqual({
      hasClinicalDocument: false,
      isNewAdmission: true,
    });
  });
});
