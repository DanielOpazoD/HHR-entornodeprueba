import { useEffect } from 'react';
import { reconcileBootstrapRuntime } from '@/app-shell/bootstrap/bootstrapAppRuntime';
import { versionCheckLogger } from '@/hooks/hookLoggers';

const VERSION_CHECK_DELAY_MS = 1000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const useVersionCheck = (): void => {
  useEffect(() => {
    const checkVersion = async () => {
      try {
        await reconcileBootstrapRuntime();
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

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
};
