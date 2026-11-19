// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatHandoffDate,
  formatHandoffVerboseDate,
  resolveHandoffDocumentTitleLabel,
} from '@/shared/handoff/handoffPresentation';

describe('handoffPresentation', () => {
  it('formats handoff timestamps defensively', () => {
    expect(formatHandoffDate('2026-03-16')).toContain('16');
    expect(formatHandoffVerboseDate('2026-03-16')).toContain('2026');
  });

  it('reuses a shared title label for generated handoff documents', () => {
    expect(
      resolveHandoffDocumentTitleLabel({
        selectedShift: 'day',
        recordDate: '2026-03-16',
      })
    ).toContain('16-03-2026');
  });
});
