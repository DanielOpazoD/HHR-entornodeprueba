import { describe, expect, it } from 'vitest';
import type { ClinicalAntecedentEntry } from '@/features/rayen-import';
import { uniqueClinicalAntecedentEntries } from '@/features/census/components/patient-row/clinicalAntecedentEntries';

const entry = (
  source: string,
  id: string,
  diagnosis = 'Synthetic diagnosis'
): ClinicalAntecedentEntry => ({
  source,
  id,
  diagnosis,
  date: '20260930 10:00',
  facility: 'Synthetic facility',
  type: 'Consulta',
  windowEnd: '20260930',
});

describe('clinical antecedent identity and precedence', () => {
  it('keeps the current occurrence and encounter order without changing input objects', () => {
    const current = Object.freeze(entry('Primaria', '8', 'Current diagnosis'));
    const secondary = Object.freeze(entry('Secundaria', '8'));
    const older = Object.freeze(entry('Primaria', '99'));
    const input = Object.freeze([
      current,
      secondary,
      entry('Primaria', '8', 'Older overlap'),
      older,
      entry('Primaria', '99'),
    ]);
    const before = JSON.stringify(input);
    const result = uniqueClinicalAntecedentEntries(input);
    expect(result).toEqual([current, secondary, older]);
    expect(result[0]).toBe(current);
    expect(result[1]).toBe(secondary);
    expect(result[2]).toBe(older);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not conflate distinct source/id pairs containing delimiters', () => {
    const first = entry('Primaria:8', '99');
    const second = entry('Primaria', '8:99');
    expect(uniqueClinicalAntecedentEntries([first, second, { ...first }])).toEqual([first, second]);
  });

  it('accepts an empty history', () => {
    expect(uniqueClinicalAntecedentEntries([])).toEqual([]);
  });
});
