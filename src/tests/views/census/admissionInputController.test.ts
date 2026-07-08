import { describe, expect, it } from 'vitest';
import {
  resolveAdmissionDateChange,
  resolveAdmissionDateAudit,
  resolveAdmissionDateMax,
  resolveAdmissionDateOptions,
  resolveAdmissionDateIsEditable,
  resolveAdmissionTimePickerModel,
  resolveAdmissionDateUpdatePlan,
  resolveAdmissionTimeValue,
  resolveAdmissionTooltip,
  resolveIsCriticalAdmissionEmpty,
} from '@/features/census/controllers/admissionInputController';

describe('admissionInputController', () => {
  it('detects critical admission empty when patient exists and date is missing', () => {
    expect(resolveIsCriticalAdmissionEmpty('Paciente', '')).toBe(true);
    expect(resolveIsCriticalAdmissionEmpty('Paciente', '2026-02-15')).toBe(false);
    expect(resolveIsCriticalAdmissionEmpty('', '')).toBe(false);
  });

  it('auto-fills time when date is set and time is missing', () => {
    const resolution = resolveAdmissionDateChange({
      nextDate: '2026-02-15',
      currentAdmissionTime: '',
      now: new Date('2026-02-15T06:42:00'),
    });

    expect(resolution.shouldPatchMultiple).toBe(true);
    expect(resolution.admissionDate).toBe('2026-02-15');
    expect(resolution.admissionTime).toBe('06:42');
  });

  it('keeps single-field change when admission time already exists', () => {
    const resolution = resolveAdmissionDateChange({
      nextDate: '2026-02-15',
      currentAdmissionTime: '05:30',
      now: new Date('2026-02-15T06:42:00'),
    });

    expect(resolution.shouldPatchMultiple).toBe(false);
    expect(resolution.admissionDate).toBe('2026-02-15');
    expect(resolution.admissionTime).toBeUndefined();
  });

  it('builds a multiple-update plan when time is missing or firstSeenDate must be anchored', () => {
    expect(
      resolveAdmissionDateUpdatePlan({
        nextDate: '2026-02-15',
        currentAdmissionTime: '',
        currentDateString: '2026-02-15',
        firstSeenDate: undefined,
        now: new Date('2026-02-15T06:42:00'),
      })
    ).toEqual({
      nextPatch: {
        admissionDate: '2026-02-15',
        admissionTime: '06:42',
        firstSeenDate: '2026-02-15',
      },
      shouldUseMultipleUpdate: true,
    });

    expect(
      resolveAdmissionDateUpdatePlan({
        nextDate: '2026-02-15',
        currentAdmissionTime: '05:30',
        currentDateString: '2026-02-15',
        firstSeenDate: undefined,
        now: new Date('2026-02-15T06:42:00'),
      })
    ).toEqual({
      nextPatch: {
        admissionDate: '2026-02-15',
        firstSeenDate: '2026-02-15',
      },
      shouldUseMultipleUpdate: true,
    });
  });

  it('repairs firstSeenDate when time exists and date is corrected to current day', () => {
    expect(
      resolveAdmissionDateUpdatePlan({
        nextDate: '2026-02-15',
        currentAdmissionTime: '05:30',
        currentDateString: '2026-02-15',
        firstSeenDate: '2026-02-14',
        now: new Date('2026-02-15T06:42:00'),
      })
    ).toEqual({
      nextPatch: {
        admissionDate: '2026-02-15',
        firstSeenDate: '2026-02-15',
      },
      shouldUseMultipleUpdate: true,
    });
  });

  it('repairs stale firstSeenDate when admission date is corrected to current record day', () => {
    expect(
      resolveAdmissionDateUpdatePlan({
        nextDate: '2026-02-15',
        currentAdmissionTime: '05:30',
        currentDateString: '2026-02-15',
        firstSeenDate: '2026-02-14',
        now: new Date('2026-02-15T06:42:00'),
      })
    ).toEqual({
      nextPatch: {
        admissionDate: '2026-02-15',
        firstSeenDate: '2026-02-15',
      },
      shouldUseMultipleUpdate: true,
    });
  });

  it('does not repair firstSeenDate when admission date is moved away from current record day', () => {
    expect(
      resolveAdmissionDateUpdatePlan({
        nextDate: '2026-02-16',
        currentAdmissionTime: '05:30',
        currentDateString: '2026-02-15',
        firstSeenDate: '2026-02-14',
        now: new Date('2026-02-15T06:42:00'),
      })
    ).toEqual({
      nextPatch: {
        admissionDate: '2026-02-16',
      },
      shouldUseMultipleUpdate: false,
    });
  });

  it('returns provided max date fallback', () => {
    expect(resolveAdmissionDateMax('2026-02-15')).toBe('2026-02-15');
  });

  it('suggests the current clinical day window for suspicious admissions', () => {
    const audit = resolveAdmissionDateAudit({
      recordDate: '2026-03-10',
      admissionDate: '2024-01-01',
      admissionTime: '10:30',
    });

    expect(audit.isSuspicious).toBe(true);
    expect(audit.candidateDates).toEqual(['2026-03-09', '2026-03-10', '2026-03-11']);
    expect(audit.suggestedAdmissionDate).toBe('2026-03-10');
    expect(audit.message).toContain('ventana esperada');
  });

  it('accepts the next day for madrugada admissions', () => {
    const audit = resolveAdmissionDateAudit({
      recordDate: '2026-03-10',
      admissionDate: '2026-03-11',
      admissionTime: '02:15',
    });

    expect(audit.isSuspicious).toBe(false);
    expect(audit.suggestedAdmissionDate).toBe('2026-03-11');
  });

  it('only allows editing on the first observed census day', () => {
    expect(
      resolveAdmissionDateIsEditable({
        recordDate: '2026-03-10',
        firstSeenDate: '2026-03-10',
        hasPatient: true,
        isNewAdmission: true,
      })
    ).toBe(true);

    expect(
      resolveAdmissionDateIsEditable({
        recordDate: '2026-03-11',
        firstSeenDate: '2026-03-10',
        hasPatient: true,
        isNewAdmission: false,
      })
    ).toBe(false);
  });

  it('falls back to same-day new admission when firstSeenDate is missing', () => {
    expect(
      resolveAdmissionDateIsEditable({
        recordDate: '2026-03-10',
        hasPatient: true,
        isNewAdmission: true,
      })
    ).toBe(true);

    expect(
      resolveAdmissionDateIsEditable({
        recordDate: '2026-03-11',
        hasPatient: true,
        isNewAdmission: false,
      })
    ).toBe(false);
  });

  it('returns the only allowed admission date options around the census tab date', () => {
    expect(resolveAdmissionDateOptions('2026-03-10')).toEqual([
      { value: '2026-03-09', label: '09/03/2026' },
      { value: '2026-03-10', label: '10/03/2026' },
      { value: '2026-03-11', label: '11/03/2026' },
    ]);
  });

  it('preserves an out-of-window value so it can be corrected visibly', () => {
    expect(resolveAdmissionDateOptions('2026-03-10', '2024-03-10')).toEqual([
      { value: '2024-03-10', label: '10/03/2024', isFallbackValue: true },
      { value: '2026-03-09', label: '09/03/2026' },
      { value: '2026-03-10', label: '10/03/2026' },
      { value: '2026-03-11', label: '11/03/2026' },
    ]);
  });

  it('orders time picker options from the current time backwards', () => {
    const model = resolveAdmissionTimePickerModel({
      admissionTime: '03:07',
      now: new Date('2026-03-10T17:36:00'),
    });

    expect(model.selectedHour).toBe('03');
    expect(model.selectedMinute).toBe('07');
    expect(model.hourOptions.slice(0, 5)).toEqual(['17', '16', '15', '14', '13']);
    expect(model.minuteOptions.slice(0, 5)).toEqual(['36', '35', '34', '33', '32']);
  });

  it('composes a time value from hour and minute selections', () => {
    expect(
      resolveAdmissionTimeValue({
        hour: '02',
        minute: '15',
      })
    ).toBe('02:15');
  });

  // -----------------------------------------------------------------------
  // Legacy patients (admissionDate fallback)
  // -----------------------------------------------------------------------

  describe('resolveAdmissionDateIsEditable — legacy patients', () => {
    it('is editable on admission day via admissionDate fallback when firstSeenDate is missing', () => {
      expect(
        resolveAdmissionDateIsEditable({
          recordDate: '2026-04-10',
          admissionDate: '2026-04-10',
          hasPatient: true,
          isNewAdmission: false,
        })
      ).toBe(true);
    });

    it('is NOT editable on day after admission via admissionDate fallback', () => {
      expect(
        resolveAdmissionDateIsEditable({
          recordDate: '2026-04-11',
          admissionDate: '2026-04-10',
          hasPatient: true,
          isNewAdmission: false,
        })
      ).toBe(false);
    });

    it('firstSeenDate takes priority over admissionDate when both exist', () => {
      // firstSeenDate doesn't match recordDate, admissionDate does
      expect(
        resolveAdmissionDateIsEditable({
          recordDate: '2026-04-10',
          firstSeenDate: '2026-04-09',
          admissionDate: '2026-04-10',
          hasPatient: true,
          isNewAdmission: false,
        })
      ).toBe(false); // firstSeenDate wins (09 ≠ 10)
    });

    it('handles completely empty patient (no dates at all)', () => {
      expect(
        resolveAdmissionDateIsEditable({
          recordDate: '2026-04-10',
          hasPatient: true,
          isNewAdmission: false,
        })
      ).toBe(false);
    });

    it('allows editing when isNewAdmission fallback is true and no dates set', () => {
      expect(
        resolveAdmissionDateIsEditable({
          recordDate: '2026-04-10',
          hasPatient: true,
          isNewAdmission: true,
        })
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Admission tooltip
  // -----------------------------------------------------------------------

  describe('resolveAdmissionTooltip', () => {
    it('shows admission time when available', () => {
      expect(resolveAdmissionTooltip('14:30')).toBe('Hora de ingreso: 14:30');
    });

    it('shows "no registrada" when time is undefined', () => {
      expect(resolveAdmissionTooltip(undefined)).toBe('Hora de ingreso: no registrada');
    });

    it('shows "no registrada" when time is empty string', () => {
      expect(resolveAdmissionTooltip('')).toBe('Hora de ingreso: no registrada');
    });

    it('preserves full time format including minutes', () => {
      expect(resolveAdmissionTooltip('08:05')).toBe('Hora de ingreso: 08:05');
    });
  });
});
