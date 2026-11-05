import { createContext, useContext } from 'react';

/**
 * Opens the clinical explorer on the first patient of the census day. Null when no patient of the
 * day has the RUT and episode the explorer needs.
 */
export const ClinicalExplorerLaunchContext = createContext<(() => void) | null>(null);

export const useClinicalExplorerLaunch = (): (() => void) | null =>
  useContext(ClinicalExplorerLaunchContext);
