export interface NurseCatalogIdentity {
  key: string;
  displayName: string;
  catalogMatched: boolean;
}

export interface NurseAuthorIdentityParts {
  firstGivenName: string;
  firstSurname: string;
}

/**
 * A name's identity text. Only what the hospital treats as the same name folds: case, spacing,
 * the acute accent, the diaeresis and the tilde of the ñ. A cedilla, grave, circumflex or any
 * other mark keeps two names apart («França» is not «Franca»).
 */
const normalizeIdentityText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0301\u0308]/g, '')
    .replace(/([nN])\u0303/g, '$1')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');

const marks = (name: string) => (name.normalize('NFD').match(/\p{M}/gu) ?? []).length;
const letters = (name: string) =>
  name.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/** The same written text, apart from case and spacing (which never tell two people apart). */
export const sameStaffText = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/** Two spellings of the same letters, whatever their marks: only these choose between them. */
export const isSpellingOf = (left: string, right: string): boolean =>
  letters(left) === letters(right);

const normalizeDisplayName = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
    .replace(
      /(^|[\s'’-])(\p{L})/gu,
      (_match, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase('es')}`
    );

const tokens = (value: string): string[] => normalizeIdentityText(value).split(' ').filter(Boolean);

export const nurseIdentityKey = (value: string): string => normalizeIdentityText(value);

/**
 * The spelling kept for one person: a spelling of the same letters with more marks replaces the
 * kept one («Peña» over «Pena», «Françoise» over «Francoise»); anything else keeps it.
 */
export const preferredStaffName = (kept: string, incoming: string): string =>
  isSpellingOf(kept, incoming) && marks(incoming) > marks(kept) ? incoming : kept;

export const uniqueStaffNames = (names: string[]): string[] => {
  const preferred = new Map<string, string>();
  for (const name of names) {
    const key = nurseIdentityKey(name);
    const previous = preferred.get(key);
    preferred.set(key, previous === undefined ? name : preferredStaffName(previous, name));
  }
  return [...preferred.values()];
};

export const toShortNurseName = (value: string): string => {
  const normalized = normalizeDisplayName(value);
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join(' ') : normalized;
};

/** The role list as identities: one per row, never joining two rows that spell alike. */
export const buildNurseCatalogIdentities = (nurseCatalog: string[]): NurseCatalogIdentity[] => {
  return formatNurseCatalogNames(nurseCatalog)
    .filter(displayName => tokens(displayName).length >= 2)
    .map(displayName => ({
      key: normalizeIdentityText(displayName),
      displayName,
      catalogMatched: true,
    }));
};

/**
 * A nurse list as shown: each name re-capitalized, the same text once. It never joins two rows
 * that spell alike: the list already has one row per person (`staffCatalogRows`).
 */
export const formatNurseCatalogNames = (nurseCatalog: string[]): string[] => [
  ...new Set(nurseCatalog.map(normalizeDisplayName).filter(Boolean)),
];

export const reconcileNurseCatalogNames = (nurseCatalog: string[]): string[] => {
  return uniqueStaffNames(nurseCatalog.map(normalizeDisplayName).filter(Boolean));
};

/** Reconciles Eloísa's full name with HHR's curated "name + surname" catalog. */
export const resolveNurseIdentity = (
  author: string,
  catalog: NurseCatalogIdentity[],
  authorIdentity?: NurseAuthorIdentityParts
): NurseCatalogIdentity | null => {
  const remoteTokens = tokens(author);
  const firstToken = remoteTokens[0];
  if (remoteTokens.length < 2 || !firstToken) return null;
  // A few Eloísa fields concatenate "date - time - author - role". If an old
  // extension sends that label unparsed, it must never become a fake nurse.
  if (/^\d{1,4}[-/]/.test(firstToken)) return null;
  const remoteKey = normalizeIdentityText(author);
  // The same written row first; a spelling that folds like two rows is neither of them.
  const sameKey = catalog.filter(candidate => candidate.key === remoteKey);
  const exactMatch =
    sameKey.find(candidate => sameStaffText(candidate.displayName) === sameStaffText(author)) ??
    (sameKey.length === 1 ? sameKey[0] : undefined);
  if (exactMatch)
    return {
      ...exactMatch,
      displayName: preferredStaffName(exactMatch.displayName, normalizeDisplayName(author)),
    };
  if (authorIdentity) {
    const firstGivenName = normalizeIdentityText(authorIdentity.firstGivenName);
    const firstSurname = normalizeIdentityText(authorIdentity.firstSurname);
    const compatibleCatalogIdentities = catalog.filter(candidate => {
      const candidateTokens = tokens(candidate.displayName);
      return (
        candidateTokens[0] === firstGivenName && candidateTokens.slice(1).includes(firstSurname)
      );
    });
    if (compatibleCatalogIdentities.length === 1) return compatibleCatalogIdentities[0] ?? null;
    if (compatibleCatalogIdentities.length > 1) return null;
  }
  const displayName = normalizeDisplayName(author);
  return {
    key: normalizeIdentityText(displayName),
    displayName,
    catalogMatched: false,
  };
};

export const reconcileSelectedNurseName = (value: string, nurseCatalog: string[]): string => {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return '';
  const sameKey = buildNurseCatalogIdentities(nurseCatalog)
    .filter(candidate => candidate.key === normalizeIdentityText(normalized))
    .map(candidate => candidate.displayName);
  return [...sameKey, normalized].reduce(preferredStaffName);
};
