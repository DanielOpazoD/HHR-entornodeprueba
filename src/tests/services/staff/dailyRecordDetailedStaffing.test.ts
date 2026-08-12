import { describe, expect, it } from 'vitest';
import {
  buildDetailedStaffingPatch,
  createEmptyDetailedStaffing,
  resolveDetailedStaffingState,
  resolveShiftRoleStaffingMeta,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { resolveDetailedStaffingStandardNames } from '@/services/staff/dailyRecordStaffingStandardNames';

describe('dailyRecordDetailedStaffing', () => {
  it('builds detailed staffing from legacy arrays using non-working-day schedules', () => {
    const detail = resolveDetailedStaffingState(
      {
        date: '2026-04-18',
        nursesDayShift: ['Enf 1', 'Enf 2'],
        nursesNightShift: ['Enf N1', 'Enf N2'],
        tensDayShift: ['Tens 1', 'Tens 2', 'Tens 3'],
        tensNightShift: ['Tens N1', 'Tens N2', 'Tens N3'],
      },
      '2026-04-18'
    );

    expect(detail.day.nurses[0]).toMatchObject({
      name: 'Enf 1',
      slotType: 'standard',
      standardSlotIndex: 0,
      startTime: '09:00',
      endTime: '20:00',
    });
    expect(detail.night.tens[0]).toMatchObject({
      name: 'Tens N1',
      startTime: '20:00',
      endTime: '09:00',
    });
  });

  it('builds a backward-compatible patch with standard arrays and detailed staffing', () => {
    const detail = createEmptyDetailedStaffing('2026-04-17');
    detail.day.nurses[0].name = 'Enf Base';
    detail.day.nurses[1].name = 'Enf Parcial';
    detail.day.nurses[1].startTime = '10:00';
    detail.day.tens.push({
      id: 'day-tens-extra-1',
      name: 'Tens Refuerzo',
      role: 'tens',
      slotType: 'extra',
      startTime: '12:00',
      endTime: '20:00',
    });

    const patch = buildDetailedStaffingPatch(detail);
    const meta = resolveShiftRoleStaffingMeta(detail, 'day', 'nurse');
    const tensMeta = resolveShiftRoleStaffingMeta(detail, 'day', 'tens');

    expect(patch.nursesDayShift).toEqual(['Enf Base', 'Enf Parcial']);
    expect(patch.tensDayShift).toEqual(['', '', '']);
    expect(patch.staffingDetailsV1).toEqual(detail);
    expect(meta.hasSpecialSchedule).toBe(true);
    expect(meta.extraCount).toBe(0);
    expect(tensMeta.extraCount).toBe(1);
  });

  it('preserves custom hours when the simple view changes a standard slot name', () => {
    const detail = createEmptyDetailedStaffing('2026-04-17');
    detail.day.nurses[1].name = 'Enf Original';
    detail.day.nurses[1].startTime = '10:00';
    detail.day.nurses[1].endTime = '18:00';

    const updated = updateDetailedStaffingStandardSlot(detail, 'day', 'nurse', 1, 'Enf Reemplazo');

    expect(updated.day.nurses[1]).toMatchObject({
      name: 'Enf Reemplazo',
      startTime: '10:00',
      endTime: '18:00',
    });
  });

  it('ignores fractional standard slot indices when resolving selector names', () => {
    const detail = createEmptyDetailedStaffing('2026-04-17');
    detail.day.nurses.push({
      id: 'day-nurse-invalid-fractional-slot',
      name: 'No debe ocupar una casilla',
      role: 'nurse',
      slotType: 'standard',
      standardSlotIndex: 0.5,
      startTime: '08:00',
      endTime: '20:00',
    });

    expect(resolveDetailedStaffingStandardNames(detail).nursesDayShift).toEqual(['', '']);
  });
});
