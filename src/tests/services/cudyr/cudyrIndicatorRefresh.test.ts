import { describe, expect, it } from 'vitest';
import { cudyrIndicatorFirstSync } from '@/services/cudyr/cudyrIndicatorRefresh';

describe('first clinical sync marker for the compact indicator', () => {
  it('retains the same-month marker when record metadata disappears or a later sync finishes', () => {
    expect(
      cudyrIndicatorFirstSync('marker-a:1', '2026-10', '2026-10-10', '2026-10-10T20:00:00Z')
    ).toBe('2026-10-10T20:00:00Z');
    expect(cudyrIndicatorFirstSync('marker-a:1', '2026-10', '2026-10-10', '')).toBe(
      '2026-10-10T20:00:00Z'
    );
    expect(
      cudyrIndicatorFirstSync('marker-a:1', '2026-10', '2026-10-10', '2026-10-10T22:00:00Z')
    ).toBe('2026-10-10T20:00:00Z');
  });
  it('does not reuse another account, session, month or Rapa Nui day', () => {
    const sync = '2026-10-11T04:30:00Z'; // October 10 in Rapa Nui.
    expect(cudyrIndicatorFirstSync('marker-b:1', '2026-10', '2026-10-10', sync)).toBe(sync);
    expect(cudyrIndicatorFirstSync('marker-b:1', '2026-09', '2026-10-10', '')).toBe('');
    expect(cudyrIndicatorFirstSync('marker-c:1', '2026-10', '2026-10-10', '')).toBe('');
    expect(cudyrIndicatorFirstSync('marker-b:2', '2026-10', '2026-10-10', '')).toBe('');
    expect(cudyrIndicatorFirstSync('marker-b:1', '2026-10', '2026-10-11', sync)).toBe('');
  });
});
