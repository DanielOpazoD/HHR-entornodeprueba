// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isClinicalInitialBlockField } from '@/features/census/controllers/clinicalInitialBlockCoalescingController';

describe('clinicalInitialBlockCoalescingController', () => {
  it('debounces diagnosis without merging an explicit specialty decision', () => {
    expect(isClinicalInitialBlockField('pathology')).toBe(true);
    expect(isClinicalInitialBlockField('specialty')).toBe(false);
    expect(isClinicalInitialBlockField('secondarySpecialty')).toBe(false);
    expect(isClinicalInitialBlockField('status')).toBe(false);
    expect(isClinicalInitialBlockField('patientName')).toBe(false);
  });
});
