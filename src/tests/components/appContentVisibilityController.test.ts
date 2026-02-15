import { describe, expect, it } from 'vitest';
import {
  shouldRenderBookmarkBar,
  shouldRenderDateStrip,
} from '@/components/layout/app-content/appContentVisibilityController';

describe('appContentVisibilityController', () => {
  it('renders date strip for clinical modules and REGISTER mode in CENSUS', () => {
    expect(
      shouldRenderDateStrip({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        isSignatureMode: false,
        isSharedCensusMode: false,
      })
    ).toBe(true);

    expect(
      shouldRenderDateStrip({
        currentModule: 'CENSUS',
        censusViewMode: 'ANALYTICS',
        isSignatureMode: false,
        isSharedCensusMode: false,
      })
    ).toBe(false);
  });

  it('hides date strip in signature/shared modes', () => {
    expect(
      shouldRenderDateStrip({
        currentModule: 'CUDYR',
        censusViewMode: 'REGISTER',
        isSignatureMode: true,
        isSharedCensusMode: false,
      })
    ).toBe(false);

    expect(
      shouldRenderDateStrip({
        currentModule: 'NURSING_HANDOFF',
        censusViewMode: 'REGISTER',
        isSignatureMode: false,
        isSharedCensusMode: true,
      })
    ).toBe(false);
  });

  it('renders bookmark bar only for allowed roles and context', () => {
    expect(
      shouldRenderBookmarkBar({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        isSignatureMode: false,
        isSharedCensusMode: false,
        showBookmarksBar: true,
        role: 'admin',
      })
    ).toBe(true);

    expect(
      shouldRenderBookmarkBar({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        isSignatureMode: false,
        isSharedCensusMode: false,
        showBookmarksBar: true,
        role: 'doctor_urgency',
      })
    ).toBe(false);
  });
});
