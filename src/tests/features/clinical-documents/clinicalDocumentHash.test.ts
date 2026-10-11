import { describe, expect, it } from 'vitest';
import { createClinicalDocumentHash } from '@/domain/clinical-documents/hash';

describe('persisted clinical document hash compatibility', () => {
  it.each([
    ['', 'h0'],
    ['Paciente: José\nDiagnóstico: dolor', 'h1723870766'],
    ['🩺\r\nControl', 'h1401179780'],
    ['a'.repeat(1000), 'h904019584'],
  ])('preserves the stored hash for %j', (text, expected) => {
    expect(createClinicalDocumentHash(text)).toBe(expected);
  });
});
