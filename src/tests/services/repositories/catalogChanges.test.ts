import { describe, expect, it } from 'vitest';
import {
  applyCatalogChanges,
  diffCatalog,
  catalogChangesAccepted,
  exactStaffName,
  professionalCatalogIdentity,
  savedCatalogEdit,
} from '@/services/repositories/contracts/catalogChanges';
import { savedTextsOfRow, staffCatalogRows } from '@/services/staff/eloisaStaffIdentity';
import { normalizeStringCatalog } from '@/services/repositories/contracts/catalogContracts';
const merge = (base: string[], next: string[], current: string[]) =>
  applyCatalogChanges(
    current,
    diffCatalog(normalizeStringCatalog(base), normalizeStringCatalog(next), exactStaffName),
    exactStaffName
  );
describe('catalog changes', () => {
  it('adds to a real empty base and deduplicates normalized names', () => {
    expect(merge([], [' Uno ', 'Uno'], ['Dos'])).toEqual(['Dos', 'Uno']);
  });
  it('removes and renames while preserving unrelated additions', () => {
    expect(merge(['Uno'], ['Renombrado'], ['Uno', 'Dos'])).toEqual(['Renombrado', 'Dos']);
    expect(merge(['Uno'], [], ['Uno', 'Dos'])).toEqual(['Dos']);
  });
  it('rejects removing a person another computer already removed', () => {
    expect(() => merge(['Uno', 'Dos'], ['Dos'], ['Dos'])).toThrow('La lista cambió');
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

describe('saved texts are compared exactly', () => {
  it('keeps «Ana Pena» and «Ana Peña» as two people', () => {
    expect(merge(['Ana Pena'], ['Ana Pena', 'Ana Peña'], ['Ana Pena'])).toEqual([
      'Ana Pena',
      'Ana Peña',
    ]);
    expect(merge(['Ana Pena'], [], ['Ana Pena', 'Ana Peña'])).toEqual(['Ana Peña']);
    expect(merge(['Ana Pena'], ['Ana Nueva'], ['Ana Pena', 'Ana Peña'])).toEqual([
      'Ana Nueva',
      'Ana Peña',
    ]);
  });
  it('treats a text another computer changed, even only in case, as a conflict', () => {
    expect(() => merge(['Sintético Uno'], ['Sintético Nuevo'], ['sintético uno'])).toThrow(
      'La lista cambió'
    );
  });
  it('renames in place of the first replaced text and drops the others', () => {
    expect(
      merge(
        ['Otro', 'Sintético Uno', 'sintético uno'],
        ['Otro', 'Sintético Nuevo'],
        ['Otro', 'Sintético Uno', 'sintético uno']
      )
    ).toEqual(['Otro', 'Sintético Nuevo']);
    expect(merge(['Uno', 'Dos', 'Tres'], ['Uno', 'Nuevo', 'Tres'], ['Uno', 'Dos', 'Tres'])).toEqual(
      ['Uno', 'Nuevo', 'Tres']
    );
  });
  it('collapses a new name another computer already added into one element', () => {
    expect(merge(['Uno'], ['Nuevo'], ['Uno', 'Nuevo'])).toEqual(['Nuevo']);
  });
});

describe('shown rows know their saved texts', () => {
  const eloisa = [
    {
      key: 'synthetic',
      role: 'nurse' as const,
      name: 'Sintético Canónico',
      aliases: ['Sintético Alias'],
    },
    { key: 'synthetic-2', role: 'nurse' as const, name: 'Sintético Eloísa', aliases: [] },
  ];
  const saved = ['Sintético Alias', 'Sintético Otro', 'Ana Pena', 'Ana Peña'];
  const rows = staffCatalogRows(saved, eloisa, 'nurse');
  const textsOf = savedTextsOfRow(rows);
  const shown = rows.map(row => row.name);
  const edit = (next: string[]) => savedCatalogEdit({ list: saved, textsOf }, shown, next).next;
  const without = (name: string) => shown.filter(row => row !== name);
  const renamed = (name: string, to: string) => shown.map(row => (row === name ? to : row));

  it('groups rows exactly as the screen shows them', () => {
    expect(rows).toEqual([
      { name: 'Sintético Canónico', saved: ['Sintético Alias'] },
      { name: 'Sintético Otro', saved: ['Sintético Otro'] },
      { name: 'Ana Peña', saved: ['Ana Pena', 'Ana Peña'] },
      { name: 'Sintético Eloísa', saved: [] },
    ]);
  });
  it('removing a row removes exactly its saved texts', () => {
    expect(edit(without('Sintético Canónico'))).toEqual(['Sintético Otro', 'Ana Pena', 'Ana Peña']);
    expect(edit(without('Ana Peña'))).toEqual(['Sintético Alias', 'Sintético Otro']);
  });
  it('a row without saved texts changes nothing when removed and is added when renamed', () => {
    expect(edit(without('Sintético Eloísa'))).toEqual(saved);
    expect(edit(renamed('Sintético Eloísa', 'Sintético Nuevo'))).toEqual([
      ...saved,
      'Sintético Nuevo',
    ]);
  });
  it('renaming a row takes the place of its first saved text', () => {
    expect(edit(renamed('Ana Peña', 'Ana Nueva'))).toEqual([
      'Sintético Alias',
      'Sintético Otro',
      'Ana Nueva',
    ]);
  });
  it('without a confirmed saved list, each shown name stands for itself', () => {
    expect(savedCatalogEdit(undefined, ['Uno', 'Dos'], ['Nuevo', 'Dos'])).toEqual({
      base: ['Uno', 'Dos'],
      next: ['Nuevo', 'Dos'],
    });
  });
  it('adding appends the new name', () => {
    expect(edit([...shown, 'Sintético Nuevo'])).toEqual([...saved, 'Sintético Nuevo']);
  });
});

describe('treating physicians', () => {
  it('never confuse two different people', () => {
    const pena = { name: 'Ana Pena', phone: '111' };
    const pegna = { name: 'Ana Peña', phone: '111' };
    expect(professionalCatalogIdentity(pena)).not.toBe(professionalCatalogIdentity(pegna));
    const first = { name: 'Sintético', phone: '', rayenPractitionerId: 'synthetic-1' };
    const second = { name: 'Sintético', phone: '', rayenPractitionerId: 'synthetic-2' };
    expect(professionalCatalogIdentity(first)).not.toBe(professionalCatalogIdentity(second));
    expect(
      applyCatalogChanges(
        [pena, pegna],
        diffCatalog([pena], [], professionalCatalogIdentity),
        professionalCatalogIdentity
      )
    ).toEqual([pegna]);
  });
});
