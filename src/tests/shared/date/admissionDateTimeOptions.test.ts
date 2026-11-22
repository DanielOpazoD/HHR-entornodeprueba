// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveAdmissionDateAudit } from '@/domain/clinical-episode/admissionDatePolicy';
import { resolveAdmissionDateOptions } from '@/shared/date/admissionDateOptions';
import {
  resolveAdmissionTimePickerModel,
  resolveAdmissionTimeValue,
} from '@/shared/date/admissionTimeOptions';

describe('admission date and time options', () => {
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

  it('returns the only allowed admission date options around the census tab date', () => {
    expect(resolveAdmissionDateOptions('2026-03-10')).toEqual([
      { value: '2026-03-09', label: '09-03-2026' },
      { value: '2026-03-10', label: '10-03-2026' },
      { value: '2026-03-11', label: '11-03-2026' },
    ]);
  });

  it('preserves an out-of-window value so it can be corrected visibly', () => {
    expect(resolveAdmissionDateOptions('2026-03-10', '2024-03-10')).toEqual([
      { value: '2024-03-10', label: '10-03-2024', isFallbackValue: true },
      { value: '2026-03-09', label: '09-03-2026' },
      { value: '2026-03-10', label: '10-03-2026' },
      { value: '2026-03-11', label: '11-03-2026' },
    ]);
  });

  it('orders time picker options from the current time backwards', () => {
    const model = resolveAdmissionTimePickerModel({
      admissionTime: '03:07',
      // 17:36 on the hospital wall clock (Rapa Nui, UTC-5 in March).
      now: new Date('2026-03-10T17:36:00-05:00'),
    });

    expect(model.selectedHour).toBe('03');
    expect(model.selectedMinute).toBe('07');
    expect(model.hourOptions.slice(0, 5)).toEqual(['17', '16', '15', '14', '13']);
    expect(model.minuteOptions.slice(0, 5)).toEqual(['36', '35', '34', '33', '32']);
  });

  it('starts the time picker at the hospital hour, not the mainland device hour', () => {
    // 23:30 on a Santiago device is 21:30 in Rapa Nui.
    const model = resolveAdmissionTimePickerModel({ now: new Date('2026-03-10T23:30:00-03:00') });

    expect(model.selectedHour).toBe('21');
    expect(model.selectedMinute).toBe('30');
    expect(model.hourOptions[0]).toBe('21');
  });

  it('composes a time value from hour and minute selections', () => {
    expect(
      resolveAdmissionTimeValue({
        hour: '02',
        minute: '15',
      })
    ).toBe('02:15');
  });
});
