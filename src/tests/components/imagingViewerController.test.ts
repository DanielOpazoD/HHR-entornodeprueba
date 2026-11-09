import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildImagingViewerDocumentModel,
  fitFontSizePx,
} from '@/components/modals/controllers/imagingViewerController';
import type { PatientData } from '@/types/domain/patient';

const mockPatient = {
  patientName: 'Juan Perez Soto',
  rut: '11.111.111-1',
  birthDate: '1990-01-01',
  pathology: 'Apendicitis',
} as PatientData;

describe('imagingViewerController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  it('builds the solicitud overlay model', () => {
    const model = buildImagingViewerDocumentModel('solicitud', mockPatient, 'Dr. House');

    expect(model.imageSrc).toBe('/docs/solicitud_imagenologia.png');
    expect(model.aspectRatio).toBe('612 / 936');
    expect(model.overlays.some(overlay => overlay.text === 'Juan Perez Soto')).toBe(true);
    expect(model.overlays.some(overlay => overlay.text === 'Apendicitis')).toBe(true);
    expect(model.overlays.some(overlay => overlay.text === 'Dr. House')).toBe(true);
  });

  it('builds consent and encuesta variants with their own assets', () => {
    const consentimiento = buildImagingViewerDocumentModel(
      'consentimiento',
      mockPatient,
      'Dra. Grey'
    );
    const encuesta = buildImagingViewerDocumentModel('encuesta', mockPatient, 'Dra. Grey');

    expect(consentimiento.imageSrc).toBe('/docs/consentimiento.png');
    expect(consentimiento.aspectRatio).toBe('612 / 842');
    expect(encuesta.imageSrc).toBe('/docs/encuesta_imagenologia.png');
    expect(encuesta.aspectRatio).toBe('612 / 792');
  });

  it.each(['solicitud', 'encuesta', 'consentimiento'] as const)(
    'shows the %s name on one line with the first three given names',
    selectedDoc => {
      const model = buildImagingViewerDocumentModel(
        selectedDoc,
        {
          ...mockPatient,
          patientName: 'Ana María de los Ángeles Valentina Rosa Elena de la Fuente Pakarati',
          firstName: 'Ana María de los Ángeles Valentina Rosa Elena',
          lastName: 'de la Fuente',
          secondLastName: 'Pakarati',
        },
        ''
      );
      const nameOverlays = model.overlays.filter(overlay => /Ana|Hotu|Pakarati/.test(overlay.text));

      expect(nameOverlays.map(overlay => overlay.text)).toEqual([
        'Ana María de los Ángeles de la Fuente Pakarati',
      ]);
    }
  );

  it.each(['solicitud', 'encuesta', 'consentimiento'] as const)(
    'bounds the %s name to its field so it ends before the next field on its line',
    selectedDoc => {
      const legacyPatient = {
        ...mockPatient,
        patientName: 'Ana María Josefa Valentina Del Sagrado Corazón de la Fuente',
      };
      const { overlays } = buildImagingViewerDocumentModel(selectedDoc, legacyPatient, '');
      const percent = (value: string) => Number.parseFloat(value);
      const name = overlays.find(overlay => overlay.text === legacyPatient.patientName);

      expect(name?.maxWidth).toBeDefined();
      const nameEnd = percent(name!.left) + percent(name!.maxWidth!);
      const nextOnLine = overlays.filter(
        overlay =>
          overlay !== name &&
          overlay.top === name!.top &&
          percent(overlay.left) > percent(name!.left)
      );
      for (const overlay of nextOnLine) {
        expect(nameEnd).toBeLessThanOrEqual(percent(overlay.left));
      }
      expect(nameEnd).toBeLessThanOrEqual(100);
    }
  );

  it('shrinks the font only when the text is wider than its field', () => {
    expect(fitFontSizePx(14, 300, 200)).toBe(14);
    expect(fitFontSizePx(14, 300, 300)).toBe(14);
    expect(fitFontSizePx(14, 300, 600)).toBe(7);
    expect(fitFontSizePx(14, 250, 300)).toBe(11.6);
  });
});
