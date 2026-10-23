import type { SyslabExamItem, SyslabExamDetail, LabResultRow } from '@/types/domain/labExamTypes';
import type { LabMicrobiologyEntry } from '@/types/domain/labAnalyticsTypes';
import {
  parseDateDDMMYYYY,
  normalizeAnalysisName,
  normalizeLabUnit,
} from './labFormattingController';
import {
  buildMicrobiologyEntriesForExam,
  resolveMicrobiologyCategoriesForExam,
} from './labMicrobiologyAnalyticsController';
import type { DetailProcessingContext, ProcessedFindings } from './labAnalyticsContracts';
import { collectExamFinding } from './labFindingCollectionController';
import { buildExamColumnKey } from './labAnalyticsVariableController';

const buildSuppressedAnalysesForDetail = (findings: LabResultRow[]): Set<string> => {
  const normalizedNames = new Set(
    findings.map(finding => normalizeAnalysisName(finding.analysis, finding.section))
  );
  const signatures = findings.map(finding =>
    `${finding.section || ''} ${finding.analysis || ''}`.toUpperCase()
  );
  const suppressed = new Set<string>();
  const hasRpc =
    normalizedNames.has('RPC') ||
    signatures.some(signature => signature.includes('PROTEINURIA/CREATININURIA'));
  const hasRac =
    normalizedNames.has('RAC') ||
    signatures.some(signature => signature.includes('ALBUMINA/CREATINURIA'));

  if (hasRpc) {
    suppressed.add('Creatininuria');
    suppressed.add('Proteinuria');
  }

  if (hasRac) {
    suppressed.add('Creatininuria');
    suppressed.add('Microalbuminuria');
  }

  return suppressed;
};

const buildDetailProcessingContext = (
  detail: SyslabExamDetail,
  examList: SyslabExamItem[],
  state: Omit<ProcessedFindings, 'columnKeys' | 'microbiologyEntries'> & {
    seenTrend: Set<string>;
    seenComparison: Set<string>;
  }
): DetailProcessingContext => {
  const exam = examList.find(e => e.link === detail.url);
  const examDate = exam?.date || 'Desconocido';
  const colKey = buildExamColumnKey(exam, examDate, examList);
  const microbiologyCategories = resolveMicrobiologyCategoriesForExam(exam);
  const suppressedAnalyses = buildSuppressedAnalysesForDetail(detail.findings);

  return {
    exam,
    examDate,
    colKey,
    comparison: state.comparison,
    trendMap: state.trendMap,
    seenTrend: state.seenTrend,
    seenComparison: state.seenComparison,
    bilirubinByCol: state.bilirubinByCol,
    isoDate: parseDateDDMMYYYY(examDate),
    suppressedAnalyses,
    microbiologyCategories,
    microbiologyFindingsByCategory: new Map(),
  };
};

const appendMicrobiologyEntriesForDetail = (
  detailContext: DetailProcessingContext,
  microbiologyEntries: LabMicrobiologyEntry[]
) => {
  microbiologyEntries.push(
    ...buildMicrobiologyEntriesForExam({
      exam: detailContext.exam,
      date: detailContext.colKey,
      categories: detailContext.microbiologyCategories,
      findingsByCategory: detailContext.microbiologyFindingsByCategory,
    })
  );
};

export const processLabExamDetails = (
  details: SyslabExamDetail[],
  examList: SyslabExamItem[]
): ProcessedFindings => {
  const comparison: Record<string, ProcessedFindings['comparison'][string]> = {};
  const trendMap: ProcessedFindings['trendMap'] = {};
  const columnKeySet = new Set<string>();
  const seenTrend = new Set<string>();
  const seenComparison = new Set<string>();
  const bilirubinByCol: ProcessedFindings['bilirubinByCol'] = {};
  const microbiologyEntries: LabMicrobiologyEntry[] = [];

  for (const detail of details) {
    const detailContext = buildDetailProcessingContext(detail, examList, {
      comparison,
      trendMap,
      seenTrend,
      seenComparison,
      bilirubinByCol,
    });
    columnKeySet.add(detailContext.colKey);

    for (const rawFinding of detail.findings) {
      collectExamFinding(
        {
          ...rawFinding,
          unit: normalizeLabUnit(rawFinding.unit || ''),
          analysis: normalizeAnalysisName(rawFinding.analysis, rawFinding.section),
        },
        detailContext
      );
    }

    appendMicrobiologyEntriesForDetail(detailContext, microbiologyEntries);
  }

  return {
    comparison,
    trendMap,
    columnKeys: Array.from(columnKeySet),
    bilirubinByCol,
    microbiologyEntries,
  };
};
