// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveDayShiftNurses,
  normalizeUnknownDailyRecordStaffing,
  resolveNightShiftNurses,
  resolveShiftNurseSignature,
} from '@/services/staff/dailyRecordStaffing';
import {
  resolveExportableNursesText,
  resolvePresentedNightShiftNurses,
} from '@/services/staff/dailyRecordStaffingPresentation';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-03-06',
    patients: [],
    beds: {},
    previousDayPatients: [],
    totalBeds: 0,
    availableBeds: 0,
    occupiedBeds: 0,
    reservedBeds: 0,
    wardStats: {},
    transferStats: {},
    shift: 'day',
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    ...overrides,
  }) as DailyRecord;

describe('dailyRecordStaffing', () => {
  it('prefers canonical day and night shift staffing', () => {
    const record = buildRecord({
      nursesDayShift: [' Ana ', 'Berta'],
      nursesNightShift: ['Claudia', ''],
      nurses: ['Legacy Day'],
      nurseName: 'Legacy Principal',
    });

    expect(resolveDayShiftNurses(record)).toEqual(['Ana', 'Berta']);
    expect(resolveNightShiftNurses(record)).toEqual(['Claudia']);
    expect(resolveExportableNursesText(record)).toBe('Ana & Berta');
  });

  it('promotes legacy day staff when canonical fields are empty', () => {
    const record = buildRecord({
      nursesDayShift: ['', ''],
      nurses: [' Legacy A ', 'Legacy B'],
      nurseName: 'Legacy Principal',
    });

    expect(resolveDayShiftNurses(record)).toEqual(['Legacy A', 'Legacy B']);
  });

  it('falls back between shifts for nurse signature text', () => {
    const record = buildRecord({
      nursesDayShift: ['Ana'],
      nursesNightShift: [''],
    });

    expect(resolveShiftNurseSignature(record, 'night')).toBe('Ana');
    expect(resolveShiftNurseSignature(record, 'day')).toBe('Ana');
  });

  it('uses legacy nurseName when no array data is available', () => {
    const record = buildRecord({
      nursesDayShift: ['', ''],
      nurses: [],
      nurseName: 'Enfermera Legacy',
    });

    expect(resolveDayShiftNurses(record)).toEqual(['Enfermera Legacy']);
  });

  it('normalizes vacancy markers in exportable staffing text for legacy and detailed staffing', () => {
    const legacyRecord = buildRecord({
      nursesDayShift: [' Ana ', '--'],
    });
    const detailedRecord = buildRecord({
      date: '2026-04-18',
      nursesDayShift: ['Ana', 'Legacy Slot'],
      staffingDetailsV1: {
        day: {
          nurses: [
            {
              id: 'day-nurse-standard-0',
              name: 'Ana',
              role: 'nurse',
              slotType: 'standard',
              standardSlotIndex: 0,
              startTime: '09:00',
              endTime: '20:00',
            },
            {
              id: 'day-nurse-standard-1',
              name: '--',
              role: 'nurse',
              slotType: 'standard',
              standardSlotIndex: 1,
              startTime: '09:00',
              endTime: '20:00',
            },
          ],
          tens: [],
        },
        night: {
          nurses: [],
          tens: [],
        },
      },
    });

    expect(resolveExportableNursesText(legacyRecord)).toBe('Ana & Vacante');
    expect(resolveExportableNursesText(detailedRecord)).toBe('Ana & Vacante');
  });

  it('normalizes vacancy markers in presented night-shift staffing', () => {
    const canonicalRecord = buildRecord({
      nursesNightShift: [' Carla ', '--'],
    });
    const detailedRecord = buildRecord({
      date: '2026-04-18',
      nursesNightShift: ['Carla', '--'],
      staffingDetailsV1: {
        day: {
          nurses: [],
          tens: [],
        },
        night: {
          nurses: [
            {
              id: 'night-nurse-standard-0',
              name: 'Carla',
              role: 'nurse',
              slotType: 'standard',
              standardSlotIndex: 0,
              startTime: '20:00',
              endTime: '09:00',
            },
            {
              id: 'night-nurse-standard-1',
              name: '',
              role: 'nurse',
              slotType: 'standard',
              standardSlotIndex: 1,
              startTime: '20:00',
              endTime: '09:00',
            },
          ],
          tens: [],
        },
      },
    });

    expect(resolvePresentedNightShiftNurses(canonicalRecord)).toEqual(['Carla', 'Vacante']);
    expect(resolvePresentedNightShiftNurses(detailedRecord)).toEqual(['Carla', 'Vacante']);
  });

  it('normalizes unknown storage payloads into canonical staffing with legacy compatibility', () => {
    const normalized = normalizeUnknownDailyRecordStaffing(
      {
        nurses: { '0': ' Legacy A ', '1': 'Legacy B' },
        nurseName: 'Legacy Principal',
        nursesDayShift: ['', ''],
        nursesNightShift: { '0': ' Noche 1 ' },
      },
      value =>
        Array.isArray(value)
          ? value.map(item => String(item ?? ''))
          : value && typeof value === 'object'
            ? [
                String((value as Record<string, unknown>)['0'] ?? ''),
                String((value as Record<string, unknown>)['1'] ?? ''),
              ]
            : ['', '']
    );

    expect(normalized.nursesDayShift).toEqual(['Legacy A', 'Legacy B']);
    expect(normalized.nurses).toEqual(['Legacy A', 'Legacy B']);
    expect(normalized.nursesNightShift).toEqual(['Noche 1']);
  });
});
