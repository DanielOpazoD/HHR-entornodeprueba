import { useEffect } from 'react';
import { reconcileBootstrapRuntime } from '@/app-shell/bootstrap/bootstrapAppRuntime';
import { ACTIVITY_EVENTS } from '@/constants/security';
import { versionCheckLogger } from '@/hooks/hookLoggers';

const VERSION_CHECK_DELAY_MS = 1000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A new version reloads the page. On 2026-11-06 the open census reloaded within 5 minutes of 16 of
 * 18 publications, whatever the person was doing: a synchronization, a half-typed entry, a dialog.
 * The running version keeps working (retired assets stay served for 7 days, #1232), so the check
 * waits until nobody has used this tab for a while. Coming back to the tab is not use: a person
 * who was away gets the new version before starting anything.
 */
export const VERSION_RELOAD_IDLE_MS = 10 * 60 * 1000;

export const useVersionCheck = (): void => {
  useEffect(() => {
    let lastActivityAt = 0;
    const onActivity = () => {
      lastActivityAt = Date.now();
    };

    const isIdle = () => Date.now() - lastActivityAt >= VERSION_RELOAD_IDLE_MS;
    const checkVersion = async () => {
      if (!isIdle()) return;
      try {
        // Asked again once version.json answers: the person may have come back meanwhile.
        await reconcileBootstrapRuntime({ canReloadForNewVersion: isIdle });
      } catch (error) {
        versionCheckLogger.warn('Check failed (offline?)', error);
      }
    };

    const timeoutId = window.setTimeout(() => {
      void checkVersion();
    }, VERSION_CHECK_DELAY_MS);

    const intervalId = window.setInterval(() => {
      void checkVersion();
    }, VERSION_CHECK_INTERVAL_MS);

    const handleFocus = () => {
      void checkVersion();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkVersion();
      }
    };

    // Capture also sees scrolling inside panels, which does not bubble to the window.
    const activityOptions = { capture: true, passive: true } as const;
    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, onActivity, activityOptions));
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, onActivity, activityOptions)
      );
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
};
