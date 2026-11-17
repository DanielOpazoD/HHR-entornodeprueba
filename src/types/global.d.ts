import { DailyRecord } from './domain/dailyRecord';

declare global {
  interface Window {
    /** E2E Override for stable snapshots (Date -> Record mapping) */
    __HHR_E2E_OVERRIDE__?: Record<string, DailyRecord>;
    /** Flag to skip certain security/timeout checks in tests */
    __HHR_SKIP_AUTH_TIMEOUT__?: boolean;
    /** Flag to force online/offline behavior in tests */
    __HHR_FORCE_STATED_NETWORK__?: 'online' | 'offline';
    /** Optional E2E auth flow control */
    __HHR_E2E_AUTH__?: {
      popupErrorCode?: string;
      popupSuccessUser?: {
        uid: string;
        email: string;
        displayName?: string | null;
        photoURL?: string | null;
        role?: import('@/types/authRoleTypes').UserRole;
      };
      redirectMode?: 'success' | 'error' | 'timeout';
    };
  }
}

export {};
