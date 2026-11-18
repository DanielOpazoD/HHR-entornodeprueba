import type { ModuleType } from '@/constants/navigationConfig';
import { canUseBookmarks } from '@/shared/access/operationalAccessPolicy';

type CensusViewMode = 'REGISTER' | 'ANALYTICS';

interface ResolveDateStripVisibilityParams {
  currentModule: ModuleType;
  censusViewMode: CensusViewMode;
}

const DATE_STRIP_MODULES: ReadonlySet<ModuleType> = new Set(['CENSUS', 'CUDYR', 'NURSING_HANDOFF']);

export const shouldRenderDateStrip = ({
  currentModule,
  censusViewMode,
}: ResolveDateStripVisibilityParams): boolean => {
  if (!DATE_STRIP_MODULES.has(currentModule)) {
    return false;
  }

  if (currentModule === 'CENSUS') {
    return censusViewMode === 'REGISTER';
  }

  return true;
};

interface ResolveBookmarkBarVisibilityParams {
  currentModule: ModuleType;
  censusViewMode: CensusViewMode;
  showBookmarksBar: boolean;
  role?: string | null;
}

/**
 * Whether the BookmarkBar itself should render (bar is open and conditions met).
 */
export const shouldRenderBookmarkBar = ({
  currentModule,
  censusViewMode,
  showBookmarksBar,
  role,
}: ResolveBookmarkBarVisibilityParams): boolean => {
  if (!showBookmarksBar) {
    return false;
  }

  return canAccessBookmarks({ currentModule, censusViewMode, role });
};

/**
 * Whether the toggle arrow in the DateStrip should be visible.
 * Only admin and nurse_hospital in CENSUS → REGISTER can see it.
 */
export const shouldShowBookmarkToggle = ({
  currentModule,
  censusViewMode,
  role,
}: {
  currentModule: ModuleType;
  censusViewMode: CensusViewMode;
  role?: string | null;
}): boolean => canAccessBookmarks({ currentModule, censusViewMode, role });

/** Shared predicate for bookmark access (role + module + view). */
const canAccessBookmarks = ({
  currentModule,
  censusViewMode,
  role,
}: {
  currentModule: ModuleType;
  censusViewMode: CensusViewMode;
  role?: string | null;
}): boolean => {
  if (currentModule !== 'CENSUS' || censusViewMode !== 'REGISTER') {
    return false;
  }
  return role !== null && role !== undefined && canUseBookmarks(role);
};
