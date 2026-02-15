import { describe, expect, it } from 'vitest';
import { shouldShowSubRowDemographicsButton } from '@/features/census/controllers/patientRowSubViewController';

describe('patientRowSubViewController', () => {
  it('shows demographics shortcut only when row is editable', () => {
    expect(shouldShowSubRowDemographicsButton({ readOnly: false })).toBe(true);
    expect(shouldShowSubRowDemographicsButton({ readOnly: true })).toBe(false);
  });
});
