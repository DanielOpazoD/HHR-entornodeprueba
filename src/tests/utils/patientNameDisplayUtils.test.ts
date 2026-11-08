// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatPatientDisplayName, limitGivenNames } from '@/utils/patientNameDisplayUtils';

describe('limitGivenNames', () => {
  it.each([
    ['Ana', 'Ana'],
    ['Ana María', 'Ana María'],
    ['Ana María Josefa', 'Ana María Josefa'],
    ['Ana María Josefa Valentina Rosa Elena', 'Ana María Josefa'],
  ])('keeps at most three given names: %s', (givenNames, expected) => {
    expect(limitGivenNames(givenNames)).toBe(expected);
  });

  it('counts a particle together with the name that follows it', () => {
    expect(limitGivenNames('María de los Ángeles Josefa Rosa')).toBe('María de los Ángeles Josefa');
    expect(limitGivenNames('José Del Sagrado Corazón Tomás')).toBe('José Del Sagrado Corazón');
    expect(limitGivenNames('Ana María Del Carmen De La Cruz')).toBe('Ana María Del Carmen');
  });

  it('collapses extra spaces and keeps accents and case as stored', () => {
    expect(limitGivenNames('  JOSÉ   maría\tÑandú  Tiare ')).toBe('JOSÉ maría Ñandú');
  });

  it('returns an empty string for empty input', () => {
    expect(limitGivenNames('')).toBe('');
    expect(limitGivenNames('   ')).toBe('');
    expect(limitGivenNames(undefined)).toBe('');
  });
});

describe('formatPatientDisplayName', () => {
  it('limits only the given names when the stored split matches the full name', () => {
    expect(
      formatPatientDisplayName({
        patientName: 'Ana María Josefa Valentina Rosa Elena Hotu Pakarati',
        firstName: 'Ana María Josefa Valentina Rosa Elena',
        lastName: 'Hotu',
        secondLastName: 'Pakarati',
      })
    ).toBe('Ana María Josefa Hotu Pakarati');
  });

  it('keeps short names whole, including a single surname', () => {
    expect(
      formatPatientDisplayName({ patientName: 'Tiare Rapu', firstName: 'Tiare', lastName: 'Rapu' })
    ).toBe('Tiare Rapu');
  });

  it('uses the split fields when the full name is missing', () => {
    expect(
      formatPatientDisplayName({
        patientName: '',
        firstName: 'Ana María Josefa Valentina',
        lastName: 'Hotu',
        secondLastName: 'Pakarati',
      })
    ).toBe('Ana María Josefa Hotu Pakarati');
  });

  it('does not guess surnames from a full name without a stored split', () => {
    const patientName = 'Ana María Josefa Valentina Rosa Elena Hotu Pakarati';
    expect(formatPatientDisplayName({ patientName })).toBe(patientName);
  });

  it('shows the stored full name whole when the split disagrees with it', () => {
    expect(
      formatPatientDisplayName({
        patientName: 'Ana María Josefa Valentina Hotu Pakarati',
        firstName: 'Ana María',
        lastName: 'Hotu',
        secondLastName: 'Pakarati',
      })
    ).toBe('Ana María Josefa Valentina Hotu Pakarati');
  });

  it('returns an empty string when there is no name', () => {
    expect(formatPatientDisplayName({})).toBe('');
  });
});
