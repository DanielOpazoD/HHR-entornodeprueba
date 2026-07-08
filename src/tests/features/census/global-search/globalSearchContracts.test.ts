/**
 * Tests for the global search contracts and shared helpers.
 * Validates episode key parsing used by the search hook.
 */

import { describe, it, expect } from 'vitest';
import { resolveEpisodeCensusTargetDate } from '@/features/census/components/global-search/episodeGroupingController';
import type { GroupedEpisode } from '@/features/census/components/global-search/globalSearchContracts';

// We test patient-selection episode lookup parsing indirectly through the hook's
// internal behavior. Here we test the normalizePatientSearchTerm from
// patientMasterContracts since it was modified for case-insensitive search.

import { normalizePatientSearchTerm } from '@/services/repositories/contracts/patientMasterContracts';

describe('normalizePatientSearchTerm (case-insensitive search)', () => {
  it('converts lowercase to title case', () => {
    expect(normalizePatientSearchTerm('alicia')).toBe('Alicia');
  });

  it('converts uppercase to title case', () => {
    expect(normalizePatientSearchTerm('ALICIA')).toBe('Alicia');
  });

  it('handles multiple words', () => {
    expect(normalizePatientSearchTerm('juan pablo')).toBe('Juan Pablo');
  });

  it('handles mixed case input', () => {
    expect(normalizePatientSearchTerm('mArÍa GONZÁLEZ')).toBe('María González');
  });

  it('trims whitespace', () => {
    expect(normalizePatientSearchTerm('  alicia  ')).toBe('Alicia');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePatientSearchTerm('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizePatientSearchTerm('   ')).toBe('');
  });

  it('preserves single character words', () => {
    expect(normalizePatientSearchTerm('a b c')).toBe('A B C');
  });
});

describe('resolveEpisodeCensusTargetDate contract', () => {
  const buildEpisode = (overrides: Partial<GroupedEpisode>): GroupedEpisode =>
    ({
      id: 'episode-1',
      admission: { id: 'ing', type: 'Ingreso', date: '2026-04-10' },
      discharge: null,
      diagnosis: '',
      bedName: '',
      daysOfStay: null,
      ...overrides,
    }) as GroupedEpisode;

  it('uses the closing event date when the episode is already closed', () => {
    expect(
      resolveEpisodeCensusTargetDate(
        buildEpisode({
          discharge: {
            id: 'eg',
            type: 'Egreso',
            date: '2026-04-14',
          } as GroupedEpisode['discharge'],
        }),
        '2026-04-15'
      )
    ).toBe('2026-04-14');
  });

  it('uses the provided last hospitalization day for open episodes', () => {
    expect(resolveEpisodeCensusTargetDate(buildEpisode({ discharge: null }), '2026-04-16')).toBe(
      '2026-04-16'
    );
  });

  it('falls back to admission date when an open episode is missing the last hospitalization day', () => {
    expect(resolveEpisodeCensusTargetDate(buildEpisode({ discharge: null }), null)).toBe(
      '2026-04-10'
    );
  });
});
