import { describe, expect, it } from 'vitest';
import { isNursingStaffingCollectionContextCurrent } from '@/features/rayen-import/domain/nursingStaffingCollectionContext';

const source = { date: '2026-08-08', lastUpdated: '2026-08-08T10:00:00.000Z' };

describe('isNursingStaffingCollectionContextCurrent', () => {
  it('accepts the same selected day and census revision', () => {
    expect(isNursingStaffingCollectionContextCurrent(source, source, source.date)).toBe(true);
  });

  it('rejects a revision changed during history collection', () => {
    expect(
      isNursingStaffingCollectionContextCurrent(
        source,
        { ...source, lastUpdated: '2026-08-08T10:01:00.000Z' },
        source.date
      )
    ).toBe(false);
  });

  it('rejects a proposal after navigating to another census day', () => {
    expect(isNursingStaffingCollectionContextCurrent(source, source, '2026-08-09')).toBe(false);
  });
});
