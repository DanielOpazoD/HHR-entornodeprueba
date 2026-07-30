import { describe, expect, it } from 'vitest';
import { resolveClinicalEnrichmentBatchMode } from '@/features/rayen-import/domain/clinicalEnrichmentBatchMode';

describe('clinicalEnrichmentBatchMode', () => {
  it.each([
    [undefined, 'enforced'],
    ['', 'enforced'],
    ['unexpected', 'off'],
    ['shadow', 'shadow'],
    ['ENFORCED', 'enforced'],
  ])('maps %s to %s', (input, expected) => {
    expect(resolveClinicalEnrichmentBatchMode(input)).toBe(expected);
  });
});
