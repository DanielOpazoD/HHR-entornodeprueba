import { describe, it, expect } from 'vitest';
import { isHoliday, isWeekend, isNonWorkingDay, isWorkingDay } from '@/services/admin/calendarService';

describe('calendarService', () => {
    it('should identify holidays', () => {
        const holiday = new Date('2025-01-01T12:00:00');
        expect(isHoliday(holiday)).toBe(true);

        const regularDay = new Date('2025-01-02T12:00:00');
        expect(isHoliday(regularDay)).toBe(false);
    });

    it('should identify weekends', () => {
        const saturday = new Date('2025-01-04T12:00:00');
        expect(isWeekend(saturday)).toBe(true);

        const sunday = new Date('2025-01-05T12:00:00');
        expect(isWeekend(sunday)).toBe(true);

        const monday = new Date('2025-01-06T12:00:00');
        expect(isWeekend(monday)).toBe(false);
    });

    it('should identify non-working days', () => {
        const holiday = new Date('2025-01-01T12:00:00');
        expect(isNonWorkingDay(holiday)).toBe(true);

        const saturday = new Date('2025-01-04T12:00:00');
        expect(isNonWorkingDay(saturday)).toBe(true);

        const monday = new Date('2025-01-06T12:00:00');
        expect(isNonWorkingDay(monday)).toBe(false);
    });

    it('should identify working days', () => {
        const monday = new Date('2025-01-06T12:00:00');
        expect(isWorkingDay(monday)).toBe(true);

        const holiday = new Date('2025-01-01T12:00:00');
        expect(isWorkingDay(holiday)).toBe(false);
    });
});
