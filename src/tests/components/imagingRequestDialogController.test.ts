import { describe, expect, it, vi } from 'vitest';
import {
  buildImagingClosedState,
  buildImagingDialogShellModel,
  IMAGING_DOCUMENT_OPTIONS,
  resolveImagingCanvasIntent,
  runImagingPrintAction,
} from '@/features/census/components/imaging-request/imagingRequestDialogController';
import type { PatientData } from '@/types/domain/patient';

const mockPatient = {
  patientName: 'Paciente Imagen',
  rut: '11.111.111-1',
  pathology: 'Colelitiasis',
} as PatientData;

describe('imagingRequestDialogController', () => {
  it('builds shell data and exposes the static document catalog', () => {
    const shell = buildImagingDialogShellModel(mockPatient);

    expect(shell.title).toBe('Solicitud de Imágenes');
    expect(shell.subtitle).toBe('Paciente Imagen');
    expect(IMAGING_DOCUMENT_OPTIONS).toHaveLength(3);
  });

  it('builds the closed state and canvas intent', () => {
    const closedState = buildImagingClosedState();
    const crossIntent = resolveImagingCanvasIntent('solicitud', 'cross', { x: 10, y: 20 });
    const textIntent = resolveImagingCanvasIntent('encuesta', 'text', { x: 30, y: 40 });

    expect(closedState.marks).toEqual([]);
    expect(closedState.toolMode).toBe('cross');
    expect(crossIntent.nextMark).toEqual({ x: 10, y: 20 });
    expect(crossIntent.nextActiveText).toBeNull();
    expect(textIntent.nextMark).toBeUndefined();
    expect(textIntent.nextActiveText).toEqual({ x: 30, y: 40, text: '' });
  });

  it('routes print actions by selected document', async () => {
    const printImagingRequestForm = vi.fn();
    const printImagingEncuestaForm = vi.fn();
    const printConsentimientoForm = vi.fn();
    const marks = [{ x: 10, y: 20 }];

    await runImagingPrintAction(
      { printImagingRequestForm, printImagingEncuestaForm, printConsentimientoForm },
      'consentimiento',
      mockPatient,
      'Dr. Test',
      marks
    );

    expect(printConsentimientoForm).toHaveBeenCalledWith(mockPatient, 'Dr. Test', marks);
    expect(printImagingRequestForm).not.toHaveBeenCalled();
    expect(printImagingEncuestaForm).not.toHaveBeenCalled();
  });
});
