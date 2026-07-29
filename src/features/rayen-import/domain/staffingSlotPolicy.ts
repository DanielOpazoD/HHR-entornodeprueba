import type { NursingShiftSuggestion } from '../contracts/nursingShiftInference';
import { namesReferToSameStaffMember } from './staffIdentityReconciliation';

export type NursingStaffingProposalKey = 'day' | 'night' | 'tensDay' | 'tensNight';

export const NURSING_STAFFING_STANDARD_SLOTS: Readonly<Record<NursingStaffingProposalKey, number>> =
  {
    day: 2,
    night: 2,
    tensDay: 3,
    tensNight: 3,
  };

const countDistinctStaffMembers = (
  names: Array<string | undefined>,
  suggestion: NursingShiftSuggestion
): number => {
  const distinct: string[] = [];
  for (const name of names) {
    if (!name?.trim()) continue;
    if (!distinct.some(current => namesReferToSameStaffMember(suggestion, current, name))) {
      distinct.push(name);
    }
  }
  return distinct.length;
};

/** An evidence tie needs review only while a standard staffing slot remains unresolved. */
export const hasUnresolvedStaffingAmbiguity = (
  suggestion: NursingShiftSuggestion,
  standardSlots: number
): boolean => {
  if (!suggestion.ambiguous) return false;
  const coveredSlots = countDistinctStaffMembers(
    [...suggestion.names, ...(suggestion.alreadyAssigned ?? [])],
    suggestion
  );
  return coveredSlots < standardSlots;
};
