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
import {
  deduplicateSuggestedPeople,
  hasAmbiguousOccupiedStaffAlias,
  namesReferToSameStaffMember,
} from './staffIdentityReconciliation';
import { NURSING_STAFFING_STANDARD_SLOTS } from './staffingSlotPolicy';

type StaffingRole = 'nurse' | 'tens';
type ProposalKey = 'day' | 'night' | 'tensDay' | 'tensNight';

const STAFFING_TARGETS: ReadonlyArray<{
  key: ProposalKey;
  shift: 'day' | 'night';
  role: StaffingRole;
  slots: number;
  allowReplacement: boolean;
}> = [
  {
    key: 'day',
    shift: 'day',
    role: 'nurse',
    slots: NURSING_STAFFING_STANDARD_SLOTS.day,
    allowReplacement: true,
  },
  {
    key: 'night',
    shift: 'night',
    role: 'nurse',
    slots: NURSING_STAFFING_STANDARD_SLOTS.night,
    allowReplacement: true,
  },
  {
    key: 'tensDay',
    shift: 'day',
    role: 'tens',
    slots: NURSING_STAFFING_STANDARD_SLOTS.tensDay,
    allowReplacement: false,
  },
  {
    key: 'tensNight',
    shift: 'night',
    role: 'tens',
    slots: NURSING_STAFFING_STANDARD_SLOTS.tensNight,
    allowReplacement: false,
  },
];

const isVacant = (value: string | undefined): boolean => {
  const normalized = (value ?? '').trim().toLocaleLowerCase('es');
  return normalized === '' || normalized === '--' || normalized === 'vacante';
};

const resolveCurrentNames = (
  detail: ReturnType<typeof resolveDetailedStaffingState>,
  shift: 'day' | 'night',
  role: StaffingRole,
  slots: number
): string[] => {
  const names = Array.from({ length: slots }, () => '');
  for (const assignment of getDetailedShiftRoleAssignments(detail, shift, role)) {
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
  shift: 'day' | 'night',
  role: StaffingRole
): string[] =>
  getDetailedShiftRoleAssignments(detail, shift, role)
    .map(assignment => assignment.name || '')
    .filter(Boolean);

const buildReplacementRoster = (
  suggestion: NursingShiftSuggestion,
  currentNames: string[],
  extraNames: string[]
): string[] | null => {
  if (suggestion.ambiguous || suggestion.names.length !== 2 || extraNames.length > 0) return null;
  const remaining = [...suggestion.names];
  const target = currentNames.map(current => {
    const matchIndex = remaining.findIndex(candidate =>
      namesReferToSameStaffMember(suggestion, current, candidate)
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
  assignedNames.some(assigned => namesReferToSameStaffMember(suggestion, assigned, candidate));

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

  for (const target of STAFFING_TARGETS) {
    const suggestion = proposal[target.key];
    if (!suggestion) continue;
    const assignments = getDetailedShiftRoleAssignments(detail, target.shift, target.role);
    const assignedNames = resolveOccupiedNames(detail, target.shift, target.role).filter(
      name => !isVacant(name)
    );
    const currentNames = resolveCurrentNames(detail, target.shift, target.role, target.slots);
    const extraNames = assignments
      .filter(assignment => assignment.slotType === 'extra' && !isVacant(assignment.name))
      .map(assignment => assignment.name);
    const candidateResolution = deduplicateSuggestedPeople(
      suggestion.ambiguous
        ? suggestion.names
        : suggestion.candidates.map(candidate => candidate.name),
      suggestion
    );
    const replacementResolution = deduplicateSuggestedPeople(suggestion.names, suggestion);
    const identityAmbiguous = hasAmbiguousOccupiedStaffAlias(
      suggestion,
      assignedNames,
      candidateResolution.names
    );
    const effectiveSuggestion: NursingShiftSuggestion = {
      ...suggestion,
      names: replacementResolution.names,
      ambiguous:
        suggestion.ambiguous ||
        candidateResolution.ambiguous ||
        replacementResolution.ambiguous ||
        identityAmbiguous,
    };
    const candidatePool = candidateResolution.names;
    const alreadyAssigned = candidatePool.filter(name =>
      includesAssignedName(assignedNames, name, effectiveSuggestion)
    );
    const missingNames = candidatePool.filter(
      name => !includesAssignedName(assignedNames, name, effectiveSuggestion)
    );
    const vacancies = currentNames.filter(isVacant).length;
    const constrained = identityAmbiguous
      ? { names: [], ambiguous: true }
      : constrainToVacancies(effectiveSuggestion, missingNames, vacancies);
    const replacementRoster =
      target.allowReplacement && !constrained.ambiguous && missingNames.length > vacancies
        ? buildReplacementRoster(effectiveSuggestion, currentNames, extraNames)
        : null;
    reconciled[target.key] = {
      ...suggestion,
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
  [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(suggestion =>
    Boolean(
      suggestion &&
      (suggestion.names.length > 0 ||
        (suggestion.alreadyAssigned?.length ?? 0) > 0 ||
        suggestion.ambiguous)
    )
  );

/** True when cancelling the modal discards an unresolved staffing decision. */
export const hasPendingStaffingDecision = (proposal: NursingStaffingProposal): boolean =>
  [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(suggestion =>
    Boolean(suggestion && (suggestion.names.length > 0 || suggestion.ambiguous))
  );

/** Builds a consistent staffing patch; replacement requires an explicit reconciled proposal. */
export const buildNursingShiftProposalPatch = (
  record: DailyRecord,
  proposal: NursingStaffingProposal
): DailyRecordPatch | null => {
  if (record.date !== proposal.censusDate) return null;
  let detail = resolveDetailedStaffingState(record, record.date);
  let changed = false;

  for (const target of STAFFING_TARGETS) {
    const suggestion = proposal[target.key];
    if (!suggestion) continue;
    const identityResolution = deduplicateSuggestedPeople(suggestion.names, suggestion);
    const effectiveSuggestion: NursingShiftSuggestion = {
      ...suggestion,
      names: identityResolution.names,
      ambiguous: identityResolution.ambiguous,
    };
    // `suggestion.ambiguous` may describe only an unresolved remaining slot. The names
    // emitted by inference/reconciliation before that tie are still safe to persist.
    // Only quarantine the actionable subset when its own identity resolution is ambiguous.
    if (identityResolution.ambiguous) continue;
    // Detailed staffing is the canonical source when present; its legacy arrays can briefly lag.
    const currentNames = resolveCurrentNames(detail, target.shift, target.role, target.slots);
    const occupiedNames = resolveOccupiedNames(detail, target.shift, target.role).filter(
      name => !isVacant(name)
    );
    if (
      hasAmbiguousOccupiedStaffAlias(effectiveSuggestion, occupiedNames, effectiveSuggestion.names)
    ) {
      continue;
    }
    if (effectiveSuggestion.replaceStandardSlots) {
      if (!target.allowReplacement) continue;
      const extraNames = getDetailedShiftRoleAssignments(detail, target.shift, target.role).filter(
        assignment => assignment.slotType === 'extra' && !isVacant(assignment.name)
      );
      if (
        effectiveSuggestion.names.length !== target.slots ||
        extraNames.length > 0 ||
        !sameRoster(effectiveSuggestion.currentNames, currentNames)
      )
        continue;
      for (let slot = 0; slot < target.slots; slot += 1) {
        const replacement = effectiveSuggestion.names[slot] ?? '';
        if (replacement === currentNames[slot]) continue;
        detail = updateDetailedStaffingStandardSlot(
          detail,
          target.shift,
          target.role,
          slot,
          replacement
        );
        changed = true;
      }
      continue;
    }
    const available: string[] = [];
    for (const name of effectiveSuggestion.names) {
      if (
        !includesAssignedName(occupiedNames, name, effectiveSuggestion) &&
        !available.some(availableName =>
          namesReferToSameStaffMember(effectiveSuggestion, availableName, name)
        )
      ) {
        available.push(name);
      }
    }
    const vacancies = currentNames.filter(isVacant).length;
    const constrained = constrainToVacancies(effectiveSuggestion, available, vacancies).names;
    let suggestionIndex = 0;
    for (let slot = 0; slot < target.slots && suggestionIndex < constrained.length; slot += 1) {
      if (!isVacant(currentNames[slot])) continue;
      detail = updateDetailedStaffingStandardSlot(
        detail,
        target.shift,
        target.role,
        slot,
        constrained[suggestionIndex]
      );
      suggestionIndex += 1;
      changed = true;
    }
  }

  return changed ? buildDetailedStaffingPatch(detail) : null;
};
