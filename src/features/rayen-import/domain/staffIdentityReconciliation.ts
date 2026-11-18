import type {
  NursingShiftEvidence,
  NursingShiftSuggestion,
} from '../contracts/nursingShiftInference';
import { toShortNurseName } from '@/services/staff/nurseIdentity';
import { staffNameTokens, staffRowKey } from '@/services/staff/eloisaStaffIdentity';

// Who a name is comes from the staff identity module, over the role list of the proposal: two
// rows of that list are two people even when their names fold alike («Luz Pena», «Luz Peña»).
// A person Eloísa accredits for the first time in this run is a row of their own as well.
const keyOf = (suggestion: NursingShiftSuggestion, name: string): string =>
  staffRowKey(name, [...(suggestion.catalogNames ?? []), ...(suggestion.uncataloguedPeople ?? [])]);

const identityTokenCount = (name: string): number => staffNameTokens(name).length;

const identityTokens = (name: string): string[] => staffNameTokens(name);

const isExactCatalogIdentity = (suggestion: NursingShiftSuggestion, name: string): boolean =>
  (suggestion.catalogNames ?? []).some(
    catalogName => keyOf(suggestion, catalogName) === keyOf(suggestion, name)
  );

const candidateCanonicalKey = (
  suggestion: NursingShiftSuggestion,
  candidate: NursingShiftEvidence
): string => keyOf(suggestion, candidate.name);

const isExactCandidateIdentity = (suggestion: NursingShiftSuggestion, name: string): boolean =>
  suggestion.candidates.some(
    candidate => candidateCanonicalKey(suggestion, candidate) === keyOf(suggestion, name)
  );

const canRepresentStructuredAlias = (alias: string, fullName: string): boolean => {
  const aliasTokens = identityTokens(alias);
  const fullTokens = identityTokens(fullName);
  if (aliasTokens.length < 2 || fullTokens.length <= aliasTokens.length) return false;
  const surnameTokens = aliasTokens.slice(1);
  const surnameStart = fullTokens
    .slice(1)
    .findIndex((_token, index, remainingTokens) =>
      surnameTokens.every(
        (surnameToken, offset) => remainingTokens[index + offset] === surnameToken
      )
    );
  return aliasTokens[0] === fullTokens[0] && surnameStart >= 0;
};

const catalogTargetKeys = (suggestion: NursingShiftSuggestion, shortName: string): Set<string> =>
  new Set(
    (suggestion.catalogNames ?? [])
      .filter(catalogName => canRepresentStructuredAlias(shortName, catalogName))
      .map(name => keyOf(suggestion, name))
  );

const aliasTargetKeys = (suggestion: NursingShiftSuggestion): Map<string, Set<string>> => {
  const targets = new Map<string, Set<string>>();
  for (const candidate of suggestion.candidates) {
    const canonicalKey = candidateCanonicalKey(suggestion, candidate);
    for (const alias of [
      ...(candidate.identityAliases ?? []),
      ...(candidate.observedNames ?? []),
    ]) {
      const aliasKey = keyOf(suggestion, alias);
      const candidates = targets.get(aliasKey) ?? new Set<string>();
      candidates.add(canonicalKey);
      targets.set(aliasKey, candidates);
    }
  }
  return targets;
};

const candidateKeysForName = (suggestion: NursingShiftSuggestion, name: string): Set<string> => {
  const nameKey = keyOf(suggestion, name);
  const exactCandidate = suggestion.candidates.find(
    candidate => candidateCanonicalKey(suggestion, candidate) === nameKey
  );
  if (exactCandidate) return new Set([candidateCanonicalKey(suggestion, exactCandidate)]);

  const matches = new Set<string>();
  for (const candidate of suggestion.candidates) {
    const evidenceKeys = [
      ...(candidate.identityAliases ?? []),
      ...(candidate.observedNames ?? []),
    ].map(name => keyOf(suggestion, name));
    if (evidenceKeys.includes(nameKey)) matches.add(candidateCanonicalKey(suggestion, candidate));
  }
  return matches;
};

const knownCanonicalNames = (suggestion: NursingShiftSuggestion): string[] => [
  ...suggestion.names,
  ...(suggestion.catalogNames ?? []),
  ...suggestion.candidates.map(candidate => candidate.name),
];

const fallbackLongVariantCount = (suggestion: NursingShiftSuggestion, coreKey: string): number =>
  new Set(
    knownCanonicalNames(suggestion)
      .filter(
        name =>
          identityTokenCount(name) > 2 && keyOf(suggestion, toShortNurseName(name)) === coreKey
      )
      .map(name => keyOf(suggestion, name))
  ).size;

/** True when an occupied short label can resolve to more than one full identity. */
export const hasAmbiguousOccupiedStaffAlias = (
  suggestion: NursingShiftSuggestion,
  occupiedNames: string[],
  proposedNames: string[]
): boolean => {
  const aliases = aliasTargetKeys(suggestion);

  return occupiedNames.some(occupiedName => {
    const coreKey = keyOf(suggestion, occupiedName);
    const verifiedTargets = new Set(aliases.get(coreKey) ?? []);
    const verifiedAlternativeTargets = new Set(
      [...verifiedTargets].filter(targetKey => targetKey !== coreKey)
    );
    if (
      verifiedAlternativeTargets.size === 0 &&
      isExactCandidateIdentity(suggestion, occupiedName)
    ) {
      return false;
    }
    if (verifiedTargets.size === 0 && identityTokenCount(occupiedName) !== 2) return false;
    const possibleKeys = new Set([
      ...verifiedTargets,
      ...catalogTargetKeys(suggestion, occupiedName),
    ]);
    for (const occupiedCandidateKey of candidateKeysForName(suggestion, occupiedName)) {
      possibleKeys.add(occupiedCandidateKey);
    }
    const compatibleProposedNames = proposedNames.filter(
      proposedName =>
        [...candidateKeysForName(suggestion, proposedName)].some(key => possibleKeys.has(key)) ||
        canRepresentStructuredAlias(occupiedName, proposedName)
    );
    if (compatibleProposedNames.length === 0) return false;
    if (
      verifiedTargets.size === 0 &&
      isExactCatalogIdentity(suggestion, occupiedName) &&
      compatibleProposedNames.every(name => isExactCatalogIdentity(suggestion, name))
    ) {
      return false;
    }
    if (verifiedTargets.size === 0) return true;

    // Existing full labels are additional ambiguity evidence. This prefix check
    // only makes reconciliation more conservative; it never establishes equality.
    for (const otherOccupiedName of occupiedNames) {
      if (
        identityTokenCount(otherOccupiedName) > 2 &&
        canRepresentStructuredAlias(occupiedName, otherOccupiedName)
      ) {
        possibleKeys.add(keyOf(suggestion, otherOccupiedName));
      }
    }
    return possibleKeys.size > 1;
  });
};

/** Resolves equality only through exact names or candidate-scoped Eloisa evidence. */
export const namesReferToSameStaffMember = (
  suggestion: NursingShiftSuggestion,
  left: string,
  right: string
): boolean => {
  if (keyOf(suggestion, left) === keyOf(suggestion, right)) return true;
  const leftCandidates = candidateKeysForName(suggestion, left);
  const rightCandidates = candidateKeysForName(suggestion, right);
  const uniqueSharedCandidate =
    leftCandidates.size === 1 &&
    rightCandidates.size === 1 &&
    [...leftCandidates][0] === [...rightCandidates][0];
  if (uniqueSharedCandidate) return true;
  if (isExactCatalogIdentity(suggestion, left) && isExactCatalogIdentity(suggestion, right)) {
    return false;
  }
  return false;
};

export interface DeduplicatedStaffPeople {
  names: string[];
  ambiguous: boolean;
}

/** Deduplicates one proposal per person and quarantines unresolved short aliases. */
export const deduplicateSuggestedPeople = (
  names: string[],
  suggestion: NursingShiftSuggestion
): DeduplicatedStaffPeople => {
  const namesByIdentity = new Map<string, string>();
  for (const name of names) {
    const key = keyOf(suggestion, name);
    if (!namesByIdentity.has(key)) namesByIdentity.set(key, name);
  }
  const uniqueNames = [...namesByIdentity.values()];
  const selectedKeys = new Set(uniqueNames.map(name => keyOf(suggestion, name)));
  const collapsedShortKeys = new Set<string>();
  const aliases = aliasTargetKeys(suggestion);
  let ambiguous = false;

  for (const name of uniqueNames) {
    const shortKey = keyOf(suggestion, name);
    const verifiedTargets = aliases.get(shortKey) ?? new Set<string>();
    const targets = new Set([...verifiedTargets, ...catalogTargetKeys(suggestion, name)]);
    const selectedTargets = [...targets].filter(key => selectedKeys.has(key));

    if (isExactCandidateIdentity(suggestion, name)) {
      const conflictingTargets = [...verifiedTargets].filter(targetKey => targetKey !== shortKey);
      if (conflictingTargets.length > 0) ambiguous = true;
      continue;
    }

    if (verifiedTargets.size > 0 && targets.size > 0 && selectedTargets.length === targets.size) {
      collapsedShortKeys.add(shortKey);
      continue;
    }
    if (targets.size > 1 || (selectedTargets.length > 0 && selectedTargets.length < targets.size)) {
      ambiguous = true;
      continue;
    }
    if (verifiedTargets.size > 0) continue;
    if (identityTokenCount(name) !== 2) continue;
    if (
      !isExactCatalogIdentity(suggestion, name) &&
      uniqueNames.some(selectedName => canRepresentStructuredAlias(name, selectedName))
    ) {
      ambiguous = true;
      continue;
    }
    // Legacy proposals without structured aliases remain conservative when more
    // than one longer canonical identity shares the old two-token convention.
    if (targets.size === 0 && fallbackLongVariantCount(suggestion, shortKey) > 1) {
      ambiguous = true;
    }
  }

  return {
    names: uniqueNames.filter(name => !collapsedShortKeys.has(keyOf(suggestion, name))),
    ambiguous,
  };
};
