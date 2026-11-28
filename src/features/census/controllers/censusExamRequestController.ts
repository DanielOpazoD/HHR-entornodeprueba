import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

import type { ExamRequestCandidate } from '@/features/census/components/exam-request/useExamRequestOrders';
import {
  hasExamRequestRecordIdentity,
  resolveExamRequestPatientIdentity,
} from '@/features/census/components/exam-request/examRequestPatientIdentity';

/**
 * Census patients a laboratory request may include, in bed order: the same rows that offer the
 * request, newborns as their own patient (ID-03), and only those an episode or a document tells
 * apart. Keyed by patient and episode; if one patient and episode shows in two beds, the first bed
 * stands for that person.
 */
export const listCensusExamRequestCandidates = (
  rows: readonly UnifiedBedRow[]
): ExamRequestCandidate[] => {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (
      row.kind !== 'occupied' ||
      row.data.isBlocked ||
      !row.data.patientName.trim() ||
      !hasExamRequestRecordIdentity(row.data)
    ) {
      return [];
    }
    const key = resolveExamRequestPatientIdentity(row.data);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: row.isSubRow ? `${row.bed.name} RN` : row.bed.name, patient: row.data }];
  });
};
