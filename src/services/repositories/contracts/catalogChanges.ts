import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export class CatalogConflictError extends Error {
  constructor(readonly current: readonly (string | ProfessionalCatalogItem)[]) {
    super('La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.');
  }
}

/** An edit whose key changes is a rename: it keeps the element's position. */
type CatalogChange<T> =
  | { kind: 'remove'; before: T }
  | { kind: 'edit'; before: T; after: T }
  | { kind: 'add'; after: T };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
// A professional must match field by field; a saved staff name is its exact text.
const same = <T>(left: T, right: T, key: (item: T) => string) =>
  key(left) === key(right) && (typeof left === 'string' || equal(left, right));

/** Saved staff names are compared by their exact saved text, never by a display grouping. */
export const exactStaffName = (name: string): string => name;

/** Only changed elements participate in conflict detection; unrelated remote edits survive. */
export const diffCatalog = <T extends string | ProfessionalCatalogItem>(
  base: T[],
  next: T[],
  key: (item: T) => string
): CatalogChange<T>[] => {
  const previous = new Map(base.map(item => [key(item), item]));
  const following = new Map(next.map(item => [key(item), item]));
  const changes: CatalogChange<T>[] = [];
  for (const [id, before] of previous) {
    const after = following.get(id);
    if (after === undefined) changes.push({ kind: 'remove', before });
    else if (!equal(before, after)) changes.push({ kind: 'edit', before, after });
  }
  for (const [id, after] of following) {
    if (!previous.has(id)) changes.push({ kind: 'add', after });
  }
  const removed = changes.flatMap(change => (change.kind === 'remove' ? [change.before] : []));
  const added = changes.flatMap(change => (change.kind === 'add' ? [change.after] : []));
  // One new element replacing one or more removed ones is a rename in place of the first.
  const [before, ...alsoRemoved] = removed;
  const [after] = added;
  if (added.length !== 1 || before === undefined || after === undefined) return changes;
  return [
    ...changes.filter(change => change.kind === 'edit'),
    { kind: 'edit', before, after },
    ...alsoRemoved.map(item => ({ kind: 'remove' as const, before: item })),
  ];
};

export const applyCatalogChanges = <T extends string | ProfessionalCatalogItem>(
  current: T[],
  changes: CatalogChange<T>[],
  key: (item: T) => string
): T[] => {
  let result = [...current];
  for (const change of changes) {
    if (change.kind === 'add') {
      const existing = result.find(item => key(item) === key(change.after));
      if (existing === undefined) result.push(change.after);
      else if (!same(existing, change.after, key)) throw new CatalogConflictError(current);
      continue;
    }
    const row = result.find(item => key(item) === key(change.before));
    if (row === undefined || !same(row, change.before, key))
      throw new CatalogConflictError(current);
    const index = result.indexOf(row);
    const after = change.kind === 'edit' ? change.after : undefined;
    const taken = after && result.find(item => key(item) === key(after));
    if (taken && key(after) !== key(change.before) && !same(taken, after, key))
      throw new CatalogConflictError(current);
    // An element another computer already added under the new key collapses into this one.
    const replaced = new Set([key(change.before), ...(after ? [key(after)] : [])]);
    result = result.flatMap((item, position) =>
      position === index && after ? [after] : replaced.has(key(item)) ? [] : [item]
    );
  }
  return result;
};

/** The last confirmed saved list and the exact saved texts behind each shown row. */
export interface SavedStaffCatalog {
  list: string[];
  textsOf: (shown: string) => readonly string[];
}

/**
 * Translates an edit of the shown rows into the saved texts each row represents. A row with no
 * saved text (an example, a person shown from Eloísa) changes nothing when removed and is added
 * when renamed; a renamed row takes the place of its first saved text. Without a confirmed saved
 * list each shown name stands for itself, and the save itself blocks when nothing was read.
 */
export const savedCatalogEdit = (
  saved: SavedStaffCatalog | undefined,
  shownBase: readonly string[],
  shownNext: readonly string[]
): { base: string[]; next: string[] } => {
  const list = saved?.list ?? [...shownBase];
  const textsOf = saved?.textsOf ?? ((shown: string) => [shown]);
  const removedRows = shownBase.filter(name => !shownNext.includes(name));
  const added = shownNext.filter(name => !shownBase.includes(name));
  const replaced = new Set(removedRows.flatMap(textsOf));
  const first = list.find(text => replaced.has(text));
  const [renamed] = removedRows.length === 1 && added.length === 1 ? added : [];
  const kept = list.flatMap(text =>
    !replaced.has(text) ? [text] : text === first && renamed !== undefined ? [renamed] : []
  );
  const inPlace = first !== undefined && renamed !== undefined;
  return { base: list, next: inPlace ? kept : [...kept, ...added] };
};

export const professionalCatalogIdentity = (item: ProfessionalCatalogItem): string =>
  item.rayenPractitionerId
    ? `rayen:${item.rayenPractitionerId}`
    : `${item.name.toLowerCase()}:${item.phone}`;

/** A late confirmation may include unrelated changes from other computers. */
export const catalogChangesAccepted = <T extends string | ProfessionalCatalogItem>(
  current: T[],
  changes: CatalogChange<T>[],
  key: (item: T) => string
): boolean => {
  const present = (item: T) => current.some(entry => key(entry) === key(item));
  return changes.every(change =>
    change.kind === 'remove'
      ? !present(change.before)
      : current.some(entry => same(entry, change.after, key)) &&
        (change.kind === 'add' ||
          key(change.before) === key(change.after) ||
          !present(change.before))
  );
};
