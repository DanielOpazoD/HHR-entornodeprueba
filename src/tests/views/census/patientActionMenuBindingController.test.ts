// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolvePatientActionMenuBinding } from '@/features/census/controllers/patientActionMenuBindingController';

describe('patientActionMenuBindingController', () => {
  it('builds an explicit action menu binding with availability and indicators', () => {
    const binding = resolvePatientActionMenuBinding({
      align: 'bottom',
      isBlocked: false,
      readOnly: false,
      hasHistoryAction: true,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: false,
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: true,
      },
    });

    expect(binding.align).toBe('bottom');
    expect(binding.showCmaAction).toBe(true);
    expect(binding.indicators).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: true,
    });
    expect(binding.availability.showClinicalDocumentsAction).toBe(true);
    expect(binding.availability.showImagingRequestAction).toBe(false);
  });
});
