import { useSyncExternalStore } from 'react';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';

const subscribe = (notify: () => void): (() => void) => onSessionChange(notify);
const serverEpoch = (): number => 0;

/**
 * Re-renders on every admission and logout of the Eloísa session. Put it in the key of anything
 * remembered per person, so what one person saw never shows for the next.
 */
export const useSessionEpoch = (): number =>
  useSyncExternalStore(subscribe, getSessionEpoch, serverEpoch);
