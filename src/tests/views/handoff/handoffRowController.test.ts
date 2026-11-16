import { describe, expect, it } from 'vitest';
import { resolveHandoffRowReadOnly } from '@/features/handoff/controllers/handoffRowController';

describe('handoffRowController', () => {
  it('locks the nursing note when the day is read-only or stability rules block the field', () => {
    expect(
      resolveHandoffRowReadOnly({
        readOnly: false,
        noteField: 'handoffNoteDayShift',
        canEditField: () => true,
      })
    ).toBe(false);
    expect(
      resolveHandoffRowReadOnly({
        readOnly: false,
        noteField: 'handoffNoteDayShift',
        canEditField: () => false,
      })
    ).toBe(true);
    expect(
      resolveHandoffRowReadOnly({
        readOnly: true,
        noteField: 'handoffNoteNightShift',
        canEditField: () => true,
      })
    ).toBe(true);
  });
});
