import { describe, expect, it } from 'vitest';
import {
  buildPatientMainRowViewState,
  resolvePatientMainRowActionsAvailability,
  resolvePatientMainRowClassName,
  shouldShowBedTypeToggle,
} from '@/features/census/controllers/patientRowMainViewController';

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
      isBlocked: true,
      patientName: '',
    });
    expect(rowClassName).toContain('bg-slate-50/50');
    expect(rowClassName).toContain('animate-slide-fade-in');

    expect(
      resolvePatientMainRowActionsAvailability({
        patientName: 'Paciente',
        rut: '1-9',
      })
    ).toEqual({
      canOpenExamRequest: true,
      canOpenHistory: true,
    });
    expect(
      resolvePatientMainRowActionsAvailability({
        patientName: '',
        rut: '',
      })
    ).toEqual({
      canOpenExamRequest: false,
      canOpenHistory: false,
    });
  });

  it('builds consolidated view state for main row', () => {
    const viewState = buildPatientMainRowViewState({
      bedId: 'R1',
      readOnly: false,
      isEmpty: false,
      isBlocked: true,
      patientName: 'Paciente',
      rut: '',
    });

    expect(viewState.canToggleBedType).toBe(true);
    expect(viewState.rowActionsAvailability.canOpenExamRequest).toBe(true);
    expect(viewState.rowActionsAvailability.canOpenHistory).toBe(false);
    expect(viewState.showBlockedContent).toBe(true);
  });
});
