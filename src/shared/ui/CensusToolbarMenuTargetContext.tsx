import { createContext, useContext } from 'react';

// The census retains ownership and context of the handoff action in the date-bar menu.
export const CensusToolbarMenuTargetContext = createContext<HTMLElement | null>(null);

export const useCensusToolbarMenuTarget = () => useContext(CensusToolbarMenuTargetContext);
