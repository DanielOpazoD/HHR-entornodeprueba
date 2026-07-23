import type { LabResultRow } from '@/types/domain/labExamTypes';
import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';
import { parseRefRange } from './labFormattingController';
import { parseLabMeasurement } from './labNumericParser';
import { isLabComparisonEligible, isLabTrendSpecimenEligible } from './labSpecimenController';
import {
  collectMicrobiologyFinding,
  resolveMicrobiologyCategoryForFinding,
} from './labMicrobiologyAnalyticsController';
import type { DetailProcessingContext } from './labAnalyticsContracts';
import { isExcludedFromComparison, isTrendVariable } from './labAnalyticsVariableController';

const collectBilirubinFinding = (
  bilirubinByCol: Record<string, { total?: string; directa?: string; indirecta?: string }>,
  colKey: string,
  lowerAnalysis: string,
  result: string
) => {
  if (!lowerAnalysis.includes('bilirrubina')) {
    return;
  }

  if (!bilirubinByCol[colKey]) bilirubinByCol[colKey] = {};
  if (lowerAnalysis.includes('total')) bilirubinByCol[colKey].total = result;
  else if (lowerAnalysis.includes('directa')) bilirubinByCol[colKey].directa = result;
  else if (lowerAnalysis.includes('indirecta')) bilirubinByCol[colKey].indirecta = result;
};

const collectComparisonFinding = (
  comparison: Record<string, Record<string, LabResultRow>>,
  seenComparison: Set<string>,
  colKey: string,
  finding: LabResultRow,
  lowerAnalysis: string
) => {
  if (
    isExcludedFromComparison(finding.analysis) ||
    lowerAnalysis.includes('bilirrubina') ||
    !isLabComparisonEligible(finding)
  ) {
    return;
  }

  const compKey = `${finding.analysis}::${colKey}`;
  if (seenComparison.has(compKey)) {
    return;
  }

  seenComparison.add(compKey);
  if (!comparison[finding.analysis]) comparison[finding.analysis] = {};
  comparison[finding.analysis][colKey] = finding;
};

const collectTrendFinding = (
  trendMap: Record<string, LabTrendPoint[]>,
  seenTrend: Set<string>,
  colKey: string,
  isoDate: string,
  finding: LabResultRow
) => {
  if (
    !isTrendVariable(finding.analysis) ||
    finding.qualitative ||
    !isLabTrendSpecimenEligible(finding)
  ) {
    return;
  }

  const trendKey = `${finding.analysis}::${colKey}`;
  if (seenTrend.has(trendKey)) {
    return;
  }

  seenTrend.add(trendKey);
  const measurement = parseLabMeasurement(finding.result, finding);
  if (!measurement || measurement.comparator !== '=') {
    return;
  }

  if (!trendMap[finding.analysis]) trendMap[finding.analysis] = [];
  const range = parseRefRange(finding.refValue);
  trendMap[finding.analysis].push({
    date: colKey,
    isoDate,
    value: measurement.value,
    unit: finding.unit,
    rawValue: finding.result,
    sourceSection: finding.section,
    refMin: range?.min,
    refMax: range?.max,
  });
};

export const collectExamFinding = (finding: LabResultRow, input: DetailProcessingContext) => {
  if (input.suppressedAnalyses.has(finding.analysis)) {
    return;
  }

  const lowerAnalysis = finding.analysis.toLowerCase();
  const microbiologyCategory = resolveMicrobiologyCategoryForFinding(
    finding,
    input.microbiologyCategories
  );

  if (microbiologyCategory) {
    collectMicrobiologyFinding(
      finding,
      input.microbiologyCategories,
      input.microbiologyFindingsByCategory
    );
    return;
  }

  collectBilirubinFinding(input.bilirubinByCol, input.colKey, lowerAnalysis, finding.result);
  collectComparisonFinding(
    input.comparison,
    input.seenComparison,
    input.colKey,
    finding,
    lowerAnalysis
  );
  collectTrendFinding(input.trendMap, input.seenTrend, input.colKey, input.isoDate, finding);
};
