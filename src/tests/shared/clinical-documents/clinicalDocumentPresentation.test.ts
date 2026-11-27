// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClinicalDocumentDateTime } from '@/features/clinical-documents/domain/clinicalDocumentPresentation';

describe('clinicalDocumentPresentation', () => {
  it('formats UTC and continental timestamps in Pacific/Easter without seconds (TIME-02)', () => {
    const utcFormatted = formatClinicalDocumentDateTime('2026-03-06T15:45:10.000Z');
    expect(utcFormatted).toMatch(/06[-/]03[-/]2026/);
    expect(utcFormatted).toMatch(/10:45/);
    expect(utcFormatted).not.toContain(':10');

    // 00:30 on 7 March in Santiago (-03:00) is still 6 March 22:30 (10:30 p. m.) in Rapa Nui (-05:00).
    const continentalFormatted = formatClinicalDocumentDateTime('2026-03-07T00:30:00-03:00');
    expect(continentalFormatted).toMatch(/06[-/]03[-/]2026/);
    expect(continentalFormatted).toMatch(/(?:22:30|10:30\s*p\.\s*m\.)/i);
  });

  it('returns an em dash for missing input and preserves unparseable values', () => {
    expect(formatClinicalDocumentDateTime(undefined)).toBe('—');
    expect(formatClinicalDocumentDateTime('')).toBe('—');
    expect(formatClinicalDocumentDateTime('fecha-invalida')).toBe('fecha-invalida');
  });
});
