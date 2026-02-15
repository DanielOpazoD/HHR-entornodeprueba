import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  buildMoveCopyDateOptions,
  resolveMoveCopyBedOptions,
  resolveMoveCopyBaseDate,
  resolveMoveCopySourceBedName,
} from '@/features/census/controllers/moveCopyModalController';
import { BEDS } from '@/constants';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('moveCopyModalController', () => {
  it('adds days against a domain base date and preserves month/year boundaries', () => {
    expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('builds ayer/hoy/manana options using the provided base date', () => {
    const options = buildMoveCopyDateOptions('2026-02-13');
    expect(options.map(option => option.isoDate)).toEqual([
      '2026-02-12',
      '2026-02-13',
      '2026-02-14',
    ]);
    expect(options.map(option => option.label)).toEqual(['Ayer', 'Hoy', 'Mañana']);
  });

  it('falls back to fallback date when current record date is invalid', () => {
    expect(resolveMoveCopyBaseDate('invalid-date', '2026-02-15')).toBe('2026-02-15');
    expect(resolveMoveCopyBaseDate(undefined, '2026-02-15')).toBe('2026-02-15');
    expect(resolveMoveCopyBaseDate('2026-02-14', '2026-02-15')).toBe('2026-02-14');
  });

  it('resolves source bed name and builds bed options filtering source bed', () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-13', {
      activeExtraBeds: ['E1'],
    });

    expect(resolveMoveCopySourceBedName(BEDS, 'R1')).toBe('R1');
    expect(resolveMoveCopySourceBedName(BEDS, 'UNKNOWN')).toBe('');

    const options = resolveMoveCopyBedOptions({
      allBeds: BEDS,
      currentRecord,
      targetRecord: currentRecord,
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });

    expect(options.some(option => option.id === 'R1')).toBe(false);
    expect(options.some(option => option.id === 'E1')).toBe(true);
    expect(options.some(option => option.id === 'E2')).toBe(false);
    expect(options.find(option => option.id === 'R2')?.isSelected).toBe(true);
  });

  it('marks occupied beds as disabled and free beds as enabled', () => {
    const targetRecord = DataFactory.createMockDailyRecord('2026-02-14', {
      beds: {
        ...DataFactory.createMockDailyRecord('2026-02-14').beds,
        R3: DataFactory.createMockPatient('R3', { patientName: 'Paciente ocupado' }),
      },
    });
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-13');

    const options = resolveMoveCopyBedOptions({
      allBeds: BEDS,
      currentRecord,
      targetRecord,
      sourceBedId: 'R1',
      targetBedId: null,
    });

    expect(options.find(option => option.id === 'R3')).toMatchObject({
      isOccupied: true,
      isDisabled: true,
      statusLabel: 'Ocupada',
    });
    expect(options.find(option => option.id === 'R2')).toMatchObject({
      isOccupied: false,
      isDisabled: false,
      statusLabel: 'Libre',
    });
  });
});
