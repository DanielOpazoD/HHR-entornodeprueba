import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import {
  calculateDailySnapshot,
  filterRecordsByDateRange,
  generateDailyTrend,
  getDateRangeFromPreset,
} from '@/services/calculations/minsalStatsCalculator';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

import { createMockRecord, parseIsoDateLocal } from './minsalStatsCalculatorTestSupport';

describe('minsalStatsCalculator ranges and snapshots', () => {
  describe('getDateRangeFromPreset', () => {
    it('should return today for "today" preset', () => {
      const result = getDateRangeFromPreset('today');
      expect(result.startDate).toBe(result.endDate);
    });

    it('should return 7 days range for "last7days" preset', () => {
      const result = getDateRangeFromPreset('last7days');
      const start = new Date(result.startDate);
      const end = new Date(result.endDate);
      const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(days).toBe(7);
    });

    it('should use custom dates when preset is "custom"', () => {
      const result = getDateRangeFromPreset('custom', '2026-01-01', '2026-01-15');
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-01-15');
    });

    it('should return valid date range for "lastMonth" preset', () => {
      const result = getDateRangeFromPreset('lastMonth');
      const start = new Date(result.startDate);
      const end = new Date(result.endDate);
      const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(days).toBe(30);
    });

    it('should return month-to-date range for "currentMonth" preset', () => {
      const result = getDateRangeFromPreset('currentMonth');
      const start = parseIsoDateLocal(result.startDate);
      const end = parseIsoDateLocal(result.endDate);

      expect(start.getDate()).toBe(1);
      expect(start.getMonth()).toBe(end.getMonth());
      expect(start.getFullYear()).toBe(end.getFullYear());
      expect(result.startDate <= result.endDate).toBe(true);
    });

    it('should use selected month in current year for "currentMonth" preset', () => {
      const now = new Date('2026-02-20T00:00:00.000Z');
      const selectedMonth = now.getMonth() === 0 ? 1 : now.getMonth();
      const result = getDateRangeFromPreset('currentMonth', undefined, undefined, selectedMonth);
      const start = parseIsoDateLocal(result.startDate);
      const end = parseIsoDateLocal(result.endDate);

      expect(start.getMonth()).toBe(selectedMonth - 1);
      expect(start.getDate()).toBe(1);

      if (selectedMonth === now.getMonth() + 1) {
        expect(end.getDate()).toBe(now.getDate());
      } else {
        const expectedMonthEnd = new Date(now.getFullYear(), selectedMonth, 0).getDate();
        expect(end.getDate()).toBe(expectedMonthEnd);
      }
    });

    it('should return year-to-date range for "yearToDate" preset', () => {
      const result = getDateRangeFromPreset('yearToDate');
      const start = parseIsoDateLocal(result.startDate);
      const end = parseIsoDateLocal(result.endDate);

      expect(start.getDate()).toBe(1);
      expect(start.getMonth()).toBe(0);
      expect(start.getFullYear()).toBe(end.getFullYear());
      expect(result.startDate <= result.endDate).toBe(true);
    });

    it('should return valid date range for "last3Months" preset', () => {
      const result = getDateRangeFromPreset('last3Months');
      const start = new Date(result.startDate);
      const end = new Date(result.endDate);
      expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
    });

    it('should return valid date range for "last6Months" preset', () => {
      const result = getDateRangeFromPreset('last6Months');
      const start = new Date(result.startDate);
      const end = new Date(result.endDate);
      expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
    });

    it('should return valid date range for "last12Months" preset', () => {
      const result = getDateRangeFromPreset('last12Months');
      const start = new Date(result.startDate);
      const end = new Date(result.endDate);
      expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
    });
  });

  describe('filterRecordsByDateRange', () => {
    const records: DailyRecord[] = [
      createMockRecord('2026-01-01'),
      createMockRecord('2026-01-05'),
      createMockRecord('2026-01-10'),
      createMockRecord('2026-01-15'),
    ];

    it('should filter records within date range', () => {
      const result = filterRecordsByDateRange(records, '2026-01-01', '2026-01-10');
      expect(result).toHaveLength(3);
    });

    it('should return empty array when no records match', () => {
      const result = filterRecordsByDateRange(records, '2026-02-01', '2026-02-28');
      expect(result).toHaveLength(0);
    });

    it('should include boundary dates', () => {
      const result = filterRecordsByDateRange(records, '2026-01-05', '2026-01-05');
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-01-05');
    });

    it('should handle all records in range', () => {
      const result = filterRecordsByDateRange(records, '2026-01-01', '2026-01-31');
      expect(result).toHaveLength(4);
    });
  });

  describe('calculateDailySnapshot', () => {
    it('should return valid snapshot structure', () => {
      const record = createMockRecord('2026-01-01', 10);
      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.date).toBe('2026-01-01');
      expect(typeof snapshot.ocupadas).toBe('number');
      expect(typeof snapshot.bloqueadas).toBe('number');
    });

    it('should include date in snapshot', () => {
      const record = createMockRecord('2026-01-15', 8);
      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.date).toBe('2026-01-15');
    });

    it('should count occupied beds', () => {
      const record = createMockRecord('2026-01-01', 5);
      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.ocupadas).toBeGreaterThanOrEqual(0);
    });

    it('should calculate 17/18 as 94.4% when there are no blocked beds', () => {
      const record = createMockRecord('2026-01-01', 17, 0);
      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.ocupadas).toBe(17);
      expect(snapshot.disponibles).toBe(18);
      expect(snapshot.bloqueadas).toBe(0);
      expect(snapshot.tasaOcupacion).toBe(94.4);
    });

    it('should calculate 17/17 as 100% when one bed is blocked', () => {
      const record = createMockRecord('2026-01-01', 17, 1);
      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.ocupadas).toBe(17);
      expect(snapshot.disponibles).toBe(17);
      expect(snapshot.bloqueadas).toBe(1);
      expect(snapshot.tasaOcupacion).toBe(100);
    });

    it('should not count nested clinical crib as an occupied bed for occupancy rate', () => {
      const record = createMockRecord('2026-01-01', 17, 0);
      const bedId = BEDS[0].id;
      const mainBed = record.beds[bedId];

      mainBed.clinicalCrib = {
        bedId,
        isBlocked: false,
        patientName: 'RN Clínico',
        rut: '-',
        pathology: 'Prematuridad',
        specialty: Specialty.PEDIATRIA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-01-01',
        admissionTime: '11:00',
        age: '0',
        bedMode: 'Cuna',
        hasCompanionCrib: false,
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      };

      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.ocupadas).toBe(17);
      expect(snapshot.disponibles).toBe(18);
      expect(snapshot.bloqueadas).toBe(0);
      expect(snapshot.tasaOcupacion).toBe(94.4);
    });

    it('should not count companion crib (RN sano) in occupancy rate', () => {
      const record = createMockRecord('2026-01-01', 17, 0);
      const bedId = BEDS[1].id;
      const mainBed = record.beds[bedId];

      mainBed.hasCompanionCrib = true;

      const snapshot = calculateDailySnapshot(record);
      expect(snapshot.ocupadas).toBe(17);
      expect(snapshot.disponibles).toBe(18);
      expect(snapshot.bloqueadas).toBe(0);
      expect(snapshot.tasaOcupacion).toBe(94.4);
    });

    it('should not count tombstoned discharges or transfers in MINSAL daily movement totals', () => {
      const record = createMockRecord('2026-01-01', 5, 0);
      record.discharges = [
        { id: 'd-active', status: 'Vivo' } as DailyRecord['discharges'][number],
        {
          id: 'd-deleted',
          status: 'Fallecido',
          deletedAt: '2026-01-01T12:00:00.000Z',
        } as DailyRecord['discharges'][number],
      ];
      record.transfers = [
        { id: 't-active' } as DailyRecord['transfers'][number],
        {
          id: 't-deleted',
          deletedAt: '2026-01-01T12:00:00.000Z',
        } as DailyRecord['transfers'][number],
      ];

      const snapshot = calculateDailySnapshot(record);

      expect(snapshot.egresos).toBe(2);
      expect(snapshot.fallecidos).toBe(0);
    });
  });

  describe('generateDailyTrend', () => {
    it('should generate snapshot for each record', () => {
      const records = [
        createMockRecord('2026-01-01', 10),
        createMockRecord('2026-01-02', 12),
        createMockRecord('2026-01-03', 11),
      ];
      const trend = generateDailyTrend(records);
      expect(trend).toHaveLength(3);
    });

    it('should sort by date ascending', () => {
      const records = [
        createMockRecord('2026-01-03', 11),
        createMockRecord('2026-01-01', 10),
        createMockRecord('2026-01-02', 12),
      ];
      const trend = generateDailyTrend(records);
      expect(trend[0].date).toBe('2026-01-01');
      expect(trend[2].date).toBe('2026-01-03');
    });

    it('should return empty array for no records', () => {
      const trend = generateDailyTrend([]);
      expect(trend).toHaveLength(0);
    });

    it('should include snapshot data for each day', () => {
      const records = [createMockRecord('2026-01-01', 5)];
      const trend = generateDailyTrend(records);
      expect(trend[0]).toHaveProperty('ocupadas');
      expect(trend[0]).toHaveProperty('bloqueadas');
      expect(trend[0]).toHaveProperty('date');
    });
  });
});
