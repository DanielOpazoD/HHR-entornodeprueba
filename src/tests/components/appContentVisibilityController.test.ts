import { describe, expect, it } from 'vitest';
import {
  shouldRenderBookmarkBar,
  shouldRenderDateStrip,
} from '@/components/layout/app-content/appContentVisibilityController';

describe('appContentVisibilityController', () => {
  it('renders date strip for clinical modules and hides it for statistics', () => {
    expect(
      shouldRenderDateStrip({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
      })
    ).toBe(true);

    expect(
      shouldRenderDateStrip({
        currentModule: 'ANALYTICS',
        censusViewMode: 'REGISTER',
      })
    ).toBe(false);
  });

  it('renders bookmark bar only for allowed roles and context', () => {
    expect(
      shouldRenderBookmarkBar({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        showBookmarksBar: true,
        role: 'admin',
      })
    ).toBe(true);

    expect(
      shouldRenderBookmarkBar({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        showBookmarksBar: true,
        role: 'doctor_urgency',
      })
    ).toBe(false);
  });
});
