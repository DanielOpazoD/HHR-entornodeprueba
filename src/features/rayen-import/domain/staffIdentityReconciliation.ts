import type {
  NursingShiftEvidence,
  NursingShiftSuggestion,
} from '../contracts/nursingShiftInference';
import { nurseIdentityKey, toShortNurseName } from '@/services/staff/nurseIdentity';

const identityTokenCount = (name: string): number => nurseIdentityKey(name).split(' ').length;

const identityTokens = (name: string): string[] => nurseIdentityKey(name).split(' ');

const shortIdentityKey = (name: string): string => nurseIdentityKey(toShortNurseName(name));

const isExactCatalogIdentity = (suggestion: NursingShiftSuggestion, name: string): boolean =>
  (suggestion.catalogNames ?? []).some(
    catalogName => nurseIdentityKey(catalogName) === nurseIdentityKey(name)
  );

const candidateCanonicalKey = (candidate: NursingShiftEvidence): string =>
  nurseIdentityKey(candidate.name);

const isExactCandidateIdentity = (suggestion: NursingShiftSuggestion, name: string): boolean =>
  suggestion.candidates.some(
    candidate => candidateCanonicalKey(candidate) === nurseIdentityKey(name)
  );

const canRepresentStructuredAlias = (alias: string, fullName: string): boolean => {
  const aliasTokens = identityTokens(alias);
  const fullTokens = identityTokens(fullName);
  if (aliasTokens.length < 2 || fullTokens.length <= aliasTokens.length) return false;
  const surnameTokens = aliasTokens.slice(1);
  const surnameStart = fullTokens
    .slice(1)
    .findIndex((token, index, remainingTokens) =>
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
      .map(nurseIdentityKey)
  );

const aliasTargetKeys = (suggestion: NursingShiftSuggestion): Map<string, Set<string>> => {
  const targets = new Map<string, Set<string>>();
  for (const candidate of suggestion.candidates) {
    const canonicalKey = candidateCanonicalKey(candidate);
    for (const alias of [
      ...(candidate.identityAliases ?? []),
      ...(candidate.observedNames ?? []),
    ]) {
      const aliasKey = nurseIdentityKey(alias);
      const candidates = targets.get(aliasKey) ?? new Set<string>();
      candidates.add(canonicalKey);
      targets.set(aliasKey, candidates);
    }
  }
  return targets;
};

const candidateKeysForName = (suggestion: NursingShiftSuggestion, name: string): Set<string> => {
  const nameKey = nurseIdentityKey(name);
  const exactCandidate = suggestion.candidates.find(
    candidate => candidateCanonicalKey(candidate) === nameKey
  );
  if (exactCandidate) return new Set([candidateCanonicalKey(exactCandidate)]);

  const matches = new Set<string>();
  for (const candidate of suggestion.candidates) {
    const evidenceKeys = [
      ...(candidate.identityAliases ?? []),
      ...(candidate.observedNames ?? []),
    ].map(nurseIdentityKey);
    if (evidenceKeys.includes(nameKey)) matches.add(candidateCanonicalKey(candidate));
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
      .filter(name => identityTokenCount(name) > 2 && shortIdentityKey(name) === coreKey)
      .map(nurseIdentityKey)
  ).size;

/** True when an occupied short label can resolve to more than one full identity. */
export const hasAmbiguousOccupiedStaffAlias = (
  suggestion: NursingShiftSuggestion,
  occupiedNames: string[],
  proposedNames: string[]
): boolean => {
  const aliases = aliasTargetKeys(suggestion);

  return occupiedNames.some(occupiedName => {
    const coreKey = nurseIdentityKey(occupiedName);
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
        possibleKeys.add(nurseIdentityKey(otherOccupiedName));
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
  if (nurseIdentityKey(left) === nurseIdentityKey(right)) return true;
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
    const key = nurseIdentityKey(name);
    if (!namesByIdentity.has(key)) namesByIdentity.set(key, name);
  }
  const uniqueNames = [...namesByIdentity.values()];
  const selectedKeys = new Set(uniqueNames.map(nurseIdentityKey));
  const collapsedShortKeys = new Set<string>();
  const aliases = aliasTargetKeys(suggestion);
  let ambiguous = false;

  for (const name of uniqueNames) {
    const shortKey = nurseIdentityKey(name);
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
    names: uniqueNames.filter(name => !collapsedShortKeys.has(nurseIdentityKey(name))),
    ambiguous,
  };
};
