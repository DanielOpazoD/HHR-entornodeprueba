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

/** Existing catalog spelling wins ties; only an equivalent, richer spelling replaces it. */
export const preferredStaffName = (catalogName: string, incoming: string): string => {
  if (nurseIdentityKey(catalogName) !== nurseIdentityKey(incoming)) return catalogName;
  const marks = (name: string) => (name.normalize('NFD').match(/[\u0300-\u036f]/g) ?? []).length;
  return marks(incoming) > marks(catalogName) ? incoming : catalogName;
};

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
  return uniqueStaffNames(nurseCatalog.map(normalizeDisplayName).filter(Boolean));
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
  if (exactMatch) return preferredStaffName(exactMatch.displayName, normalized);
  return normalized;
};
