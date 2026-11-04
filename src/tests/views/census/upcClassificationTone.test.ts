import { describe, expect, it } from 'vitest';
import { resolveUpcBadgeColor } from '@/features/census/components/patient-row/upcClassificationTone';

describe('resolveUpcBadgeColor', () => {
  it('returns red colors for UCI', () => {
    const colors = resolveUpcBadgeColor('UPC_UCI');
    expect(colors.text).toContain('red');
    expect(colors.bg).toContain('red');
  });

  it('returns amber colors for UTI', () => {
    const colors = resolveUpcBadgeColor('UPC_UTI');
    expect(colors.text).toContain('amber');
    expect(colors.bg).toContain('amber');
  });

  it('returns transparent for null', () => {
    const colors = resolveUpcBadgeColor(null);
    expect(colors.bg).toContain('transparent');
  });
});
