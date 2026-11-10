import { describe, expect, it, vi } from 'vitest';

import { canEditCudyrForDate } from '@/shared/access/operationalAccessPolicy';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';
import { resolveCudyrEligibility } from '@/features/cudyr/controllers/cudyrEligibilityController';

describe('CUDYR clinical-day access + patient eligibility', () => {
  it('keeps the record editable in the overnight clinical window but still blocks a same-day admission under 8 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));

    expect(
      canEditCudyrForDate({
        role: 'nurse_hospital',
        readOnly: false,
        recordDate: '2026-04-21',
        todayISO: resolveCurrentClinicalDay(),
      })
    ).toBe(true);

    expect(
      resolveCudyrEligibility({
        recordDate: '2026-04-21',
        patientName: 'Paciente reciente',
        admissionDate: '2026-04-21',
        admissionTime: '17:01',
      })
    ).toMatchObject({
      isEligible: false,
      isBlocked: true,
    });

    vi.useRealTimers();
  });

  it('allows a same-day admission exactly at the 8-hour cutoff while the record remains editable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));

    expect(
      canEditCudyrForDate({
        role: 'nurse_hospital',
        readOnly: false,
        recordDate: '2026-04-21',
        todayISO: resolveCurrentClinicalDay(),
      })
    ).toBe(true);

    expect(
      resolveCudyrEligibility({
        recordDate: '2026-04-21',
        patientName: 'Paciente 17:00',
        admissionDate: '2026-04-21',
        admissionTime: '17:00',
      })
    ).toMatchObject({
      isEligible: true,
      isBlocked: false,
    });

    vi.useRealTimers();
  });
});
