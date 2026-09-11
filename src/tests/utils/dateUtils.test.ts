import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDateDDMMYYYY,
  getTodayISO,
  formatDateForDisplay,
  formatTimeHHMM,
  daysBetween,
  getTimeRoundedToStep,
  isFutureDate,
  parseISODate,
  isBusinessDay,
  getShiftSchedule,
  resolveClinicalDayBounds,
  resolveClinicalDayForDateTime,
  resolveCurrentClinicalDay,
  isNewAdmissionForClinicalDay,
  isWithinDayShift,
  isAdmittedDuringShift,
  calculateHospitalizedDays,
  calculateDischargeStayDays,
} from '@/utils/dateUtils';

describe('dateUtils', () => {
  describe('formatDateDDMMYYYY', () => {
    it('should format YYYY-MM-DD to DD-MM-YYYY', () => {
      expect(formatDateDDMMYYYY('2024-12-25')).toBe('25-12-2024');
    });

    it('should return "-" if no date is provided', () => {
      expect(formatDateDDMMYYYY()).toBe('-');
    });

    it('should return original string if it does not have 3 parts', () => {
      expect(formatDateDDMMYYYY('invalid')).toBe('invalid');
    });
  });

  describe('getTodayISO', () => {
    it('should return today date in YYYY-MM-DD format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-26T15:00:00.000Z')); // Dec 26, 10:00 in Rapa Nui
      expect(getTodayISO()).toBe('2024-12-26');
      vi.useRealTimers();
    });

    it('follows the hospital calendar, not the mainland device clock', () => {
      vi.useFakeTimers();
      // Santiago midnight of Dec 26 is still Dec 25 22:00 in Rapa Nui.
      vi.setSystemTime(new Date('2024-12-26T03:00:00.000Z'));
      expect(getTodayISO()).toBe('2024-12-25');
      vi.useRealTimers();
    });
  });

  describe('formatDateForDisplay', () => {
    it('should format date for Spanish display', () => {
      const date = new Date(2024, 11, 25);
      const result = formatDateForDisplay(date);
      // Result depends on environment locale but should include the month and day
      expect(result).toContain('diciembre');
      expect(result).toContain('25');
    });
  });

  describe('formatTimeHHMM', () => {
    it('should format an ISO timestamp to 24h HH:MM output', () => {
      expect(formatTimeHHMM('2026-03-07T21:45:00')).toBe('21:45');
    });

    it('should return fallback for empty or invalid values', () => {
      expect(formatTimeHHMM()).toBe('--:--');
      expect(formatTimeHHMM('invalid')).toBe('--:--');
    });
  });

  describe('daysBetween', () => {
    it('should calculate days between two dates correctly', () => {
      expect(daysBetween('2024-12-01', '2024-12-05')).toBe(4);
      expect(daysBetween('2024-12-01', '2024-12-01')).toBe(0);
    });
  });

  describe('getTimeRoundedToStep', () => {
    it('should round time to default 5 minute step', () => {
      const date = new Date(2024, 11, 25, 10, 12, 0); // 10:12
      expect(getTimeRoundedToStep(date)).toBe('10:10');

      const date2 = new Date(2024, 11, 25, 10, 13, 0); // 10:13
      expect(getTimeRoundedToStep(date2)).toBe('10:15');
    });

    it('should round time to custom step', () => {
      const date = new Date(2024, 11, 25, 10, 22, 0); // 10:22
      expect(getTimeRoundedToStep(date, 30)).toBe('10:30');
    });
  });

  describe('isFutureDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-25T15:00:00.000Z')); // Dec 25, 10:00 in Rapa Nui
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for a future date', () => {
      expect(isFutureDate('2024-12-26')).toBe(true);
    });

    it('should return false for today', () => {
      expect(isFutureDate('2024-12-25')).toBe(false);
    });

    it('should return false for a past date', () => {
      expect(isFutureDate('2024-12-24')).toBe(false);
    });
  });

  describe('parseISODate', () => {
    it('should return a Date object for a valid ISO string', () => {
      const result = parseISODate('2024-12-25');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
    });

    it('should return null for invalid date string', () => {
      expect(parseISODate('invalid')).toBeNull();
    });

    it('should return null if no date is provided', () => {
      expect(parseISODate()).toBeNull();
    });
  });

  describe('isBusinessDay', () => {
    it('should return true for a regular business day', () => {
      // Dec 26, 2024 is Thursday
      expect(isBusinessDay('2024-12-26')).toBe(true);
    });

    it('should return false for a weekend', () => {
      // Dec 28, 2024 is Saturday
      expect(isBusinessDay('2024-12-28')).toBe(false);
      // Dec 29, 2024 is Sunday
      expect(isBusinessDay('2024-12-29')).toBe(false);
    });

    it('should return false for a holiday', () => {
      // Dec 25, 2024 is Christmas (holiday)
      expect(isBusinessDay('2024-12-25')).toBe(false);
    });
  });

  describe('getShiftSchedule', () => {
    it('should return correct schedule for a regular business day', () => {
      // Dec 26, 2024 (Thursday, biz) -> Dec 27 (Friday, biz)
      const schedule = getShiftSchedule('2024-12-26');
      expect(schedule.dayStart).toBe('08:00');
      expect(schedule.nightEnd).toBe('08:00');
      expect(schedule.description).toBe('Día Hábil');
    });

    it('should return holiday schedule if today is a holiday', () => {
      // Dec 25, 2024 (Holiday)
      const schedule = getShiftSchedule('2024-12-25');
      expect(schedule.dayStart).toBe('09:00');
    });

    it('should adjust nightEnd if tomorrow is not a business day', () => {
      // Dec 27, 2024 (Friday, biz) -> Dec 28 (Saturday, no biz)
      const schedule = getShiftSchedule('2024-12-27');
      expect(schedule.nightEnd).toBe('09:00');
      expect(schedule.description).toContain('→ No Hábil');
    });

    it('should adjust nightEnd if tomorrow is a business day', () => {
      // Dec 29, 2024 (Sunday, no biz) -> Dec 30 (Monday, biz)
      const schedule = getShiftSchedule('2024-12-29');
      expect(schedule.nightEnd).toBe('08:00');
      expect(schedule.description).toContain('→ Día Hábil');
    });
  });

  describe('resolveClinicalDayBounds', () => {
    it('should resolve next day and configured night cutoff for a record date', () => {
      const bounds = resolveClinicalDayBounds('2024-12-27');
      expect(bounds.dayStart).toBe('08:00');
      expect(bounds.dayStartMinutes).toBe(8 * 60);
      expect(bounds.nextDay).toBe('2024-12-28');
      expect(bounds.nightEnd).toBe('09:00');
      expect(bounds.nightEndMinutes).toBe(9 * 60);
    });
  });

  describe('resolveClinicalDayForDateTime', () => {
    it('assigns early-morning admissions to the previous clinical day', () => {
      expect(resolveClinicalDayForDateTime('2026-03-11', '02:00')).toBe('2026-03-10');
      expect(resolveClinicalDayForDateTime('2026-03-11', '07:59')).toBe('2026-03-10');
      expect(resolveClinicalDayForDateTime('2026-03-11', '08:00')).toBe('2026-03-11');
    });

    it('uses 09:00 as clinical-day start on non-business days', () => {
      expect(resolveClinicalDayForDateTime('2024-12-28', '08:59')).toBe('2024-12-27');
      expect(resolveClinicalDayForDateTime('2024-12-28', '09:00')).toBe('2024-12-28');
    });
  });

  describe('resolveCurrentClinicalDay', () => {
    it('uses the Rapa Nui weekday cutoff independently of the browser time zone', () => {
      expect(resolveCurrentClinicalDay(new Date('2026-04-22T12:59:00.000Z'))).toBe('2026-04-21');
      expect(resolveCurrentClinicalDay(new Date('2026-04-22T14:00:00.000Z'))).toBe('2026-04-22');
    });

    it('uses the previous clinical day before the non-business 09:00 cutoff', () => {
      expect(resolveCurrentClinicalDay(new Date('2024-12-28T13:59:00.000Z'))).toBe('2024-12-27');
      expect(resolveCurrentClinicalDay(new Date('2024-12-28T14:00:00.000Z'))).toBe('2024-12-28');
    });

    it('does not advance with a mainland Chile browser before the Rapa Nui handoff', () => {
      expect(resolveCurrentClinicalDay(new Date('2026-09-10T12:33:35.000Z'))).toBe('2026-09-09');
      expect(resolveCurrentClinicalDay(new Date('2026-09-10T13:00:00.000Z'))).toBe('2026-09-10');
    });
  });

  describe('isNewAdmissionForClinicalDay', () => {
    it('treats admissions on the same record date as new admissions', () => {
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-05', '14:30')).toBe(true);
    });

    it('treats madrugada admissions before the weekday cutoff as new admissions for the previous clinical day', () => {
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-06', '07:59')).toBe(true);
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-06', '08:00')).toBe(false);
    });

    it('does not carry over next-day madrugada admissions into the copied census of the next date', () => {
      expect(isNewAdmissionForClinicalDay('2026-03-10', '2026-03-11', '02:00')).toBe(true);
      expect(isNewAdmissionForClinicalDay('2026-03-11', '2026-03-11', '02:00')).toBe(false);
    });

    it('uses the configured 09:00 cutoff when the next day is not business day', () => {
      expect(isNewAdmissionForClinicalDay('2024-12-27', '2024-12-28', '08:59')).toBe(true);
      expect(isNewAdmissionForClinicalDay('2024-12-27', '2024-12-28', '09:00')).toBe(false);
    });

    it('assigns next-day admissions without time only to the owning previous night shift', () => {
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-06')).toBe(true);
      expect(isNewAdmissionForClinicalDay('2026-03-06', '2026-03-06')).toBe(false);
    });

    it('rejects previous or distant future dates as new admissions for the record day', () => {
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-04', '23:30')).toBe(false);
      expect(isNewAdmissionForClinicalDay('2026-03-05', '2026-03-07', '02:00')).toBe(false);
    });
  });

  describe('isWithinDayShift', () => {
    it('should return true for times during day shift (08:00-20:00)', () => {
      expect(isWithinDayShift('08:00')).toBe(true);
      expect(isWithinDayShift('10:00')).toBe(true);
      expect(isWithinDayShift('15:30')).toBe(true);
      expect(isWithinDayShift('19:59')).toBe(true);
    });

    it('should return false for times during night shift', () => {
      expect(isWithinDayShift('20:00')).toBe(false); // Start of night shift
      expect(isWithinDayShift('22:00')).toBe(false);
      expect(isWithinDayShift('00:00')).toBe(false); // Midnight
      expect(isWithinDayShift('03:00')).toBe(false); // Madrugada
      expect(isWithinDayShift('07:59')).toBe(false); // Just before day shift
    });

    it('should return true for edge cases and missing time', () => {
      expect(isWithinDayShift()).toBe(true); // No time defaults to day
      expect(isWithinDayShift('')).toBe(true);
      expect(isWithinDayShift('invalid')).toBe(true);
    });
  });

  describe('isAdmittedDuringShift', () => {
    const recordDate = '2026-01-03';

    describe('day shift (08:00-20:00)', () => {
      it('should show patients admitted on record date before 20:00', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '10:00', 'day')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '08:00', 'day')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '19:59', 'day')).toBe(true);
      });

      it('should NOT show patients admitted on record date after 20:00', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '20:00', 'day')).toBe(false);
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '22:00', 'day')).toBe(false);
      });

      it('should NOT show patients admitted the next day', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '02:00', 'day')).toBe(false);
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '10:00', 'day')).toBe(false);
      });

      it('should show patients admitted on previous days', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-01', '10:00', 'day')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-02', '22:00', 'day')).toBe(true);
      });

      it('should show patients with no admission date', () => {
        expect(isAdmittedDuringShift(recordDate, undefined, undefined, 'day')).toBe(true);
      });
    });

    describe('night shift (20:00-08:00 next day)', () => {
      it('should show patients admitted on record date at any time', () => {
        // Patients admitted during the day are still there at night
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '10:00', 'night')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '19:00', 'night')).toBe(true);
        // Patients admitted during night shift
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', '22:00', 'night')).toBe(true);
      });

      it('should show patients admitted in madrugada of next day (before 08:00)', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '02:00', 'night')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '07:59', 'night')).toBe(true);
      });

      it('should apply the configured night cutoff for next-day admissions', () => {
        // recordDate = 2026-01-03 (sábado) => next day no hábil => corte 09:00
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '08:00', 'night')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', '09:00', 'night')).toBe(false);

        // Día hábil normal => corte 08:00
        expect(isAdmittedDuringShift('2026-01-05', '2026-01-06', '08:00', 'night')).toBe(false);
      });

      it('should show patients admitted on previous days', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-01', '22:00', 'night')).toBe(true);
      });

      it('should show patients with no admission date', () => {
        expect(isAdmittedDuringShift(recordDate, undefined, undefined, 'night')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle missing admission time conservatively for night visibility', () => {
        expect(isAdmittedDuringShift(recordDate, '2026-01-03', undefined, 'day')).toBe(true);
        expect(isAdmittedDuringShift(recordDate, '2026-01-04', undefined, 'night')).toBe(true);
      });

      it('should handle cross-month scenarios', () => {
        expect(isAdmittedDuringShift('2026-01-31', '2026-02-01', '03:00', 'night')).toBe(true);
        expect(isAdmittedDuringShift('2026-01-31', '2026-02-01', '10:00', 'night')).toBe(false);
      });

      it('should support ISO datetime admissionDate values in night shift filtering', () => {
        expect(
          isAdmittedDuringShift('2026-02-14', '2026-02-15T00:00:00.000Z', '02:00', 'night')
        ).toBe(true);
      });

      it('should respect dynamic night end schedule (09:00 on non-business next day)', () => {
        // 2026-02-14 is Saturday, next day is Sunday => night ends at 09:00
        expect(isAdmittedDuringShift('2026-02-14', '2026-02-15', '08:30', 'night')).toBe(true);
        expect(isAdmittedDuringShift('2026-02-14', '2026-02-15', '09:00', 'night')).toBe(false);
      });
    });
  });

  describe('calculateHospitalizedDays', () => {
    it('should return 1 for same day admission', () => {
      expect(calculateHospitalizedDays('2024-12-10', '2024-12-10')).toBe(1);
    });

    it('should return 2 for next day', () => {
      expect(calculateHospitalizedDays('2024-12-10', '2024-12-11')).toBe(2);
    });

    it('should return 1 even if current date is before admission (safety)', () => {
      expect(calculateHospitalizedDays('2024-12-11', '2024-12-10')).toBe(1);
    });

    it('should return 31 for one month difference', () => {
      expect(calculateHospitalizedDays('2024-03-01', '2024-03-31')).toBe(31);
    });

    it('should return null if any date is missing', () => {
      expect(calculateHospitalizedDays(undefined, '2024-12-10')).toBeNull();
      expect(calculateHospitalizedDays('2024-12-10', undefined)).toBeNull();
    });

    it('should handle full ISO strings with time', () => {
      expect(calculateHospitalizedDays('2024-12-10T10:00:00Z', '2024-12-11T15:00:00Z')).toBe(2);
    });

    it('should return null on catch (invalid split/data)', () => {
      // Force a crash type in calculateHospitalizedDays by passing non-string that .split fails on
      // but the type is string, so we use 'any'
      expect(calculateHospitalizedDays(null as unknown as string, '2024-12-10')).toBeNull();
    });
  });

  describe('calculateDischargeStayDays', () => {
    it('should return 1 for same-day discharge stays', () => {
      expect(calculateDischargeStayDays('2024-12-10', '2024-12-10')).toBe(1);
    });

    it('should use discharge minus admission dates for DEIS stays', () => {
      expect(calculateDischargeStayDays('2024-12-10', '2024-12-11')).toBe(1);
      expect(calculateDischargeStayDays('2024-12-10', '2024-12-12')).toBe(2);
      expect(calculateDischargeStayDays('2026-01-23', '2026-01-26')).toBe(3);
    });

    it('should accept DD-MM-YYYY values used by the IEEH flow', () => {
      expect(calculateDischargeStayDays('23-01-2026', '26-01-2026')).toBe(3);
    });

    it('should exclude invalid chronology instead of forcing 1 day', () => {
      expect(calculateDischargeStayDays('2024-12-11', '2024-12-10')).toBeNull();
    });

    it('should return null if dates are missing or invalid', () => {
      expect(calculateDischargeStayDays(undefined, '2024-12-10')).toBeNull();
      expect(calculateDischargeStayDays('2024-12-10', undefined)).toBeNull();
      expect(calculateDischargeStayDays('invalid', '2024-12-10')).toBeNull();
    });
  });

  describe('isAdmittedDuringShift - Additional cases', () => {
    const recordDate = '2026-01-03';
    it('should handle weird time strings in isAdmittedDuringShift', () => {
      // Line 352 cases: isNaN(admHour) or isNaN(admMinute)
      expect(isAdmittedDuringShift(recordDate, recordDate, 'XX:YY', 'day')).toBe(true);
      expect(isAdmittedDuringShift(recordDate, recordDate, '10:XX', 'day')).toBe(true);
    });

    it('should return false for patients admitted far in the future', () => {
      expect(isAdmittedDuringShift(recordDate, '2026-01-10', '10:00', 'day')).toBe(false);
      expect(isAdmittedDuringShift(recordDate, '2026-01-10', '10:00', 'night')).toBe(false);
    });
  });
});
