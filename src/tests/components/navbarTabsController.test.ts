import { describe, expect, it } from 'vitest';
import {
  resolveAnalyticsToggleTarget,
  resolveIsNavbarItemActive,
} from '@/components/layout/navbar/navbarTabsController';

describe('navbarTabsController', () => {
  it('resolves item active state including CUDYR alias for NURSING_HANDOFF', () => {
    expect(
      resolveIsNavbarItemActive({
        currentModule: 'CENSUS',
        itemModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        itemCensusMode: 'REGISTER',
      })
    ).toBe(true);

    expect(
      resolveIsNavbarItemActive({
        currentModule: 'CUDYR',
        itemModule: 'NURSING_HANDOFF',
        censusViewMode: 'REGISTER',
      })
    ).toBe(true);

    expect(
      resolveIsNavbarItemActive({
        currentModule: 'CENSUS',
        itemModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        itemCensusMode: 'ANALYTICS',
      })
    ).toBe(false);
  });

  it('resolves analytics toggle for non-census modules as deferred switch', () => {
    expect(
      resolveAnalyticsToggleTarget({
        currentModule: 'NURSING_HANDOFF',
        censusViewMode: 'REGISTER',
      })
    ).toEqual({
      moduleToChange: 'CENSUS',
      censusModeToSet: 'ANALYTICS',
      deferCensusModeUpdate: true,
    });
  });

  it('toggles between REGISTER and ANALYTICS inside census module', () => {
    expect(
      resolveAnalyticsToggleTarget({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
      })
    ).toEqual({
      moduleToChange: undefined,
      censusModeToSet: 'ANALYTICS',
      deferCensusModeUpdate: false,
    });

    expect(
      resolveAnalyticsToggleTarget({
        currentModule: 'CENSUS',
        censusViewMode: 'ANALYTICS',
      })
    ).toEqual({
      moduleToChange: undefined,
      censusModeToSet: 'REGISTER',
      deferCensusModeUpdate: false,
    });
  });
});
