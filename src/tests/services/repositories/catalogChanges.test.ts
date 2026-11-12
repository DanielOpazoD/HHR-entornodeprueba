import { describe, expect, it } from 'vitest';
import {
  applyCatalogChanges,
  diffCatalog,
  catalogChangesAccepted,
} from '@/services/repositories/contracts/catalogChanges';
import { normalizeStringCatalog } from '@/services/repositories/contracts/catalogContracts';
const merge = (base: string[], next: string[], current: string[]) =>
  applyCatalogChanges(
    current,
    diffCatalog(normalizeStringCatalog(base), normalizeStringCatalog(next), x => x),
    x => x
  );
describe('catalog changes', () => {
  it('adds to a real empty base and deduplicates normalized names', () => {
    expect(merge([], [' Uno ', 'Uno'], ['Dos'])).toEqual(['Dos', 'Uno']);
  });
  it('removes and renames while preserving unrelated additions', () => {
    expect(merge(['Uno'], ['Renombrado'], ['Uno', 'Dos'])).toEqual(['Dos', 'Renombrado']);
    expect(merge(['Uno'], [], ['Uno', 'Dos'])).toEqual(['Dos']);
  });
  it('rejects a rename after delete or another rename', () => {
    expect(() => merge(['Uno'], ['Nuevo'], [])).toThrow('La lista cambió');
    expect(() => merge(['Uno'], ['Nuevo'], ['Otro'])).toThrow('La lista cambió');
  });
  it('detects incompatible edits of the same stable professional id', () => {
    const base = [
      { name: 'Sintético', phone: '', rayenPractitionerId: 'synthetic-id', specialty: 'Pediatría' },
    ];
    const next = [{ ...base[0], specialty: 'Cirugía' }];
    const current = [{ ...base[0], specialty: 'Medicina Interna' }];
    const key = (x: (typeof base)[number]) => x.rayenPractitionerId;
    expect(() => applyCatalogChanges(current, diffCatalog(base, next, key), key)).toThrow(
      'La lista cambió'
    );
  });
});

it('recognizes a late confirmation including unrelated changes', () => {
  const key = (name: string) => name;
  const changes = diffCatalog(['Base'], ['Nuevo'], key);
  expect(catalogChangesAccepted(['Otro', 'Nuevo'], changes, key)).toBe(true);
  expect(catalogChangesAccepted(['Base', 'Otro'], changes, key)).toBe(false);
});
