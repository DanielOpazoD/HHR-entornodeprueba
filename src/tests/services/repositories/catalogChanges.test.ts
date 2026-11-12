import { describe, expect, it } from 'vitest';
import {
  applyCatalogChanges,
  diffCatalog,
  catalogChangesAccepted,
  confirmedCatalogBase,
} from '@/services/repositories/contracts/catalogChanges';
import { nurseIdentityKey } from '@/services/staff/nurseIdentity';
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
    expect(merge(['Uno'], ['Renombrado'], ['Uno', 'Dos'])).toEqual(['Renombrado', 'Dos']);
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

describe('staff name identity', () => {
  const key = nurseIdentityKey;
  const mergeNames = (base: string[], next: string[], current: string[]) =>
    applyCatalogChanges(current, diffCatalog(base, next, key), key);

  it('renaming a visible row replaces every server variant of that identity in place', () => {
    expect(
      mergeNames(
        ['sintético uno', 'Otro'],
        ['Sintético Nuevo', 'Otro'],
        ['Sintético Uno', 'sintético uno', 'Otro']
      )
    ).toEqual(['Sintético Nuevo', 'Otro']);
  });
  it('treats a case or spacing difference as the same person, not a conflict', () => {
    expect(mergeNames(['Sintético Uno'], ['Sintético Nuevo'], ['sintético  uno'])).toEqual([
      'Sintético Nuevo',
    ]);
    expect(mergeNames(['Uno'], ['Nuevo'], ['Uno', 'nuevo'])).toEqual(['Nuevo']);
  });
  it('leaves other identities exactly as the server has them', () => {
    expect(mergeNames(['Ana', 'Uno'], ['Ana'], ['Ana', 'ana', 'Uno'])).toEqual(['Ana', 'ana']);
  });
  it('renaming keeps the row position and still rejects a rename of a removed row', () => {
    expect(
      mergeNames(['Uno', 'Dos', 'Tres'], ['Uno', 'Nuevo', 'Tres'], ['Uno', 'Dos', 'Tres'])
    ).toEqual(['Uno', 'Nuevo', 'Tres']);
    expect(() => mergeNames(['Uno', 'Dos'], ['Uno', 'Nuevo'], ['Uno'])).toThrow('La lista cambió');
  });
  it('recognizes an accepted rename by identity', () => {
    const changes = diffCatalog(['Uno'], ['Nuevo'], key);
    expect(catalogChangesAccepted(['nuevo', 'Otro'], changes, key)).toBe(true);
    expect(catalogChangesAccepted(['Uno', 'Nuevo'], changes, key)).toBe(false);
  });
});

describe('display examples', () => {
  it('are not confirmed elements while the server catalog is empty', () => {
    const examples = ['Enfermero/a 1', 'Enfermero/a 2'];
    expect(confirmedCatalogBase(examples, [], examples)).toEqual([]);
    expect(confirmedCatalogBase(['Enfermero/a 1', 'Sintético'], [], examples)).toEqual([
      'Sintético',
    ]);
    expect(confirmedCatalogBase(examples, ['Sintético'], examples)).toEqual(examples);
  });
});
