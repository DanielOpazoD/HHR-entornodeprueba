export interface NurseCatalogIdentity {
  key: string;
  displayName: string;
  catalogMatched: boolean;
}

export interface NurseAuthorIdentityParts {
  firstGivenName: string;
  firstSurname: string;
}

const normalizeIdentityText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');

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

export const toShortNurseName = (value: string): string => {
  const normalized = normalizeDisplayName(value);
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join(' ') : normalized;
};

export const buildNurseCatalogIdentities = (nurseCatalog: string[]): NurseCatalogIdentity[] => {
  return reconcileNurseCatalogNames(nurseCatalog)
    .filter(displayName => tokens(displayName).length >= 2)
    .map(displayName => ({
      key: normalizeIdentityText(displayName),
      displayName,
      catalogMatched: true,
    }));
};

export const reconcileNurseCatalogNames = (nurseCatalog: string[]): string[] => {
  return [
    ...new Map(
      nurseCatalog
        .map(normalizeDisplayName)
        .filter(Boolean)
        .map(name => [normalizeIdentityText(name), name])
    ).values(),
  ];
};

/** Reconciles Eloísa's full name with HHR's curated "name + surname" catalog. */
export const resolveNurseIdentity = (
  author: string,
  catalog: NurseCatalogIdentity[],
  authorIdentity?: NurseAuthorIdentityParts
): NurseCatalogIdentity | null => {
  const remoteTokens = tokens(author);
  if (remoteTokens.length < 2) return null;
  // A few Eloísa fields concatenate "date - time - author - role". If an old
  // extension sends that label unparsed, it must never become a fake nurse.
  if (/^\d{1,4}[-/]/.test(remoteTokens[0])) return null;
  const remoteKey = normalizeIdentityText(author);
  const exactMatch = catalog.find(candidate => candidate.key === remoteKey);
  if (exactMatch) return exactMatch;
  if (authorIdentity) {
    const firstGivenName = normalizeIdentityText(authorIdentity.firstGivenName);
    const firstSurname = normalizeIdentityText(authorIdentity.firstSurname);
    const compatibleCatalogIdentities = catalog.filter(candidate => {
      const candidateTokens = tokens(candidate.displayName);
      return (
        candidateTokens[0] === firstGivenName && candidateTokens.slice(1).includes(firstSurname)
      );
    });
    if (compatibleCatalogIdentities.length === 1) return compatibleCatalogIdentities[0];
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
  const catalog = buildNurseCatalogIdentities(nurseCatalog);
  const exactMatch = catalog.find(candidate => candidate.key === normalizeIdentityText(normalized));
  if (exactMatch) return exactMatch.displayName;
  return normalized;
};
