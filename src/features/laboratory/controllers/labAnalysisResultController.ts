import type { LabResultRow } from '@/types/domain/labExamTypes';
import type {
  LabAnalysisData,
  LabMicrobiologyEntry,
  LabTrendGroup,
  LabTrendPoint,
} from '@/types/domain/labAnalyticsTypes';
import { COMPARISON_ORDER } from '../constants/labComparisonCatalogConstants';
import { TREND_GROUPS } from '../constants/labTrendConstants';
import { parseDateDDMMYYYY } from './labFormattingController';
import type { ProcessedFindings } from './labAnalyticsContracts';

type BilirubinByColumn = Record<string, { total?: string; directa?: string; indirecta?: string }>;

const findTrendGroup = (analysis: string): string | null => {
  const lower = analysis.toLowerCase();
  for (const group of TREND_GROUPS) {
    if (group.patterns.some(p => lower.includes(p.toLowerCase()))) {
      return group.label;
    }
  }
  return null;
};

const comparisonSortIndex = (name: string): number => {
  const lower = name.toLowerCase();
  for (let i = 0; i < COMPARISON_ORDER.length; i++) {
    const entry = COMPARISON_ORDER[i];
    if (entry && lower.includes(entry.toLowerCase())) return i;
  }
  return COMPARISON_ORDER.length + 1;
};

/** Merge bilirrubina Total/Directa/Indirecta into a single comparison row. */
export const mergeBilirrubinas = (
  comparison: Record<string, Record<string, LabResultRow>>,
  bilirubinByCol: BilirubinByColumn
): void => {
  const entries = Object.entries(bilirubinByCol);
  if (entries.length === 0) return;

  const row: Record<string, LabResultRow> = {};
  comparison['Bilirrubinas (T/D/I)'] = row;
  for (const [col, b] of entries) {
    const merged = [b.total || '-', b.directa || '-', b.indirecta || '-'].join(' / ');
    row[col] = {
      section: 'PERFIL HEPATICO',
      analysis: 'Bilirrubinas (T/D/I)',
      result: merged,
      unit: 'mg/dL',
      refValue: '',
    };
  }
};

/** Build trend groups from the raw trend map. Only groups with 2+ data points. */
const buildTrendGroups = (trendMap: Record<string, LabTrendPoint[]>): LabTrendGroup[] => {
  const trendGroups: LabTrendGroup[] = [];
  for (const groupDef of TREND_GROUPS) {
    const variables: Record<string, LabTrendPoint[]> = {};
    for (const [name, points] of Object.entries(trendMap)) {
      if (findTrendGroup(name) === groupDef.label && points.length >= 2) {
        variables[name] = points.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
      }
    }
    if (Object.keys(variables).length > 0) {
      trendGroups.push({ label: groupDef.label, variables });
    }
  }
  return trendGroups;
};

/** Sort comparison keys by clinical priority order. */
const sortComparison = (
  comparison: Record<string, Record<string, LabResultRow>>
): Record<string, Record<string, LabResultRow>> => {
  const sorted: Record<string, Record<string, LabResultRow>> = {};
  const sortedKeys = Object.keys(comparison).sort(
    (a, b) => comparisonSortIndex(a) - comparisonSortIndex(b)
  );
  for (const key of sortedKeys) {
    const row = comparison[key];
    if (row) sorted[key] = row;
  }
  return sorted;
};

/** Sort column keys chronologically. */
const sortColumnKeys = (columnKeys: string[]): string[] =>
  columnKeys.sort((a, b) => {
    const isoA = parseDateDDMMYYYY(a.substring(0, 10));
    const isoB = parseDateDDMMYYYY(b.substring(0, 10));
    if (isoA !== isoB) return isoA.localeCompare(isoB);
    return a.localeCompare(b);
  });

const sortMicrobiologyEntries = (entries: LabMicrobiologyEntry[]): LabMicrobiologyEntry[] =>
  [...entries].sort((a, b) => {
    const isoA = parseDateDDMMYYYY(a.date.substring(0, 10));
    const isoB = parseDateDDMMYYYY(b.date.substring(0, 10));
    if (isoA !== isoB) return isoB.localeCompare(isoA);
    return b.date.localeCompare(a.date);
  });

export const buildAnalysisDataResult = (processed: ProcessedFindings): LabAnalysisData => ({
  trendGroups: buildTrendGroups(processed.trendMap),
  examDates: sortColumnKeys(processed.columnKeys),
  comparison: sortComparison(processed.comparison),
  microbiologyEntries: sortMicrobiologyEntries(processed.microbiologyEntries),
});
