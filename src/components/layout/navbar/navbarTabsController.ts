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
    (currentModule === itemModule || (itemModule === 'CENSUS' && currentModule === 'CUDYR')) &&
    (!itemCensusMode || censusViewMode === itemCensusMode)
  );
