import { describe, expect, it } from 'vitest';

import { buildClinicalDocumentEpisodeKey } from '@/features/clinical-documents/domain/clinicalDocumentEpisodeTypes';

describe('buildClinicalDocumentEpisodeKey', () => {
  it('joins RUT and admission date with the canonical separator', () => {
    expect(buildClinicalDocumentEpisodeKey('11.111.111-1', '2026-04-01')).toBe(
      '11.111.111-1__2026-04-01'
    );
  });

  it('preserves the source RUT format (dots and dashes are not stripped)', () => {
    expect(buildClinicalDocumentEpisodeKey('8.258.248-7', '2026-03-17')).toBe(
      '8.258.248-7__2026-03-17'
    );
  });

  it('returns null when either field is missing or empty', () => {
    expect(buildClinicalDocumentEpisodeKey('', '2026-04-01')).toBeNull();
    expect(buildClinicalDocumentEpisodeKey('11.111.111-1', '')).toBeNull();
    expect(buildClinicalDocumentEpisodeKey(undefined, '2026-04-01')).toBeNull();
    expect(buildClinicalDocumentEpisodeKey('11.111.111-1', null)).toBeNull();
    expect(buildClinicalDocumentEpisodeKey(null, undefined)).toBeNull();
  });

  it('trims surrounding whitespace before composing the key', () => {
    expect(buildClinicalDocumentEpisodeKey('  11.111.111-1  ', '  2026-04-01 ')).toBe(
      '11.111.111-1__2026-04-01'
    );
  });
});
