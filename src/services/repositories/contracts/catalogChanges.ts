import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { nurseIdentityKey } from '@/services/staff/nurseIdentity';

export class CatalogConflictError extends Error {
  constructor(readonly current: readonly (string | ProfessionalCatalogItem)[]) {
    super('La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.');
  }
}

/** An edit whose key changes is a rename: it keeps the row's position. */
type CatalogChange<T> =
  | { kind: 'remove'; before: T }
  | { kind: 'edit'; before: T; after: T }
  | { kind: 'add'; after: T };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
// A staff name is the person its identity key names; a professional must match field by field.
const same = <T>(left: T, right: T, key: (item: T) => string) =>
  key(left) === key(right) && (typeof left === 'string' || equal(left, right));

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
  const [before] = removed;
  const [after] = added;
  if (removed.length !== 1 || added.length !== 1 || before === undefined || after === undefined)
    return changes;
  return [...changes.filter(change => change.kind === 'edit'), { kind: 'edit', before, after }];
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
    // Every server variant of the old and new identity collapses into the edited row.
    const replaced = new Set([key(change.before), ...(after ? [key(after)] : [])]);
    result = result.flatMap((item, position) =>
      position === index && after ? [after] : replaced.has(key(item)) ? [] : [item]
    );
  }
  return result;
};

/**
 * The screen composes the saved list with names from other sources (Eloísa). Only the last
 * confirmed saved list is a base: a shown-only name is not a saved element, so removing it
 * changes nothing and renaming it adds the new name. Without a confirmed list, nothing changes
 * here and the save stays blocked upstream.
 */
export const savedStaffCatalogEdit = (
  base: string[],
  next: string[],
  saved: readonly string[] | undefined
): { base: string[]; next: string[] } => {
  if (saved === undefined) return { base, next };
  const savedIdentities = new Set(saved.map(nurseIdentityKey));
  const shownOnly = new Set(
    base.map(nurseIdentityKey).filter(identity => !savedIdentities.has(identity))
  );
  const isSaved = (name: string) => !shownOnly.has(nurseIdentityKey(name));
  return { base: base.filter(isSaved), next: next.filter(isSaved) };
};

/** Display examples shown for an empty catalog were never confirmed by the server. */
export const confirmedCatalogBase = (
  base: string[],
  current: string[],
  examples: readonly string[]
): string[] => (current.length > 0 ? base : base.filter(name => !examples.includes(name)));

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
