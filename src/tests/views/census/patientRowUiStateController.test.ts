// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildPatientRowUiStateVisibility,
  resolvePatientRowModalCloseState,
} from '@/features/census/controllers/patientRowUiStateController';

describe('patientRowUiStateController', () => {
  it('derives visibility from the active modal', () => {
    expect(buildPatientRowUiStateVisibility('examRequest')).toEqual({
      showDemographics: false,
      showClinicalDocuments: false,
      showExamRequest: true,
      showImagingRequest: false,
      showHistory: false,
    });
  });

  it('only closes the matching modal', () => {
    expect(resolvePatientRowModalCloseState('history', 'history')).toBeNull();
    expect(resolvePatientRowModalCloseState('history', 'demographics')).toBe('history');
  });
});
