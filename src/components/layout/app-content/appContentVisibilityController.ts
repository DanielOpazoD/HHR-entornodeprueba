import type { ModuleType } from '@/constants/navigationConfig';

type CensusViewMode = 'REGISTER' | 'ANALYTICS';

interface ResolveDateStripVisibilityParams {
  currentModule: ModuleType;
  censusViewMode: CensusViewMode;
  isSignatureMode: boolean;
  isSharedCensusMode: boolean;
}

const DATE_STRIP_MODULES: ReadonlySet<ModuleType> = new Set([
  'CENSUS',
  'CUDYR',
  'NURSING_HANDOFF',
  'MEDICAL_HANDOFF',
]);

export const shouldRenderDateStrip = ({
  currentModule,
  censusViewMode,
  isSignatureMode,
  isSharedCensusMode,
}: ResolveDateStripVisibilityParams): boolean => {
  if (isSignatureMode || isSharedCensusMode) {
    return false;
  }

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
  isSignatureMode: boolean;
  isSharedCensusMode: boolean;
  showBookmarksBar: boolean;
  role?: string | null;
}

const BOOKMARK_ALLOWED_ROLES = new Set(['admin', 'nurse_hospital']);

export const shouldRenderBookmarkBar = ({
  currentModule,
  censusViewMode,
  isSignatureMode,
  isSharedCensusMode,
  showBookmarksBar,
  role,
}: ResolveBookmarkBarVisibilityParams): boolean => {
  if (isSignatureMode || isSharedCensusMode || !showBookmarksBar) {
    return false;
  }

  if (currentModule !== 'CENSUS' || censusViewMode !== 'REGISTER') {
    return false;
  }

  return role !== null && role !== undefined && BOOKMARK_ALLOWED_ROLES.has(role);
};
