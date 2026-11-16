// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  VACANCY_LABEL,
  buildResolvedStaffSelectionOptions,
  isVacancySelection,
  normalizeStaffSelectionValue,
  shouldOmitExtraStaffSelection,
} from '@/services/staff/staffSelectionPresentation';

describe('staffSelectionPresentation', () => {
  it('normalizes vacancy-like values and resolves unique options once', () => {
    expect(normalizeStaffSelectionValue('')).toBe(VACANCY_LABEL);
    expect(normalizeStaffSelectionValue('--')).toBe(VACANCY_LABEL);
    expect(isVacancySelection('')).toBe(true);
    expect(shouldOmitExtraStaffSelection('')).toBe(true);

    expect(
      buildResolvedStaffSelectionOptions(['Ana', ''], ['Ana', '--', 'Vacante', 'Carla'])
    ).toEqual(['Vacante', 'Ana', 'Carla']);
  });
});
