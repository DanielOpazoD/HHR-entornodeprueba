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
        showClinicalSection: true,
        showExamRequestAction: false,
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
    });

    expect(model.showHistoryAction).toBe(true);
    expect(model.showClinicalSection).toBe(true);
    expect(model.showExamRequestAction).toBe(false);
    expect(model.utilityActions.map(action => action.action)).toEqual(['clear']);
    expect(model.clinicalActions.map(action => action.action)).toEqual([
      'discharge',
      'transfer',
      'cma',
    ]);
  });
});
