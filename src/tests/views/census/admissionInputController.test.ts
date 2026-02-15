import { describe, expect, it } from 'vitest';
import {
  resolveAdmissionDateChange,
  resolveAdmissionDateMax,
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

  it('returns provided max date fallback', () => {
    expect(resolveAdmissionDateMax('2026-02-15')).toBe('2026-02-15');
  });
});
