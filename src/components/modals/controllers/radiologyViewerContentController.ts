import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { buildMMRADExamKey } from '@/components/modals/controllers/radiologyViewerModalController';

export const shouldHideMMRADStatusBadge = (exam: MMRADExam): boolean => {
  const modality = (exam.mod || '').trim().toUpperCase();
  return modality === 'CR' || modality === 'US';
};

export const hasMMRADStructuredReport = (exam: MMRADExam): boolean => {
  const modality = (exam.mod || '').trim().toUpperCase();
  return modality === 'CT' && Boolean(exam.report?.findings || exam.report?.impression);
};

export const buildRadiologyExamCardState = (
  exam: MMRADExam,
  copiedReportExamKey: string | null
): {
  hideStatusBadge: boolean;
  hasStructuredReport: boolean;
  isCopyConfirmed: boolean;
} => {
  const examKey = buildMMRADExamKey(exam);
  return {
    hideStatusBadge: shouldHideMMRADStatusBadge(exam),
    hasStructuredReport: hasMMRADStructuredReport(exam),
    isCopyConfirmed: copiedReportExamKey === examKey,
  };
};

export const buildRadiologyResultsEmptyMessage = (activeModTab: string | null): string =>
  activeModTab
    ? `No se encontraron exámenes de tipo ${activeModTab}`
    : 'No se encontraron exámenes';

export const countMMRADExamsForModality = (result: MMRADSearchResult, modality: string): number =>
  result.examenes.filter(exam => (exam.mod || '').trim().toUpperCase() === modality).length;

// Since 2026-11 MMRAD opens its «Visualizador Universitas» from the RIS `abrirestudio` page.
export const resolveMMRADExternalViewerLabel = (dicomUrl: string): string =>
  /[?&][^=&]*_spage=[^&]*abrirestudio/i.test(dicomUrl)
    ? 'Visualizador Universitas'
    : 'Visualizador DICOM HTML5';
