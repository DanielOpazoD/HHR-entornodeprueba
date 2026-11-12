import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export class CatalogConflictError extends Error {
  constructor(readonly current: readonly (string | ProfessionalCatalogItem)[]) {
    super('La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.');
  }
}

type CatalogChange<T> =
  | { kind: 'remove'; before: T }
  | { kind: 'edit'; before: T; after: T }
  | { kind: 'add'; after: T };
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

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
  return changes;
};

export const applyCatalogChanges = <T extends string | ProfessionalCatalogItem>(
  current: T[],
  changes: CatalogChange<T>[],
  key: (item: T) => string
): T[] => {
  const result = new Map(current.map(item => [key(item), item]));
  for (const change of changes) {
    if (change.kind !== 'add') {
      const id = key(change.before);
      if (!equal(result.get(id), change.before)) throw new CatalogConflictError(current);
      if (change.kind === 'remove') result.delete(id);
      else result.set(id, change.after);
    } else {
      const id = key(change.after);
      const existing = result.get(id);
      if (existing !== undefined && !equal(existing, change.after))
        throw new CatalogConflictError(current);
      result.set(id, change.after);
    }
  }
  return [...result.values()];
};

export const professionalCatalogIdentity = (item: ProfessionalCatalogItem): string =>
  item.rayenPractitionerId
    ? `rayen:${item.rayenPractitionerId}`
    : `${item.name.toLowerCase()}:${item.phone}`;

/** A late confirmation may include unrelated changes from other computers. */
export const catalogChangesAccepted = <T>(
  current: T[],
  changes: CatalogChange<T>[],
  key: (item: T) => string
): boolean => {
  const accepted = new Map(current.map(item => [key(item), item]));
  return changes.every(change =>
    change.kind === 'remove'
      ? !accepted.has(key(change.before))
      : equal(accepted.get(key(change.after)), change.after)
  );
};
