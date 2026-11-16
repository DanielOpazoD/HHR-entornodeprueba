// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import {
  buildLabViewerModalShellModel,
  buildUniqueLabPatients,
  filterLabExamsByCategory,
  resolveInitialLabViewerRut,
  resolveLabExamFilterCategories,
  resolveLabExamIdsByDateRange,
  resolveLabExamIdsByDays,
  resolveLabExamSelectionByDateRange,
  resolveLabExamSelectionByDays,
  resolveLabViewerAnalysisErrorMessage,
  resolveLabViewerSearchErrorMessage,
  shouldRetryLabViewerSearchError,
  resolveSelectAllLabExamSelection,
  resolveSelectableLabExamIds,
  resolveSelectedLabAnalysisLinks,
  toggleLabExamSelection,
} from '@/features/laboratory/controllers/labViewerController';

const patients: LabPatient[] = [
  {
    bedId: 'R2',
    label: 'R2 · María',
    patientName: 'María',
    rut: '2-7',
    diagnosis: 'Dx',
  },
  {
    bedId: 'R1',
    label: 'R1 · Juan',
    patientName: 'Juan',
    rut: '1-9',
    diagnosis: 'Dx',
  },
  {
    bedId: 'R3',
    label: 'R3 · Juan',
    patientName: 'Juan',
    rut: '1-9',
    diagnosis: 'Dx',
  },
];

const examList: SyslabExamItem[] = [
  {
    id: '1',
    link: 'http://lab/exam/1',
    date: '06/04/2026',
    time: '13:08:43',
    patientName: 'JUAN',
    origin: 'HOSPITALIZADOS',
    exams: ['HEMOGRAMA', 'GLICEMIA'],
  },
  {
    id: '2',
    link: 'http://lab/exam/2',
    date: '01/03/2026',
    time: '09:00:00',
    patientName: 'JUAN',
    origin: 'HOSPITALIZADOS',
    exams: ['PCR'],
  },
  {
    id: '3',
    link: null,
    date: '12/04/2026',
    time: '11:00:00',
    patientName: 'JUAN',
    origin: 'HOSPITALIZADOS',
    exams: ['HEMOGRAMA'],
  },
];

describe('labViewerController', () => {
  it('resolves the initial selected rut from explicit input or the first patient', () => {
    expect(resolveInitialLabViewerRut(patients, '9-9')).toBe('9-9');
    expect(resolveInitialLabViewerRut(patients)).toBe('2-7');
    expect(resolveInitialLabViewerRut([])).toBe('');
  });

  it('deduplicates patients by rut and sorts them by bed order', () => {
    expect(buildUniqueLabPatients(patients).map(patient => patient.rut)).toEqual(['1-9', '2-7']);
  });

  it('derives categories and filters exams by the selected category', () => {
    expect(resolveLabExamFilterCategories(examList)).toEqual(
      expect.arrayContaining(['Hemograma', 'Bioquímica'])
    );
    expect(resolveLabExamFilterCategories(examList)).not.toContain('Otros');
    expect(resolveLabExamFilterCategories(examList)).not.toContain('Gases');
    expect(filterLabExamsByCategory(examList, 'Hemograma').map(exam => exam.id)).toEqual([
      '1',
      '3',
    ]);
  });

  it('resolves selectable exam ids and selected analysis links only from linked exams', () => {
    expect(resolveSelectableLabExamIds(examList)).toEqual(['1', '2']);
    expect(
      resolveSelectedLabAnalysisLinks({
        examList,
        selectedExamIds: new Set(['1', '3']),
      })
    ).toEqual(['http://lab/exam/1']);
  });

  it('selects exams by explicit date range and trailing days window', () => {
    expect(
      resolveLabExamIdsByDateRange({
        examList,
        from: new Date(2026, 3, 1),
        to: new Date(2026, 3, 30),
      })
    ).toEqual(['1']);

    expect(
      resolveLabExamIdsByDays({
        examList,
        days: 3,
        now: new Date(2026, 3, 12, 12, 0, 0),
      })
    ).toEqual([]);

    expect(
      Array.from(
        resolveLabExamSelectionByDateRange({
          examList,
          from: new Date(2026, 3, 1),
          to: new Date(2026, 3, 30),
        })
      )
    ).toEqual(['1']);

    expect(
      Array.from(
        resolveLabExamSelectionByDays({
          examList,
          days: 3,
          now: new Date(2026, 3, 12, 12, 0, 0),
        })
      )
    ).toEqual([]);
  });

  it('toggles and bulk-selects exam ids using linked exams only', () => {
    expect(Array.from(toggleLabExamSelection(new Set(), '1'))).toEqual(['1']);
    expect(Array.from(toggleLabExamSelection(new Set(['1']), '1'))).toEqual([]);

    expect(
      Array.from(
        resolveSelectAllLabExamSelection({
          examList,
          selectedExamIds: new Set(),
        })
      )
    ).toEqual(['1', '2']);

    expect(
      Array.from(
        resolveSelectAllLabExamSelection({
          examList,
          selectedExamIds: new Set(['1', '2']),
        })
      )
    ).toEqual([]);
  });

  it('normalizes search and analysis error messages', () => {
    expect(
      resolveLabViewerSearchErrorMessage({
        queryError: new Error('Falló búsqueda'),
        queryData: null,
      })
    ).toBe('Falló búsqueda');

    expect(
      resolveLabViewerSearchErrorMessage({
        queryError: null,
        queryData: { success: false, error: 'Sin resultados' },
      })
    ).toBe('Sin resultados');

    expect(resolveLabViewerAnalysisErrorMessage(new Error('Falló análisis'))).toBe(
      'Falló análisis'
    );

    expect(
      resolveLabViewerSearchErrorMessage({
        queryError: new Error('¡Error interno al procesar el scraping!'),
        queryData: null,
      })
    ).toBe(
      'El proxy local de Syslab falló al scrapear. Verifica API-laboratorioHHR, la red del hospital y el acceso a 10.4.69.90.'
    );

    expect(resolveLabViewerAnalysisErrorMessage(new Error('Failed to fetch'))).toBe(
      'No hay conexión estable con Syslab o con Firestore. Revisa red/VPN y vuelve a intentar.'
    );
  });

  it('marks internal scraping and permission errors as non-retryable', () => {
    expect(
      shouldRetryLabViewerSearchError(new Error('¡Error interno al procesar el scraping!'))
    ).toBe(false);
    expect(shouldRetryLabViewerSearchError({ code: 'permission-denied' })).toBe(false);
    expect(shouldRetryLabViewerSearchError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('builds the viewer modal shell state for list, analysis and pdf modes', () => {
    expect(
      buildLabViewerModalShellModel({
        pdfExam: null,
        analysisData: null,
        examList,
        isLoading: false,
        isAnalyzing: false,
        error: null,
      })
    ).toEqual({
      modalSize: '3xl',
      isViewingPdf: false,
      isViewingAnalysis: false,
      shouldShowControls: true,
      shouldShowPdf: false,
      shouldShowAnalysis: false,
      shouldShowExamList: true,
      shouldShowEmptyState: false,
    });

    expect(
      buildLabViewerModalShellModel({
        pdfExam: examList[0],
        analysisData: null,
        examList,
        isLoading: false,
        isAnalyzing: false,
        error: null,
      }).modalSize
    ).toBe('5xl');

    expect(
      buildLabViewerModalShellModel({
        pdfExam: null,
        analysisData: {
          trendGroups: [],
          examDates: [],
          microbiologyEntries: [],
          comparison: {},
        },
        examList,
        isLoading: false,
        isAnalyzing: false,
        error: null,
      })
    ).toEqual(
      expect.objectContaining({
        modalSize: 'full',
        shouldShowControls: false,
        shouldShowAnalysis: true,
        shouldShowExamList: false,
      })
    );
  });
});
