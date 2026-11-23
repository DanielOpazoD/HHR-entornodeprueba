// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildOccupiedPatientRowIndicators,
  EMPTY_PATIENT_ROW_INDICATORS,
  resolveIsNewAdmissionForRecord,
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

  it('marks a madrugada admission on its clinical day and on its calendar day', () => {
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
      isNewAdmission: true,
    });

    expect(
      buildOccupiedPatientRowIndicators({
        isSubRow: false,
        currentDateString: '2026-03-12',
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

  it('applies clinical day boundaries when evaluating new admissions directly', () => {
    const recordDate = '2026-03-05';
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-05',
        admissionTime: '21:10',
      })
    ).toBe(true);
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-06',
        admissionTime: '07:15',
      })
    ).toBe(true);
    expect(resolveIsNewAdmissionForRecord({ recordDate, admissionDate: '2026-03-06' })).toBe(false);
    expect(
      resolveIsNewAdmissionForRecord({ recordDate: '2026-03-06', admissionDate: '2026-03-06' })
    ).toBe(true);
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-06',
        admissionTime: '08:00',
      })
    ).toBe(false);
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-04',
        admissionTime: '23:00',
      })
    ).toBe(false);
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-07',
        admissionTime: '01:00',
      })
    ).toBe(false);
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        firstSeenDate: '2026-03-04',
        admissionDate: '2026-03-05',
        admissionTime: '10:15',
      })
    ).toBe(true);
  });
});
