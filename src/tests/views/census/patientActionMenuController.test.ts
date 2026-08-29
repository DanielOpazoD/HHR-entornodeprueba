import { describe, expect, it, vi } from 'vitest';

import {
  buildPatientActionMenuModel,
  resolvePatientActionMenuCallbackAvailability,
  resolvePatientActionMenuDemographicsInteraction,
} from '@/features/census/controllers/patientActionMenuController';

describe('patientActionMenuController', () => {
  it('derives callback availability from optional handlers', () => {
    expect(
      resolvePatientActionMenuCallbackAvailability({
        onViewHistory: vi.fn(),
        onViewClinicalDocuments: undefined,
        onViewExamRequest: vi.fn(),
        onViewImagingRequest: undefined,
      })
    ).toEqual({
      hasHistoryAction: true,
      hasClinicalDocumentsAction: false,
      hasExamRequestAction: true,
      hasImagingRequestAction: false,
      hasMedicalIndicationsAction: false,
    });
  });

  it('disables demographics opening for specialist access while preserving it for default access', () => {
    const onViewDemographics = vi.fn();

    expect(
      resolvePatientActionMenuDemographicsInteraction({
        accessProfile: 'specialist',
        onViewDemographics,
      })
    ).toBeUndefined();

    expect(
      resolvePatientActionMenuDemographicsInteraction({
        accessProfile: 'default',
        onViewDemographics,
      })
    ).toBe(onViewDemographics);
  });

  it('builds a full action-menu model from row state and callback availability', () => {
    const model = buildPatientActionMenuModel({
      align: 'bottom',
      isBlocked: true,
      readOnly: false,
      showCmaAction: false,
      indicators: {
        hasClinicalDocument: true,
        isNewAdmission: true,
      },
      callbackAvailability: {
        hasHistoryAction: true,
        hasClinicalDocumentsAction: true,
        hasExamRequestAction: true,
        hasImagingRequestAction: false,
      },
    });

    expect(model.binding.align).toBe('bottom');
    expect(model.binding.indicators).toEqual({
      hasClinicalDocument: true,
      isNewAdmission: true,
    });
    expect(model.binding.availability.showClinicalDocumentsAction).toBe(false);
    expect(model.utilityActions.map(action => action.action)).toEqual(['clear']);
  });

  it('hides utility actions for specialist access even when the row is editable', () => {
    const model = buildPatientActionMenuModel({
      isBlocked: false,
      readOnly: false,
      accessProfile: 'specialist',
      callbackAvailability: {
        hasHistoryAction: false,
        hasClinicalDocumentsAction: true,
        hasExamRequestAction: true,
        hasImagingRequestAction: true,
      },
    });

    expect(model.utilityActions).toEqual([]);
  });

  it('limits utility actions to the explicitly allowed subset', () => {
    const model = buildPatientActionMenuModel({
      isBlocked: false,
      readOnly: false,
      allowedActions: ['clear'],
      callbackAvailability: {
        hasHistoryAction: true,
        hasClinicalDocumentsAction: false,
        hasExamRequestAction: false,
        hasImagingRequestAction: false,
      },
    });

    expect(model.utilityActions.map(action => action.action)).toEqual(['clear']);
  });
});
