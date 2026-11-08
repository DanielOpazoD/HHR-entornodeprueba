// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveIsNewAdmissionForRecord } from '@/features/census/controllers/patientRowNewAdmissionIndicatorController';

describe('patientRowNewAdmissionIndicatorController', () => {
  const recordDate = '2026-03-05';

  it('marks admissions on the same record date as new', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-05',
        admissionTime: '21:10',
      })
    ).toBe(true);
  });

  it('marks next-day admissions before night-end as new', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-06',
        admissionTime: '07:15',
      })
    ).toBe(true);
  });

  it('does not mark next-day admissions without time as new when no firstSeenDate exists', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-06',
      })
    ).toBe(false);

    expect(
      resolveIsNewAdmissionForRecord({
        recordDate: '2026-03-06',
        admissionDate: '2026-03-06',
      })
    ).toBe(true);
  });

  it('does not mark next-day admissions at or after night-end', () => {
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
        admissionDate: '2026-03-06',
        admissionTime: '09:10',
      })
    ).toBe(false);
  });

  it('does not mark admissions from previous days', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-04',
        admissionTime: '23:00',
      })
    ).toBe(false);
  });

  it('does not mark admissions after the next day', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        admissionDate: '2026-03-07',
        admissionTime: '01:00',
      })
    ).toBe(false);
  });

  it('prefers firstSeenDate over an incorrect admissionDate', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate,
        firstSeenDate: '2026-03-05',
        admissionDate: '2026-03-06',
        admissionTime: '11:00',
      })
    ).toBe(true);
  });

  it('marks a madrugada admission on its clinical day and on its calendar day, and no later', () => {
    const admission = { admissionDate: '2026-03-06', admissionTime: '02:00' };

    // Night shift of the 5th: the clinical day of the admission.
    expect(resolveIsNewAdmissionForRecord({ recordDate, ...admission })).toBe(true);
    // The calendar day it happened, whether it was first seen on the 5th or the 6th.
    for (const firstSeenDate of ['2026-03-05', '2026-03-06', undefined]) {
      expect(
        resolveIsNewAdmissionForRecord({ recordDate: '2026-03-06', firstSeenDate, ...admission })
      ).toBe(true);
    }
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate: '2026-03-07',
        firstSeenDate: '2026-03-05',
        ...admission,
      })
    ).toBe(false);
  });

  it('shows new-admission when firstSeenDate is stale from a copied prior day but admission date/time are from the current day', () => {
    expect(
      resolveIsNewAdmissionForRecord({
        recordDate: '2026-03-05',
        firstSeenDate: '2026-03-04',
        admissionDate: '2026-03-05',
        admissionTime: '10:15',
      })
    ).toBe(true);
  });
});
