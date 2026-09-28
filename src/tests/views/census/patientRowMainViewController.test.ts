// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildPatientMainRowViewState,
  resolvePatientMainRowActionsAvailability,
  resolvePatientMainRowClassName,
  shouldShowBedTypeToggle,
} from '@/features/census/controllers/patientRowMainViewController';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';

describe('patientRowMainViewController', () => {
  it('shows bed type toggle only for editable occupied R beds', () => {
    expect(
      shouldShowBedTypeToggle({
        bedId: 'R7',
        readOnly: false,
        isEmpty: false,
      })
    ).toBe(true);
  });

  it('hides bed type toggle when row is read-only', () => {
    expect(
      shouldShowBedTypeToggle({
        bedId: 'R7',
        readOnly: true,
        isEmpty: false,
      })
    ).toBe(false);
  });

  it('hides bed type toggle when bed is empty or non-regular', () => {
    expect(
      shouldShowBedTypeToggle({
        bedId: 'R7',
        readOnly: false,
        isEmpty: true,
      })
    ).toBe(false);

    expect(
      shouldShowBedTypeToggle({
        bedId: 'AUX-1',
        readOnly: false,
        isEmpty: false,
      })
    ).toBe(false);
  });

  it('resolves row classes and action availability from patient state', () => {
    const rowClassName = resolvePatientMainRowClassName({
      bedId: 'R1',
      isBlocked: true,
      patientName: '',
    });
    expect(rowClassName).toContain('bg-slate-50/50');
    expect(rowClassName).toContain('animate-slide-fade-in');

    const upcRowClassName = resolvePatientMainRowClassName({
      bedId: 'R1',
      isBlocked: false,
      isUpc: true,
      patientName: 'Paciente UPC',
    });
    expect(upcRowClassName).toContain('bg-white');

    expect(
      resolvePatientMainRowActionsAvailability({
        canOpenClinicalDocuments: true,
        canOpenExamRequest: true,
        canOpenImagingRequest: true,
        canOpenHistory: true,
        canShowClinicalDocumentIndicator: true,
      })
    ).toEqual({
      canOpenClinicalDocuments: true,
      canOpenExamRequest: true,
      canOpenImagingRequest: true,
      canOpenHistory: true,
      canShowClinicalDocumentIndicator: true,
    });
    expect(
      resolvePatientMainRowActionsAvailability(
        resolvePatientRowCapabilities({
          role: 'viewer',
          patient: { patientName: '', rut: '' },
          isBlocked: false,
          isEmpty: true,
        })
      )
    ).toEqual({
      canOpenClinicalDocuments: false,
      canOpenExamRequest: false,
      canOpenImagingRequest: false,
      canOpenHistory: false,
      canShowClinicalDocumentIndicator: false,
    });
  });

  it('builds consolidated view state for main row', () => {
    const viewState = buildPatientMainRowViewState({
      bedId: 'R1',
      readOnly: false,
      isEmpty: false,
      isBlocked: true,
      capabilities: resolvePatientRowCapabilities({
        role: 'doctor_urgency',
        patient: { patientName: 'Paciente', rut: '' },
        isBlocked: true,
        isEmpty: false,
      }),
      patientName: 'Paciente',
    });

    expect(viewState.canToggleBedType).toBe(true);
    expect(viewState.rowActionsAvailability.canOpenExamRequest).toBe(true);
    expect(viewState.rowActionsAvailability.canOpenImagingRequest).toBe(true);
    expect(viewState.rowActionsAvailability.canOpenHistory).toBe(false);
    expect(viewState.showBlockedContent).toBe(true);
  });
});
