import { describe, expect, it } from 'vitest';
import {
  resolvePatientActionMenuPanelClassName,
  resolvePatientActionMenuViewState,
} from '@/features/census/controllers/patientActionMenuViewController';

describe('patientActionMenuViewController', () => {
  it('shows all interactive actions for editable, unblocked rows', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: false,
      hasHistoryAction: true,
      hasExamRequestAction: true,
    });

    expect(view).toEqual({
      showDemographicsAction: true,
      showMenuTrigger: true,
      showHistoryAction: true,
      showClinicalSection: true,
      showExamRequestAction: true,
    });
  });

  it('hides clinical exam-request action when bed is blocked', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: true,
      readOnly: false,
      hasHistoryAction: true,
      hasExamRequestAction: true,
    });

    expect(view.showDemographicsAction).toBe(false);
    expect(view.showMenuTrigger).toBe(true);
    expect(view.showHistoryAction).toBe(true);
    expect(view.showClinicalSection).toBe(false);
    expect(view.showExamRequestAction).toBe(false);
  });

  it('hides trigger and demographics in read-only mode', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: true,
      hasHistoryAction: false,
      hasExamRequestAction: true,
    });

    expect(view.showDemographicsAction).toBe(false);
    expect(view.showMenuTrigger).toBe(false);
    expect(view.showHistoryAction).toBe(false);
    expect(view.showClinicalSection).toBe(false);
    expect(view.showExamRequestAction).toBe(false);
  });

  it('resolves panel anchor class from row menu alignment', () => {
    expect(resolvePatientActionMenuPanelClassName('top')).toBe('top-0');
    expect(resolvePatientActionMenuPanelClassName('bottom')).toBe('bottom-0');
  });
});
