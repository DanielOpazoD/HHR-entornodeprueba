import { useEffect, useRef } from 'react';

import type { SyslabAccessModel } from './useSyslabAccess';

interface InitialLabViewerAutoSearchOptions {
  isOpen: boolean;
  enabled: boolean;
  initialPatientRut?: string;
  accessState: SyslabAccessModel['state'];
  search: () => Promise<void>;
}

export const useInitialLabViewerAutoSearch = ({
  isOpen,
  enabled,
  initialPatientRut,
  accessState,
  search,
}: InitialLabViewerAutoSearchOptions): void => {
  const searchStartedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      searchStartedRef.current = false;
      return;
    }

    if (!enabled || !initialPatientRut || accessState !== 'connected' || searchStartedRef.current) {
      return;
    }

    searchStartedRef.current = true;
    void search();
  }, [accessState, enabled, initialPatientRut, isOpen, search]);
};
