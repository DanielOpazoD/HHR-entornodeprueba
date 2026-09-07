import {
  LIBRARY_CATEGORY_IDS,
  type LibraryCategoryId,
  type LibraryEntry,
} from './libraryCatalogTypes';

export type LibraryCategoryFilter = LibraryCategoryId | 'all';

export interface LibraryFilter {
  query: string;
  category: LibraryCategoryFilter;
}

/** Minúsculas sin tildes ni espacios repetidos: «Imagenología» y «imagenologia» son lo mismo. */
export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const entryHaystack = (entry: LibraryEntry): string =>
  normalizeSearchText([entry.title, entry.description, ...entry.keywords].join(' '));

export const matchesLibraryQuery = (entry: LibraryEntry, query: string): boolean => {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = entryHaystack(entry);
  return tokens.every(token => haystack.includes(token));
};

export const filterLibraryEntries = (
  entries: ReadonlyArray<LibraryEntry>,
  filter: LibraryFilter
): LibraryEntry[] =>
  entries.filter(
    entry =>
      (filter.category === 'all' || entry.category === filter.category) &&
      matchesLibraryQuery(entry, filter.query)
  );

export const countLibraryEntriesByCategory = (
  entries: ReadonlyArray<LibraryEntry>
): Record<LibraryCategoryId, number> => {
  const counts = Object.fromEntries(LIBRARY_CATEGORY_IDS.map(id => [id, 0])) as Record<
    LibraryCategoryId,
    number
  >;
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
};

export interface LibraryEntryGroup {
  category: LibraryCategoryId;
  entries: LibraryEntry[];
}

/** Agrupa en el orden canónico de categorías; conserva grupos vacíos para mostrar su estado. */
export const groupLibraryEntriesByCategory = (
  entries: ReadonlyArray<LibraryEntry>,
  categories: ReadonlyArray<LibraryCategoryId> = LIBRARY_CATEGORY_IDS
): LibraryEntryGroup[] =>
  categories.map(category => ({
    category,
    entries: entries.filter(entry => entry.category === category),
  }));
