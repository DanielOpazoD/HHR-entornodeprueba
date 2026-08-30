import { describe, expect, it } from 'vitest';
import { Trash2 } from 'lucide-react';
import { resolvePatientActionMenuPanelModel } from '@/features/census/controllers/patientActionMenuPanelController';

describe('patientActionMenuPanelController', () => {
  it('maps view state and keeps provided utility actions', () => {
    const model = resolvePatientActionMenuPanelModel({
      viewState: {
        showDemographicsAction: true,
        showMenuTrigger: true,
        showHistoryAction: true,
        showUtilityActions: true,
        showClinicalSection: true,
        showBuiltInClinicalActions: true,
        showClinicalDocumentsAction: true,
        showExamRequestAction: false,
        showImagingRequestAction: true,
        showMedicalIndicationsAction: false,
      },
      utilityActions: [
        {
          action: 'clear',
          label: 'Limpiar',
          title: 'Borrar datos',
          icon: Trash2,
          iconClassName: 'x',
          visibleWhenBlocked: true,
        },
      ],
      showCmaAction: true,
    });

    expect(model.showHistoryAction).toBe(true);
    expect(model.showUtilityActions).toBe(true);
    expect(model.utilityActions.map(action => action.action)).toEqual(['clear']);
    expect(model.clinicalActions.map(action => action.action)).toEqual([
      'discharge',
      'transfer',
      'cma',
    ]);
  });

  it('hides CMA action when the binding marks it as not applicable', () => {
    const model = resolvePatientActionMenuPanelModel({
      viewState: {
        showDemographicsAction: true,
        showMenuTrigger: true,
        showHistoryAction: true,
        showUtilityActions: true,
        showClinicalSection: true,
        showBuiltInClinicalActions: true,
        showClinicalDocumentsAction: true,
        showExamRequestAction: true,
        showImagingRequestAction: true,
        showMedicalIndicationsAction: false,
      },
      utilityActions: [],
      showCmaAction: false,
    });

    expect(model.clinicalActions.map(action => action.action)).toEqual(['discharge', 'transfer']);
  });

  it('removes built-in clinical actions for specialist census access', () => {
    const model = resolvePatientActionMenuPanelModel({
      viewState: {
        showDemographicsAction: false,
        showMenuTrigger: true,
        showHistoryAction: false,
        showUtilityActions: false,
        showClinicalSection: true,
        showBuiltInClinicalActions: false,
        showClinicalDocumentsAction: true,
        showExamRequestAction: true,
        showImagingRequestAction: true,
        showMedicalIndicationsAction: false,
      },
      utilityActions: [],
      showCmaAction: true,
    });

    expect(model.clinicalActions).toEqual([]);
  });

  it('does not expose built-in clinical actions outside the allowed subset', () => {
    const model = resolvePatientActionMenuPanelModel({
      viewState: {
        showDemographicsAction: true,
        showMenuTrigger: true,
        showHistoryAction: true,
        showUtilityActions: true,
        showClinicalSection: true,
        showBuiltInClinicalActions: true,
        showClinicalDocumentsAction: false,
        showExamRequestAction: false,
        showImagingRequestAction: false,
        showMedicalIndicationsAction: false,
      },
      utilityActions: [],
      allowedActions: ['clear'],
    });

    expect(model.clinicalActions).toEqual([]);
  });
});
