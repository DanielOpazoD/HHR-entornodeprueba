import { describe, expect, it } from 'vitest';

import '../../../extension/encounter-navigation.js';

const navigation = (
  globalThis as typeof globalThis & {
    HhrEncounterNavigation: {
      buildEncounterUrl: (encounterId: unknown, currentUrl?: unknown) => string;
      normalizeEncounterId: (encounterId: unknown) => string;
      resolveEncounterRouteBase: (currentUrl: unknown) => string;
      orderEncounterTabs: <T extends { active?: boolean; lastAccessed?: number }>(tabs: T[]) => T[];
    };
  }
).HhrEncounterNavigation;

describe('extension encounter navigation helpers', () => {
  it('accepts only numeric encounter ids and builds the canonical Ficha Médico route', () => {
    expect(navigation.normalizeEncounterId(' 141336 ')).toBe('141336');
    expect(navigation.buildEncounterUrl('141336')).toBe(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141336'
    );
    expect(navigation.buildEncounterUrl('../settings')).toBe('');
    expect(navigation.buildEncounterUrl('141336?tab=admin')).toBe('');
  });

  it('preserves the medical or nursing encounter route of the reused tab', () => {
    expect(
      navigation.buildEncounterUrl(
        '141336',
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141437'
      )
    ).toBe('https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141336');
    expect(
      navigation.buildEncounterUrl(
        '141336',
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141437'
      )
    ).toBe('https://fichamedico.rayensalud.cl/dashboard/encounter-list/141336');
    expect(
      navigation.buildEncounterUrl('141336', 'https://example.com/dashboard/encounter-list-nurse/1')
    ).toBe('https://fichamedico.rayensalud.cl/dashboard/encounter-list/141336');
  });

  it('prefers the active tab, then the most recently accessed tab', () => {
    const tabs = [
      { id: 1, active: false, lastAccessed: 300 },
      { id: 2, active: true, lastAccessed: 100 },
      { id: 3, active: false, lastAccessed: 500 },
    ];

    expect(navigation.orderEncounterTabs(tabs).map((tab: { id: number }) => tab.id)).toEqual([
      2, 3, 1,
    ]);
    expect(tabs.map(tab => tab.id)).toEqual([1, 2, 3]);
  });
});
