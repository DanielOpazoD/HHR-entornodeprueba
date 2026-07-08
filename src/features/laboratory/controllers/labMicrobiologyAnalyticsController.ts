import type { LabResultRow, SyslabExamItem } from '@/types/domain/labExamTypes';
import type {
  LabMicrobiologyCategory,
  LabMicrobiologyEntry,
} from '@/types/domain/labAnalyticsTypes';
import { MICROBIOLOGY_PATTERNS } from '../constants/labExamConstants';
import { MICROBIOLOGY_CATEGORY_RULES } from '../constants/labMicrobiologyRuleConstants';

export const hasMicrobiologyPattern = (value: string): boolean => {
  const upper = value.toUpperCase();
  return MICROBIOLOGY_PATTERNS.some(pattern => upper.includes(pattern));
};

const hasAlertMicrobiologyResult = (result: string): boolean =>
  /(positivo|reactivo|detectado|aislado|presente|desarrollo|resistente|sensible)/i.test(result);

const getMicrobiologyCategoryMatchScore = (
  category: LabMicrobiologyCategory,
  finding: LabResultRow
): number => {
  const signature = `${finding.section} ${finding.analysis} ${finding.result}`.toUpperCase();
  const rule = MICROBIOLOGY_CATEGORY_RULES[category];

  if (rule.findingStrong.some(pattern => signature.includes(pattern))) {
    return 3;
  }

  if (rule.findingWeak.some(pattern => signature.includes(pattern))) {
    return 2;
  }

  return 0;
};

const getMicrobiologyCategoryForExamName = (examName: string): LabMicrobiologyCategory | null => {
  const upper = examName.toUpperCase();
  const matchingRule = Object.entries(MICROBIOLOGY_CATEGORY_RULES).find(([, rule]) =>
    rule.exam.some(pattern => upper.includes(pattern))
  );

  if (matchingRule) {
    return matchingRule[0] as LabMicrobiologyCategory;
  }

  return null;
};

export const resolveMicrobiologyCategoriesForExam = (
  exam: SyslabExamItem | undefined
): LabMicrobiologyCategory[] =>
  exam
    ? (Array.from(
        new Set((exam.exams || []).map(getMicrobiologyCategoryForExamName).filter(Boolean))
      ) as LabMicrobiologyCategory[])
    : [];

const appendMicrobiologyFinding = (
  findingsByCategory: Map<LabMicrobiologyCategory, Array<{ analysis: string; result: string }>>,
  category: LabMicrobiologyCategory,
  finding: LabResultRow
) => {
  const summaryEntry = { analysis: finding.analysis, result: finding.result };
  const categoryFindings = findingsByCategory.get(category) || [];
  if (
    categoryFindings.some(
      entry => entry.analysis === summaryEntry.analysis && entry.result === summaryEntry.result
    )
  ) {
    return;
  }

  findingsByCategory.set(category, [...categoryFindings, summaryEntry]);
};

export const resolveMicrobiologyCategoryForFinding = (
  finding: LabResultRow,
  availableCategories: LabMicrobiologyCategory[]
): LabMicrobiologyCategory | null => {
  const scoredCategories = availableCategories
    .map(category => ({
      category,
      score: getMicrobiologyCategoryMatchScore(category, finding),
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredCategories.length > 0) {
    return scoredCategories[0].category;
  }

  return null;
};

export const collectMicrobiologyFinding = (
  finding: LabResultRow,
  availableCategories: LabMicrobiologyCategory[],
  findingsByCategory: Map<LabMicrobiologyCategory, Array<{ analysis: string; result: string }>>
) => {
  const category = resolveMicrobiologyCategoryForFinding(finding, availableCategories);
  if (category) {
    appendMicrobiologyFinding(findingsByCategory, category, finding);
  }
};

const resolveMicrobiologyEntryLabel = (category: LabMicrobiologyCategory): string => {
  switch (category) {
    case 'clostridium_difficile':
      return 'Clostridium difficile';
    case 'coprocultivo':
      return 'Coprocultivo';
    case 'hemocultivo':
      return 'Hemocultivo';
    case 'urocultivo':
      return 'Urocultivo';
    case 'otros_cultivos':
      return 'Otros cultivos';
    case 'pcr_8_virus':
      return 'PCR 8 virus';
    case 'pcr_arbovirus':
      return 'PCR arbovirus';
  }
};

export const buildMicrobiologyEntriesForExam = (input: {
  exam: SyslabExamItem | undefined;
  date: string;
  categories: LabMicrobiologyCategory[];
  findingsByCategory: Map<LabMicrobiologyCategory, Array<{ analysis: string; result: string }>>;
}): LabMicrobiologyEntry[] => {
  if (!input.exam) {
    return [];
  }

  const exam = input.exam;

  return input.categories.map(category => {
    const findings = input.findingsByCategory.get(category) || [];
    return {
      category,
      date: input.date,
      examLabel: resolveMicrobiologyEntryLabel(category),
      findings,
      hasAlertFinding: findings.some(entry => hasAlertMicrobiologyResult(entry.result)),
      sourceExam: exam,
    };
  });
};
