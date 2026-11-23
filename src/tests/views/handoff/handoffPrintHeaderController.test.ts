// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolvePrintableShiftLabel,
  resolvePrintableStaffList,
} from '@/features/handoff/components/HandoffPrintHeader';

describe('handoffPrintHeaderController', () => {
  it('builds a printable shift label from schedule bounds', () => {
    expect(
      resolvePrintableShiftLabel('day', {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      })
    ).toBe('Turno Largo (08:00 - 20:00)');
  });

  it('normalizes printable staff lists and reports fallback state', () => {
    expect(resolvePrintableStaffList(['Ana', '', 'Luis'], 'Sin especificar')).toEqual({
      text: 'Ana, Luis',
      isFallback: false,
    });
    expect(resolvePrintableStaffList([], 'Sin especificar')).toEqual({
      text: 'Sin especificar',
      isFallback: true,
    });
  });
});
