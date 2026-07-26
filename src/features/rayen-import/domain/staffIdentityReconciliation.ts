import type { NursingShiftSuggestion } from '../contracts/nursingShiftInference';
import {
  areNurseNameVariants,
  nurseIdentityKey,
  toShortNurseName,
} from '@/services/staff/nurseIdentity';

const knownIdentityNames = (suggestion: NursingShiftSuggestion, name: string): string[] => {
  const evidence = suggestion.candidates.find(candidate => candidate.name === name);
  return [
    ...new Map(
      [name, ...(evidence?.observedNames ?? [])].map(identityName => [
        nurseIdentityKey(identityName),
        identityName,
      ])
    ).values(),
  ];
};

const identityTokenCount = (name: string): number => nurseIdentityKey(name).split(' ').length;

const shortIdentityKey = (name: string): string => nurseIdentityKey(toShortNurseName(name));

const knownSuggestionNames = (suggestion: NursingShiftSuggestion): string[] => [
  ...suggestion.names,
  ...(suggestion.catalogNames ?? []),
  ...suggestion.candidates.map(candidate => candidate.name),
];

const isExactCatalogIdentity = (suggestion: NursingShiftSuggestion, name: string): boolean =>
  (suggestion.catalogNames ?? []).some(
    catalogName => nurseIdentityKey(catalogName) === nurseIdentityKey(name)
  );

const hasMultipleLongVariants = (
  suggestion: NursingShiftSuggestion,
  coreKey: string,
  comparedNames: string[]
): boolean => {
  const fullNames = [...knownSuggestionNames(suggestion), ...comparedNames].filter(
    name => identityTokenCount(name) > 2 && shortIdentityKey(name) === coreKey
  );
  return new Set(fullNames.map(nurseIdentityKey)).size > 1;
};

/** True when an occupied short label could denote more than one proposed full identity. */
export const hasAmbiguousOccupiedStaffAlias = (
  suggestion: NursingShiftSuggestion,
  occupiedNames: string[],
  proposedNames: string[]
): boolean =>
  occupiedNames.some(occupiedName => {
    if (identityTokenCount(occupiedName) !== 2) return false;
    const coreKey = shortIdentityKey(occupiedName);
    const hasCompatibleProposal = proposedNames.some(
      proposedName =>
        identityTokenCount(proposedName) > 2 && shortIdentityKey(proposedName) === coreKey
    );
    return (
      hasCompatibleProposal &&
      hasMultipleLongVariants(suggestion, coreKey, [...occupiedNames, ...proposedNames])
    );
  });

/** Uses HHR's name + first-surname convention only when it resolves to one full identity. */
export const namesReferToSameStaffMember = (
  suggestion: NursingShiftSuggestion,
  left: string,
  right: string
): boolean => {
  // Exact occupied labels are always the same assignment, even when mapping that
  // short label to one of several longer identities would require human review.
  if (nurseIdentityKey(left) === nurseIdentityKey(right)) return true;
  const leftNames = knownIdentityNames(suggestion, left);
  const rightNames = knownIdentityNames(suggestion, right);
  return leftNames.some(leftName =>
    rightNames.some(rightName => {
      if (nurseIdentityKey(leftName) === nurseIdentityKey(rightName)) {
        return (
          identityTokenCount(leftName) > 2 ||
          !hasMultipleLongVariants(suggestion, shortIdentityKey(leftName), [leftName, rightName])
        );
      }
      if (!areNurseNameVariants(leftName, rightName)) return false;
      // Two distinct exact catalog entries may be homonyms. Only explicit observed-name
      // evidence (handled by the exact-key branch above) may link those identities.
      if (
        isExactCatalogIdentity(suggestion, leftName) &&
        isExactCatalogIdentity(suggestion, rightName)
      ) {
        return false;
      }
      return !hasMultipleLongVariants(suggestion, shortIdentityKey(leftName), [
        leftName,
        rightName,
      ]);
    })
  );
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
  const collapsedShortKeys = new Set<string>();
  const knownFullVariantsByCore = new Map<string, Set<string>>();
  for (const name of knownSuggestionNames(suggestion)) {
    if (identityTokenCount(name) <= 2) continue;
    const coreKey = shortIdentityKey(name);
    const variants = knownFullVariantsByCore.get(coreKey) ?? new Set<string>();
    variants.add(nurseIdentityKey(name));
    knownFullVariantsByCore.set(coreKey, variants);
  }
  let ambiguous = false;
  for (const name of uniqueNames) {
    if (identityTokenCount(name) !== 2) continue;
    const coreKey = shortIdentityKey(name);
    const selectedLongVariants = uniqueNames.filter(
      selectedName =>
        identityTokenCount(selectedName) > 2 && shortIdentityKey(selectedName) === coreKey
    );
    const shortIsCatalogIdentity = isExactCatalogIdentity(suggestion, name);
    const knownVariantCount = knownFullVariantsByCore.get(coreKey)?.size ?? 0;
    const selectedLongKeys = new Set(selectedLongVariants.map(nurseIdentityKey));
    const allKnownVariantsSelected = [...(knownFullVariantsByCore.get(coreKey) ?? [])].every(key =>
      selectedLongKeys.has(key)
    );
    if (!shortIsCatalogIdentity && selectedLongVariants.length > 0 && allKnownVariantsSelected) {
      collapsedShortKeys.add(nurseIdentityKey(name));
      continue;
    }
    ambiguous ||= selectedLongVariants.length > 1 || knownVariantCount > 1;
  }
  return {
    names: uniqueNames.filter(name => !collapsedShortKeys.has(nurseIdentityKey(name))),
    ambiguous,
  };
};
