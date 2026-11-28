// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildDetailedStaffingPatch,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { resolvePresentedDayShiftNurses } from '@/services/staff/dailyRecordStaffingPresentation';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { resolveStaffSelectorsState } from '@/features/census/controllers/censusStaffHeaderController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const DATE = '2026-11-16';

/** The census grid edit: slot 1 left empty, Ana Pérez chosen in slot 2. */
const dayWithAnaInSlotTwo = (): DailyRecord => {
  const base = DataFactory.createMockDailyRecord(DATE, {
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
  });
  const detail = resolveDetailedStaffingState(base, DATE);
  const patch = buildDetailedStaffingPatch(
    updateDetailedStaffingStandardSlot(detail, 'day', 'nurse', 1, 'Ana Pérez')
  );
  return { ...base, ...patch } as DailyRecord;
};

const fromFirestore = (record: DailyRecord): DailyRecord =>
  docToRecord(JSON.parse(JSON.stringify(record)) as Record<string, unknown>, DATE);

describe('a nurse saved in the second slot', () => {
  it.each([
    [
      'after saving on this computer',
      (record: DailyRecord) => validateAndSalvageRecord(record, DATE),
    ],
    ['when another computer reads it from Firestore', fromFirestore],
  ])('stays in slot 2 of the census grid and the Excel %s', (_, read) => {
    const record = read(dayWithAnaInSlotTwo());

    expect(resolveStaffSelectorsState(record).nursesDayShift).toEqual(['', 'Ana Pérez']);
    expect(resolvePresentedDayShiftNurses(record)).toEqual(['Vacante', 'Ana Pérez']);
  });

  it('is not copied into slot 1 when someone later edits another staff slot', () => {
    const record = fromFirestore(dayWithAnaInSlotTwo());
    const nextEdit = buildDetailedStaffingPatch(
      updateDetailedStaffingStandardSlot(
        resolveDetailedStaffingState(record, DATE),
        'night',
        'tens',
        0,
        'Rosa'
      )
    );

    expect(nextEdit.nursesDayShift).toEqual(['', 'Ana Pérez']);
    expect(nextEdit.staffingDetailsV1?.day.nurses.map(slot => slot.name)).toEqual([
      '',
      'Ana Pérez',
    ]);
  });

  it('keeps its slot in a list written before the detailed grid existed', () => {
    const legacy = DataFactory.createMockDailyRecord(DATE, {
      nurses: ['', 'Ana Pérez'],
      nursesDayShift: ['', 'Ana Pérez'],
      nursesNightShift: ['', 'Ñusta Tuki'],
    });
    delete (legacy as Partial<DailyRecord>).staffingDetailsV1;

    const grid = resolveStaffSelectorsState(fromFirestore(legacy));
    expect(grid.nursesDayShift).toEqual(['', 'Ana Pérez']);
    expect(grid.nursesNightShift).toEqual(['', 'Ñusta Tuki']);
  });
});

describe('a day read from Firestore whose staff list carries an item that is not text', () => {
  it.each([7, false, { name: 'x' }])('opens, and %j only empties its own slot', damaged => {
    const stored = JSON.parse(JSON.stringify(DataFactory.createMockDailyRecord(DATE))) as Record<
      string,
      unknown
    >;

    const record = docToRecord(
      {
        ...stored,
        nursesDayShift: [damaged, 'Ana Pérez'],
        nursesNightShift: ['Ñusta Tuki', damaged],
        tensDayShift: [damaged, 'Rosa', 'María José'],
      },
      DATE
    );

    const grid = resolveStaffSelectorsState(record);
    expect(grid.nursesDayShift).toEqual(['', 'Ana Pérez']);
    expect(grid.nursesNightShift).toEqual(['Ñusta Tuki', '']);
    expect(grid.tensDayShift).toEqual(['', 'Rosa', 'María José']);
  });
});
