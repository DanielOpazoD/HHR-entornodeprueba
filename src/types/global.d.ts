import { DailyRecord } from './core';

declare global {
    interface Window {
        /** E2E Override for stable snapshots (Date -> Record mapping) */
        __HHR_E2E_OVERRIDE__?: Record<string, DailyRecord>;
        /** Flag to skip certain security/timeout checks in tests */
        __HHR_SKIP_AUTH_TIMEOUT__?: boolean;
        /** Flag to force online/offline behavior in tests */
        __HHR_FORCE_STATED_NETWORK__?: 'online' | 'offline';
    }
}

export { };
