// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  getVisibleHandoffBeds,
  hasVisibleHandoffPatients,
  shouldShowHandoffPatient,
} from '@/hooks/controllers/handoffVisibilityController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

describe('handoffVisibilityController', () => {
  const record = {
    date: '2024-12-28',
    beds: {
      R1: { bedId: 'R1', patientName: 'Paciente', admissionDate: '2024-12-27' } as PatientData,
      R2: { bedId: 'R2', patientName: '', isBlocked: true } as PatientData,
      E1: { bedId: 'E1', patientName: '' } as PatientData,
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2024-12-28T08:00:00.000Z',
    activeExtraBeds: ['E1'],
  } as DailyRecord;

  it('filters extra beds based on active extras', () => {
    expect(
      getVisibleHandoffBeds(record, [
        { id: 'R1', isExtra: false },
        { id: 'E1', isExtra: true },
      ])
    ).toEqual([
      { id: 'R1', isExtra: false },
      { id: 'E1', isExtra: true },
    ]);
  });

  it('delegates admission visibility for non-blocked patients', () => {
    const isAdmittedDuringShift = vi.fn().mockReturnValue(true);

    expect(shouldShowHandoffPatient(record, 'R1', 'day', isAdmittedDuringShift)).toBe(true);
    expect(isAdmittedDuringShift).toHaveBeenCalledWith(
      '2024-12-28',
      '2024-12-27',
      undefined,
      'day'
    );
  });

  it('detects visible blocked beds without calling admission logic', () => {
    const isAdmittedDuringShift = vi.fn();
    const shouldShowPatient = vi.fn((bedId: string) =>
      shouldShowHandoffPatient(record, bedId, 'day', isAdmittedDuringShift)
    );

    expect(hasVisibleHandoffPatients(record, [{ id: 'R2' }], shouldShowPatient)).toBe(true);
    expect(isAdmittedDuringShift).not.toHaveBeenCalled();
  });
});
