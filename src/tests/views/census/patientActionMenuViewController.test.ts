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
      accessProfile: 'default',
      hasHistoryAction: true,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: true,
    });

    expect(view).toEqual({
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
    });
  });

  it('hides clinical exam-request action when bed is blocked', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: true,
      readOnly: false,
      accessProfile: 'default',
      hasHistoryAction: true,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: true,
    });

    expect(view.showDemographicsAction).toBe(false);
    expect(view.showMenuTrigger).toBe(true);
    expect(view.showHistoryAction).toBe(true);
    expect(view.showUtilityActions).toBe(true);
    expect(view.showClinicalSection).toBe(false);
    expect(view.showBuiltInClinicalActions).toBe(false);
    expect(view.showClinicalDocumentsAction).toBe(false);
    expect(view.showExamRequestAction).toBe(false);
    expect(view.showImagingRequestAction).toBe(false);
  });

  it('hides trigger and demographics in read-only mode', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: true,
      accessProfile: 'default',
      hasHistoryAction: false,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: true,
    });

    expect(view.showDemographicsAction).toBe(false);
    expect(view.showMenuTrigger).toBe(false);
    expect(view.showHistoryAction).toBe(false);
    expect(view.showUtilityActions).toBe(false);
    expect(view.showClinicalSection).toBe(true);
    expect(view.showBuiltInClinicalActions).toBe(false);
    expect(view.showClinicalDocumentsAction).toBe(true);
    expect(view.showExamRequestAction).toBe(false);
    expect(view.showImagingRequestAction).toBe(false);
  });

  it('keeps read-only navigation actions visible during a freshness clinical lock', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: false,
      clinicalEditingDisabled: true,
      accessProfile: 'default',
      hasHistoryAction: true,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: true,
      hasMedicalIndicationsAction: true,
    });

    expect(view).toMatchObject({
      showDemographicsAction: false,
      showMenuTrigger: true,
      showHistoryAction: true,
      showUtilityActions: false,
      showClinicalSection: true,
      showBuiltInClinicalActions: false,
      showClinicalDocumentsAction: true,
      showExamRequestAction: false,
      showImagingRequestAction: false,
      showMedicalIndicationsAction: false,
    });
  });

  it('keeps only clinical documents, exam and imaging actions for specialist census access', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: true,
      accessProfile: 'specialist',
      hasPatientIdentity: true,
      hasHistoryAction: true,
      hasClinicalDocumentsAction: true,
      hasExamRequestAction: true,
      hasImagingRequestAction: true,
    });

    expect(view).toEqual({
      showDemographicsAction: true,
      showMenuTrigger: false,
      showHistoryAction: false,
      showUtilityActions: false,
      showClinicalSection: true,
      showBuiltInClinicalActions: false,
      showClinicalDocumentsAction: true,
      showExamRequestAction: true,
      showImagingRequestAction: true,
      showMedicalIndicationsAction: false,
    });
  });

  it('hides the quick actions trigger when the row has neither patient name nor rut', () => {
    const view = resolvePatientActionMenuViewState({
      isBlocked: false,
      readOnly: false,
      accessProfile: 'default',
      hasPatientIdentity: false,
      hasHistoryAction: false,
      hasClinicalDocumentsAction: false,
      hasExamRequestAction: false,
      hasImagingRequestAction: false,
    });

    expect(view.showMenuTrigger).toBe(false);
  });

  it('resolves panel anchor class from row menu alignment', () => {
    expect(resolvePatientActionMenuPanelClassName('top')).toBe('top-0');
    expect(resolvePatientActionMenuPanelClassName('bottom')).toBe('bottom-0');
  });
});
