import { useMemo, type CSSProperties } from 'react';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import { useTableConfig } from '@/context/TableConfigContext';
import { BEDS } from '@/constants';
import { buildVisibleBeds } from '@/features/census/controllers/censusTableViewController';

interface UseCensusViewModelResult extends ReturnType<typeof useCensusLogic> {
  marginStyle: CSSProperties;
  visibleBeds: ReturnType<typeof buildVisibleBeds>;
}

export const useCensusViewModel = (currentDateString: string): UseCensusViewModelResult => {
  const censusLogic = useCensusLogic(currentDateString);
  const { config } = useTableConfig();

  const marginStyle = useMemo<CSSProperties>(
    () => ({ padding: `0 ${config.pageMargin}px` }),
    [config.pageMargin]
  );

  const visibleBeds = useMemo(() => {
    if (!censusLogic.beds) {
      return [];
    }

    return buildVisibleBeds({
      allBeds: BEDS,
      activeExtraBeds: censusLogic.staff?.activeExtraBeds || [],
    });
  }, [censusLogic.beds, censusLogic.staff?.activeExtraBeds]);

  return {
    ...censusLogic,
    marginStyle,
    visibleBeds,
  };
};
