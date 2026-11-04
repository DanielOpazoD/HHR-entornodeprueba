import { createContext, useContext } from 'react';

/**
 * An admin can hide Braden and Downton for everyone (Configuración › Visual). `CensusTable`
 * provides that choice from the shared table configuration; without it the scales show.
 */
export const NursingScalesVisibleContext = createContext(true);

export const useNursingScalesVisible = (): boolean => useContext(NursingScalesVisibleContext);
