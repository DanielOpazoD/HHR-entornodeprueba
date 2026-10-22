import { useEffect } from 'react';
import type { AuthUser } from '@/types/authRoleTypes';
import { AUDIT_CONNECTION_HEARTBEAT_MS } from '@/services/admin/auditSession/auditConnectionTracker';
import { createScopedLogger } from '@/services/utils/loggerScope';

const connectionLogger = createScopedLogger('AuditConnectionTracker');

const loadRuntime = () => import('@/services/admin/auditSession/auditConnectionRuntime');

/**
 * Keeps the audit connection of a signed-in user: opens or joins it, refreshes the local
 * heartbeat every minute and records network drops. The end is recorded by logout.
 */
export const useAuditConnectionTracker = (user: AuthUser | null): void => {
  const uid = user?.uid;
  const email = user?.email ?? undefined;
  const name = user?.displayName ?? undefined;

  useEffect(() => {
    if (!uid || !email) return;
    const identity = { uid, email, name };
    let active = true;
    const run = (task: (runtime: Awaited<ReturnType<typeof loadRuntime>>) => unknown) => {
      void loadRuntime()
        .then(runtime => (active ? task(runtime) : undefined))
        .catch(error => connectionLogger.warn('Audit connection step failed', error));
    };

    run(runtime => runtime.beginCurrentAuditConnection(identity));
    const heartbeat = window.setInterval(
      () => run(runtime => runtime.touchCurrentAuditConnection(identity)),
      AUDIT_CONNECTION_HEARTBEAT_MS
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run(runtime => runtime.touchCurrentAuditConnection(identity));
      }
    };
    const onOffline = () => run(runtime => runtime.markCurrentAuditConnectionOffline(uid));
    const onOnline = () => run(runtime => runtime.markCurrentAuditConnectionOnline(uid));

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) onOffline();

    return () => {
      active = false;
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [uid, email, name]);
};
