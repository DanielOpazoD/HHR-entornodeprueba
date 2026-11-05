import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import {
  buildFilteredMMRADExams,
  buildMMRADExamKey,
  buildUniqueRadiologyPatients,
  extractMMRADModalities,
  resolveInitialMMRADModalityTab,
  resolveMMRADDatePresetRange,
} from '@/components/modals/controllers/radiologyViewerModalController';

const exams: MMRADExam[] = [
  {
    nombre_examen: 'TC Abdomen',
    fecha_examen: '10/04/2026 09:00',
    fecha_asignacion: '',
    mod: 'CT',
    estado: 'Validado',
    pdf_url: 'https://example.com/a.pdf',
    dicom_url: null,
    informe_html_url: 'https://example.com/a.html',
    report: {
      title: 'TAC',
      technique: null,
      antecedentesClinicos: null,
      findings: 'A',
      impression: 'B',
    },
  },
  {
    nombre_examen: 'RX Torax',
    fecha_examen: '09/04/2026 09:00',
    fecha_asignacion: '',
    mod: 'CR',
    estado: 'Informado',
    pdf_url: null,
    dicom_url: null,
    informe_html_url: null,
    report: null,
  },
];

describe('radiologyViewerModalController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  it('deduplicates patients and sorts by bed order', () => {
    const patients = [
      { bedId: 'H2C1', label: 'H2C1', patientName: 'Dos', rut: '2-2' },
      { bedId: 'R1', label: 'R1', patientName: 'Uno', rut: '1-1' },
      { bedId: 'H3C1', label: 'H3C1', patientName: 'Duplicado', rut: '1-1' },
    ];

    const result = buildUniqueRadiologyPatients(patients);

    expect(result).toHaveLength(2);
    expect(result[0].bedId).toBe('R1');
    expect(result[1].bedId).toBe('H2C1');
  });

  it('extracts modalities, defaults CT tab, filters and sorts exams', () => {
    const result: MMRADSearchResult = { rut: '1-1', examenes: exams };

    expect(extractMMRADModalities(exams)).toEqual(['CT', 'CR']);
    expect(resolveInitialMMRADModalityTab(['CT', 'CR'])).toBe('CT');
    expect(buildFilteredMMRADExams(result, 'CT')).toHaveLength(1);
    expect(buildFilteredMMRADExams(result, null)[0].nombre_examen).toBe('TC Abdomen');
    // Stamps with a time are ordered by their own day and month, whatever order MMRAD sent.
    const reversed: MMRADSearchResult = { rut: '1-1', examenes: [...exams].reverse() };
    expect(buildFilteredMMRADExams(reversed, null).map(exam => exam.fecha_examen)).toEqual([
      '10/04/2026 09:00',
      '09/04/2026 09:00',
    ]);
    expect(reversed.examenes[0].fecha_examen).toBe('09/04/2026 09:00');
  });

  it('builds preset date ranges and exam keys', () => {
    const range = resolveMMRADDatePresetRange('last-year');

    expect(range.to).toBe('2026-04-15');
    expect(range.from).toBe('2025-04-15');
    expect(buildMMRADExamKey(exams[0])).toBe('https://example.com/a.html');
  });
});
