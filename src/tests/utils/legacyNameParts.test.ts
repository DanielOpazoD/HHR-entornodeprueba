// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  comparableName,
  normalizeNameSpacing,
  resolveLegacyNameParts,
} from '@/utils/legacyNameParts';

describe('patient name spacing and comparison', () => {
  it('trims and leaves one space between words, whatever the whitespace', () => {
    expect(normalizeNameSpacing('  María \t de los  Ángeles ')).toBe('María de los Ángeles');
    expect(normalizeNameSpacing(' \n ')).toBe('');
  });

  it('compares spellings ignoring spacing and case but not accents', () => {
    expect(comparableName(' JUAN  Pérez ')).toBe(comparableName('juan pérez'));
    expect(comparableName('Pérez')).not.toBe(comparableName('Perez'));
  });

  it('guesses the last two words as surnames', () => {
    expect(resolveLegacyNameParts('  ')).toEqual({
      firstName: '',
      lastName: '',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts('Ana')).toEqual({
      firstName: 'Ana',
      lastName: '',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts('Ana  Soto')).toEqual({
      firstName: 'Ana',
      lastName: 'Soto',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts(' María de los  Ángeles Soto Pérez ')).toEqual({
      firstName: 'María de los Ángeles',
      lastName: 'Soto',
      secondLastName: 'Pérez',
    });
  });
});
