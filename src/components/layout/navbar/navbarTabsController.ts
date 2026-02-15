import type { ModuleType } from '@/constants/navigationConfig';

interface ResolveIsNavbarItemActiveParams {
  currentModule: ModuleType;
  itemModule?: ModuleType;
  censusViewMode: 'REGISTER' | 'ANALYTICS';
  itemCensusMode?: 'REGISTER' | 'ANALYTICS';
}

export const resolveIsNavbarItemActive = ({
  currentModule,
  itemModule,
  censusViewMode,
  itemCensusMode,
}: ResolveIsNavbarItemActiveParams): boolean =>
  Boolean(
    itemModule &&
    (currentModule === itemModule ||
      (itemModule === 'NURSING_HANDOFF' && currentModule === 'CUDYR')) &&
    (!itemCensusMode || censusViewMode === itemCensusMode)
  );

interface ResolveAnalyticsToggleTargetParams {
  currentModule: ModuleType;
  censusViewMode: 'REGISTER' | 'ANALYTICS';
}

interface AnalyticsToggleTarget {
  moduleToChange?: ModuleType;
  censusModeToSet: 'REGISTER' | 'ANALYTICS';
  deferCensusModeUpdate: boolean;
}

export const resolveAnalyticsToggleTarget = ({
  currentModule,
  censusViewMode,
}: ResolveAnalyticsToggleTargetParams): AnalyticsToggleTarget => {
  if (currentModule !== 'CENSUS') {
    return {
      moduleToChange: 'CENSUS',
      censusModeToSet: 'ANALYTICS',
      deferCensusModeUpdate: true,
    };
  }

  return {
    moduleToChange: undefined,
    censusModeToSet: censusViewMode === 'ANALYTICS' ? 'REGISTER' : 'ANALYTICS',
    deferCensusModeUpdate: false,
  };
};
