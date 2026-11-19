import { describe, expect, it } from 'vitest';
import type { MMRADExam, MMRADSearchResult } from '@/features/radiology/services/mmradService';
import {
  buildRadiologyResultsEmptyMessage,
  countMMRADExamsForModality,
  hasMMRADStructuredReport,
  shouldHideMMRADStatusBadge,
} from '@/features/radiology/controllers/radiologyViewerContentController';

const ctExam: MMRADExam = {
  nombre_examen: 'TC Torax',
  fecha_examen: '12/04/2026 11:47',
  fecha_asignacion: '',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: 'https://example.com/report.pdf',
  dicom_url: null,
  informe_html_url: 'https://example.com/report.html',
  report: {
    title: 'TOMOGRAFÍA SIMPLE DE TÓRAX',
    technique: null,
    antecedentesClinicos: null,
    findings: 'Hallazgo',
    impression: 'Impresión',
  },
};

describe('radiologyViewerContentController', () => {
  it('resolves badge visibility and structured-report state', () => {
    expect(shouldHideMMRADStatusBadge({ ...ctExam, mod: 'US' })).toBe(true);
    expect(hasMMRADStructuredReport(ctExam)).toBe(true);
  });

  it('builds empty messages', () => {
    expect(buildRadiologyResultsEmptyMessage('CT')).toContain('CT');
    expect(buildRadiologyResultsEmptyMessage(null)).toBe('No se encontraron exámenes');
  });

  it('counts exams by modality', () => {
    const result: MMRADSearchResult = {
      rut: '1-1',
      examenes: [
        ctExam,
        { ...ctExam, mod: 'CR', informe_html_url: null, pdf_url: null, report: null },
      ],
    };

    expect(countMMRADExamsForModality(result, 'CT')).toBe(1);
    expect(countMMRADExamsForModality(result, 'CR')).toBe(1);
  });
});
