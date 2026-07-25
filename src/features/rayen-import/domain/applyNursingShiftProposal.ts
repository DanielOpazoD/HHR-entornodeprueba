import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type {
  NursingStaffingProposal,
  NursingShiftSuggestion,
} from '../contracts/nursingShiftInference';
import {
  buildDetailedStaffingPatch,
  getDetailedShiftRoleAssignments,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { nurseIdentityKey } from '@/services/staff/nurseIdentity';

const isVacant = (value: string | undefined): boolean => {
  const normalized = (value ?? '').trim().toLocaleLowerCase('es');
  return normalized === '' || normalized === '--' || normalized === 'vacante';
};

const resolveCurrentNames = (
  detail: ReturnType<typeof resolveDetailedStaffingState>,
  shift: 'day' | 'night'
): string[] => {
  const names = ['', ''];
  for (const assignment of getDetailedShiftRoleAssignments(detail, shift, 'nurse')) {
    if (
      assignment.slotType === 'standard' &&
      typeof assignment.standardSlotIndex === 'number' &&
      assignment.standardSlotIndex >= 0 &&
      assignment.standardSlotIndex < names.length
    ) {
      names[assignment.standardSlotIndex] = assignment.name || '';
    }
  }
  return names;
};

const resolveOccupiedNames = (
  detail: ReturnType<typeof resolveDetailedStaffingState>,
  shift: 'day' | 'night'
): string[] =>
  getDetailedShiftRoleAssignments(detail, shift, 'nurse')
    .map(assignment => assignment.name || '')
    .filter(Boolean);

const knownIdentityKeys = (suggestion: NursingShiftSuggestion, name: string): Set<string> => {
  const evidence = suggestion.candidates.find(candidate => candidate.name === name);
  return new Set([name, ...(evidence?.observedNames ?? [])].map(nurseIdentityKey));
};

const namesReferToSameNurse = (
  suggestion: NursingShiftSuggestion,
  left: string,
  right: string
): boolean => {
  const leftKeys = knownIdentityKeys(suggestion, left);
  return [...knownIdentityKeys(suggestion, right)].some(key => leftKeys.has(key));
};

const buildReplacementRoster = (
  suggestion: NursingShiftSuggestion,
  currentNames: string[],
  extraNames: string[]
): string[] | null => {
  if (suggestion.ambiguous || suggestion.names.length !== 2 || extraNames.length > 0) return null;
  const remaining = [...suggestion.names];
  const target = currentNames.map(current => {
    const matchIndex = remaining.findIndex(candidate =>
      namesReferToSameNurse(suggestion, current, candidate)
    );
    if (matchIndex < 0) return '';
    remaining.splice(matchIndex, 1);
    return current;
  });
  for (let index = 0; index < target.length; index += 1) {
    if (!target[index]) target[index] = remaining.shift() ?? '';
  }
  return target.every((name, index) => name === currentNames[index]) ? null : target;
};

const sameRoster = (left: string[] | undefined, right: string[]): boolean =>
  left?.length === right.length && left.every((name, index) => name === right[index]);

const includesAssignedName = (
  assignedNames: string[],
  candidate: string,
  suggestion: NursingShiftSuggestion
): boolean =>
  assignedNames.some(assigned =>
    knownIdentityKeys(suggestion, candidate).has(nurseIdentityKey(assigned))
  );

const constrainToVacancies = (
  suggestion: NursingShiftSuggestion,
  names: string[],
  vacancies: number
): { names: string[]; ambiguous: boolean } => {
  if (vacancies <= 0) return { names: [], ambiguous: suggestion.ambiguous };
  if (names.length <= vacancies) return { names, ambiguous: suggestion.ambiguous };
  const score = (name: string): number | undefined =>
    suggestion.candidates.find(candidate => candidate.name === name)?.score;
  const cutoffScore = score(names[vacancies - 1]);
  const nextScore = score(names[vacancies]);
  if (cutoffScore != null && cutoffScore === nextScore) {
    return { names: names.slice(0, Math.max(0, vacancies - 1)), ambiguous: true };
  }
  return { names: names.slice(0, vacancies), ambiguous: suggestion.ambiguous };
};

/** Removes already assigned nurses from the actionable proposal and keeps them as visible status. */
export const reconcileNursingShiftProposal = (
  record: DailyRecord,
  proposal: NursingStaffingProposal
): NursingStaffingProposal => {
  if (record.date !== proposal.censusDate) return proposal;
  const detail = resolveDetailedStaffingState(record, record.date);
  const reconciled = { ...proposal };

  for (const shift of ['day', 'night'] as const) {
    const assignments = getDetailedShiftRoleAssignments(detail, shift, 'nurse');
    const assignedNames = resolveOccupiedNames(detail, shift).filter(name => !isVacant(name));
    const currentNames = resolveCurrentNames(detail, shift);
    const extraNames = assignments
      .filter(assignment => assignment.slotType === 'extra' && !isVacant(assignment.name))
      .map(assignment => assignment.name);
    const candidatePool = proposal[shift].ambiguous
      ? proposal[shift].names
      : proposal[shift].candidates.map(candidate => candidate.name);
    const alreadyAssigned = candidatePool.filter(name =>
      includesAssignedName(assignedNames, name, proposal[shift])
    );
    const missingNames = candidatePool.filter(
      name => !includesAssignedName(assignedNames, name, proposal[shift])
    );
    const vacancies = currentNames.filter(isVacant).length;
    const constrained = constrainToVacancies(proposal[shift], missingNames, vacancies);
    const replacementRoster =
      !constrained.ambiguous && missingNames.length > vacancies
        ? buildReplacementRoster(proposal[shift], currentNames, extraNames)
        : null;
    reconciled[shift] = {
      ...proposal[shift],
      names: replacementRoster ?? constrained.names,
      ambiguous: constrained.ambiguous,
      alreadyAssigned,
      currentNames: replacementRoster ? currentNames : undefined,
      replaceStandardSlots: Boolean(replacementRoster),
    };
  }

  return reconciled;
};

export const hasNursingShiftReview = (proposal: NursingStaffingProposal): boolean =>
  proposal.day.names.length > 0 ||
  proposal.night.names.length > 0 ||
  (proposal.day.alreadyAssigned?.length ?? 0) > 0 ||
  (proposal.night.alreadyAssigned?.length ?? 0) > 0 ||
  proposal.day.ambiguous ||
  proposal.night.ambiguous;

/** Builds a consistent staffing patch; replacement requires an explicit reconciled proposal. */
export const buildNursingShiftProposalPatch = (
  record: DailyRecord,
  proposal: NursingStaffingProposal
): DailyRecordPatch | null => {
  if (record.date !== proposal.censusDate) return null;
  let detail = resolveDetailedStaffingState(record, record.date);
  let changed = false;

  for (const shift of ['day', 'night'] as const) {
    // Detailed staffing is the canonical source when present; its legacy arrays can briefly lag.
    const currentNames = resolveCurrentNames(detail, shift);
    if (proposal[shift].replaceStandardSlots) {
      const extraNames = getDetailedShiftRoleAssignments(detail, shift, 'nurse').filter(
        assignment => assignment.slotType === 'extra' && !isVacant(assignment.name)
      );
      if (
        proposal[shift].ambiguous ||
        proposal[shift].names.length !== 2 ||
        extraNames.length > 0 ||
        !sameRoster(proposal[shift].currentNames, currentNames)
      )
        continue;
      for (let slot = 0; slot < 2; slot += 1) {
        const replacement = proposal[shift].names[slot] ?? '';
        if (replacement === currentNames[slot]) continue;
        detail = updateDetailedStaffingStandardSlot(detail, shift, 'nurse', slot, replacement);
        changed = true;
      }
      continue;
    }
    const occupiedNames = resolveOccupiedNames(detail, shift).filter(name => !isVacant(name));
    const available: string[] = [];
    for (const name of proposal[shift].names) {
      if (
        !includesAssignedName(occupiedNames, name, proposal[shift]) &&
        !available.some(availableName =>
          namesReferToSameNurse(proposal[shift], availableName, name)
        )
      ) {
        available.push(name);
      }
    }
    const vacancies = currentNames.filter(isVacant).length;
    const constrained = constrainToVacancies(proposal[shift], available, vacancies).names;
    let suggestionIndex = 0;
    for (let slot = 0; slot < 2 && suggestionIndex < constrained.length; slot += 1) {
      if (!isVacant(currentNames[slot])) continue;
      detail = updateDetailedStaffingStandardSlot(
        detail,
        shift,
        'nurse',
        slot,
        constrained[suggestionIndex]
      );
      suggestionIndex += 1;
      changed = true;
    }
  }

  return changed ? buildDetailedStaffingPatch(detail) : null;
};
