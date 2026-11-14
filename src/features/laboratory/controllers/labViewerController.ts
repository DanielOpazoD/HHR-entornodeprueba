import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { EXAM_FILTER_CATEGORIES } from '../constants/labExamConstants';
import { bedSortKey } from './labFormattingController';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { addCalendarDays } from '@/utils/clinicalDateUtils';

export const resolveInitialLabViewerRut = (
  patients: LabPatient[],
  initialPatientRut?: string
): string => initialPatientRut || patients[0]?.rut || '';

export const buildUniqueLabPatients = (patients: LabPatient[]): LabPatient[] => {
  const seen = new Set<string>();
  return patients
    .filter(patient => {
      if (!patient.rut || seen.has(patient.rut)) {
        return false;
      }

      seen.add(patient.rut);
      return true;
    })
    .sort((left, right) => bedSortKey(left.bedId) - bedSortKey(right.bedId));
};

export const resolveLabExamFilterCategories = (examList: SyslabExamItem[]): string[] => {
  const categories = new Set<string>();

  for (const exam of examList) {
    for (const examName of exam.exams) {
      const upperExamName = examName.toUpperCase();
      const category = EXAM_FILTER_CATEGORIES.find(entry =>
        entry.patterns.some(pattern => upperExamName.includes(pattern))
      );
      if (category) {
        categories.add(category.label);
      }
    }
  }

  return Array.from(categories);
};

export const filterLabExamsByCategory = (
  examList: SyslabExamItem[],
  activeExamFilter: string | null
): SyslabExamItem[] => {
  if (!activeExamFilter) {
    return examList;
  }

  const category = EXAM_FILTER_CATEGORIES.find(entry => entry.label === activeExamFilter);
  if (!category) {
    return examList;
  }

  return examList.filter(exam =>
    exam.exams.some(examName =>
      category.patterns.some(pattern => examName.toUpperCase().includes(pattern))
    )
  );
};

export const resolveSelectableLabExamIds = (examList: SyslabExamItem[]): string[] =>
  examList.filter(exam => Boolean(exam.link)).map(exam => exam.id);

export const toggleLabExamSelection = (selectedExamIds: Set<string>, id: string): Set<string> => {
  const next = new Set(selectedExamIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
};

export const resolveSelectAllLabExamSelection = ({
  examList,
  selectedExamIds,
}: {
  examList: SyslabExamItem[];
  selectedExamIds: Set<string>;
}): Set<string> => {
  const allIds = resolveSelectableLabExamIds(examList);
  return allIds.every(id => selectedExamIds.has(id)) ? new Set() : new Set(allIds);
};

export const resolveLabExamSelectionByDateRange = ({
  examList,
  from,
  to,
}: {
  examList: SyslabExamItem[];
  from: Date;
  to: Date;
}): Set<string> => new Set(resolveLabExamIdsByDateRange({ examList, from, to }));

export const resolveLabExamSelectionByDays = ({
  examList,
  days,
  now,
}: {
  examList: SyslabExamItem[];
  days: number;
  now?: Date;
}): Set<string> => new Set(resolveLabExamIdsByDays({ examList, days, now }));

const parseLabExamCalendarDate = (value: string): Date | null => {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) {
    return null;
  }

  return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
};

/** A `YYYY-MM-DD` day at the same local midnight that `parseLabExamCalendarDate` gives an exam. */
const startOfCalendarDay = (calendarDay: string): Date =>
  new Date(
    Number(calendarDay.slice(0, 4)),
    Number(calendarDay.slice(5, 7)) - 1,
    Number(calendarDay.slice(8, 10))
  );

export const resolveLabExamIdsByDateRange = ({
  examList,
  from,
  to,
}: {
  examList: SyslabExamItem[];
  from: Date;
  to: Date;
}): string[] =>
  examList
    .filter(exam => {
      if (!exam.link) {
        return false;
      }

      const examDate = parseLabExamCalendarDate(exam.date);
      return Boolean(examDate && examDate >= from && examDate <= to);
    })
    .map(exam => exam.id);

export const resolveLabExamIdsByDays = ({
  examList,
  days,
  now = new Date(),
}: {
  examList: SyslabExamItem[];
  days: number;
  now?: Date;
}): string[] => {
  const today = getClinicalCalendarDateISO(now);
  return resolveLabExamIdsByDateRange({
    examList,
    from: startOfCalendarDay(addCalendarDays(today, -days)),
    to: startOfCalendarDay(today),
  });
};

export const resolveSelectedLabAnalysisLinks = ({
  examList,
  selectedExamIds,
}: {
  examList: SyslabExamItem[];
  selectedExamIds: Set<string>;
}): string[] =>
  examList
    .filter(exam => selectedExamIds.has(exam.id) && exam.link)
    .map(exam => exam.link as string);

export const resolveLabViewerSearchErrorMessage = ({
  queryError,
  queryData,
}: {
  queryError: unknown;
  queryData?: { success?: boolean; error?: string } | null;
}): string | null => {
  if (queryError) {
    return resolveLabViewerSyslabErrorMessage(queryError, 'search');
  }

  if (queryData && queryData.success === false) {
    return queryData.error
      ? resolveLabViewerSyslabErrorMessage(queryData.error, 'search')
      : 'No se pudieron obtener los resultados.';
  }

  return null;
};

export const resolveLabViewerAnalysisErrorMessage = (error: unknown): string =>
  resolveLabViewerSyslabErrorMessage(error, 'details');

const flattenLabViewerErrorText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    return `${value.name} ${value.message}`.trim();
  }
  if (Array.isArray(value)) {
    return value.map(item => flattenLabViewerErrorText(item)).join(' ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(entry => flattenLabViewerErrorText(entry))
      .join(' ');
  }
  return '';
};

const isInternalScrapingError = (error: unknown): boolean => {
  const text = flattenLabViewerErrorText(error).toLowerCase();
  return (
    text.includes('error interno al procesar el scraping') ||
    text.includes('interno al procesar el scraping')
  );
};

const isSyslabNetworkError = (error: unknown): boolean => {
  const text = flattenLabViewerErrorText(error).toLowerCase();
  return (
    text.includes('failed to fetch') ||
    text.includes('network changed') ||
    text.includes('networkerror') ||
    text.includes('internet disconnected') ||
    text.includes('name_not_resolved') ||
    text.includes('timeout')
  );
};

const resolveLabViewerSyslabErrorMessage = (
  error: unknown,
  operation: 'search' | 'details'
): string => {
  if (isInternalScrapingError(error)) {
    return operation === 'search'
      ? 'El proxy local de Syslab falló al scrapear. Verifica API-laboratorioHHR, la red del hospital y el acceso a 10.4.69.90.'
      : 'El proxy local de Syslab falló al procesar el PDF. Verifica API-laboratorioHHR, la red del hospital y el acceso a 10.4.69.90.';
  }

  if (isSyslabNetworkError(error)) {
    return 'No hay conexión estable con Syslab o con Firestore. Revisa red/VPN y vuelve a intentar.';
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return operation === 'search'
    ? 'Error al buscar exámenes.'
    : 'Error al analizar exámenes. Verifica que el servidor Syslab esté activo.';
};

export const shouldRetryLabViewerSearchError = (error: unknown): boolean => {
  if (isInternalScrapingError(error)) {
    return false;
  }

  if (flattenLabViewerErrorText(error).toLowerCase().includes('permission-denied')) {
    return false;
  }

  return true;
};

export interface LabViewerModalShellModel {
  modalSize: '3xl' | '5xl' | 'full';
  isViewingPdf: boolean;
  isViewingAnalysis: boolean;
  shouldShowControls: boolean;
  shouldShowPdf: boolean;
  shouldShowAnalysis: boolean;
  shouldShowExamList: boolean;
  shouldShowEmptyState: boolean;
}

export const buildLabViewerModalShellModel = ({
  pdfExam,
  analysisData,
  examList,
  isLoading,
  isAnalyzing,
  error,
}: {
  pdfExam: SyslabExamItem | null;
  analysisData: LabAnalysisData | null;
  examList: SyslabExamItem[];
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
}): LabViewerModalShellModel => {
  const isViewingPdf = pdfExam !== null;
  const isViewingAnalysis = analysisData !== null;

  return {
    modalSize: isViewingAnalysis ? 'full' : isViewingPdf ? '5xl' : '3xl',
    isViewingPdf,
    isViewingAnalysis,
    shouldShowControls: !isViewingAnalysis,
    shouldShowPdf: isViewingPdf,
    shouldShowAnalysis: !isViewingPdf && isViewingAnalysis && !isAnalyzing,
    shouldShowExamList: !isViewingPdf && !isViewingAnalysis && examList.length > 0 && !isLoading,
    shouldShowEmptyState:
      !isViewingPdf &&
      !isViewingAnalysis &&
      examList.length === 0 &&
      !isLoading &&
      !isAnalyzing &&
      !error,
  };
};
