import { BEDS } from '@/constants/beds';
import { getCategorization, getCategoryColor } from '@/features/cudyr/public';
import { buildDailyCudyrSummary } from '@/services/cudyr/cudyrSummary';
import type { DailyRecord } from '@/application/shared/dailyRecordContracts';
import type { CudyrScore } from '@/types/domain/cudyr';
import { resolveNightShiftNurses } from '@/services/staff/dailyRecordStaffing';
import { isCudyrPatientEligible } from '@/features/cudyr/public';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';

export const CUDYR_DEPENDENCY_COLUMNS = [
  'Cuidados Cambio Ropa',
  'Cuidados de Movilización',
  'Cuidados de Alimentación',
  'Cuidados de Eliminación',
  'Apoyo Psicosocial y Emocional',
  'Vigilancia',
] as const;

export const CUDYR_RISK_COLUMNS = [
  'Medicición Signos Vitales',
  'Balance Hìdrico',
  'Cuidados de Oxigenoterapia',
  'Cuidados diarios de Vía Aérea',
  'Intervenciones Profesionales',
  'Cuidados de la Piel y Curaciones',
  'Administración Tto Farmacológico',
  'Presencia Elem. Invasivos',
] as const;

export const resolveVisibleCudyrBeds = (record: DailyRecord | null) => {
  if (!record) return [];
  const activeExtras = record.activeExtraBeds || [];
  return BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
};

export const buildCudyrPrintMetrics = (record: DailyRecord | null) => {
  if (!record) {
    return { occupied: 0, categorized: 0, index: 0 };
  }

  const summary = buildDailyCudyrSummary(record);
  const occupied = summary.occupiedCount;
  const categorized = summary.categorizedCount;

  const index = occupied > 0 ? Math.round((categorized / occupied) * 100) : 0;
  return { occupied, categorized, index };
};

export const formatCudyrPrintDate = (date: string) => {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
};

export const resolveResponsibleNightNurses = (record: DailyRecord) =>
  resolveNightShiftNurses(record).filter(nurse => nurse && nurse.trim() !== '');

export const renderCudyrScore = (value?: number) => {
  if (value === 0) return 0;
  if (value === undefined || value === null) return '-';
  return value;
};

export const resolveCategorizationDisplay = (cudyr: Partial<CudyrScore>) =>
  getCategorization(cudyr as CudyrScore);

export const resolveHandoffCudyrPrintDisplay = (
  recordDate: string,
  patient?: {
    patientName?: string;
    admissionDate?: string;
    admissionTime?: string;
    isBlocked?: boolean;
    cudyr?: Partial<CudyrScore>;
    evaluationScores?: {
      cudyr?: {
        category?: string;
        recordedDate?: string;
        recordedAt?: string;
        dependencyScore?: number | null;
        riskScore?: number | null;
      };
    };
  } | null
) => {
  const isEligible = isCudyrPatientEligible(recordDate, patient);
  const importedCudyr = patient?.evaluationScores?.cudyr;
  const importedCategory = String(importedCudyr?.category || '')
    .trim()
    .toUpperCase();
  const hasValidImportedCudyr =
    isEligible &&
    importedCudyrBelongsToCensus(importedCudyr, recordDate) &&
    /^[A-D][1-3]$/.test(importedCategory);
  const visibleScores = isEligible && !hasValidImportedCudyr ? patient?.cudyr : undefined;
  const manualCategorization = resolveCategorizationDisplay(
    (visibleScores || {}) as Partial<CudyrScore>
  );
  const categorization = hasValidImportedCudyr
    ? {
        ...manualCategorization,
        finalCat: importedCategory,
        riskCat: importedCategory.charAt(0),
        depCat: importedCategory.charAt(1),
        badgeColor: getCategoryColor(importedCategory.charAt(0)),
        isCategorized: true,
      }
    : manualCategorization;

  return {
    isEligible,
    visibleScores,
    categorization,
  };
};
