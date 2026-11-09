/**
 * Decides what a permission storm means, off the authenticated shell. A fresh token plus one
 * server read that every authorized role may do separates a transient denial from a real
 * permission loss. When the read works, the tab reloads so the listeners already denied start
 * again (the outbox is durable) and the person keeps the session. A second storm within the
 * cooldown, storage that cannot record the reload, or any doubt ends the session as before.
 */
import type { SessionPermissionStorm } from '@/services/auth/sessionPermissionStormDetector';
import {
  hasRecentRecoveryReload,
  markRecoveryReload,
  probeSessionReadPermission,
  type SessionPermissionProbeOutcome,
} from '@/services/auth/sessionPermissionProbe';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { createScopedLoggerMap } from '@/services/utils/loggerScope';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const { stormLogger } = createScopedLoggerMap({ stormLogger: 'SessionPermissionStorm' });

type StormProbeOutcome = SessionPermissionProbeOutcome | 'recent_recovery';

const stormContext = (storm: SessionPermissionStorm, probeOutcome: StormProbeOutcome) => ({
  sources: storm.sources,
  codes: storm.codes,
  detectedAt: storm.detectedAt,
  // What crosses to the server: how many sources of each kind, the code and the second opinion.
  count: storm.sources.length,
  catalogDenialCount: storm.sources.filter(source => source.startsWith('catalog:')).length,
  recordDenialCount: storm.sources.filter(source => source.startsWith('records:')).length,
  errorCode: storm.codes.includes('unauthenticated') ? 'unauthenticated' : 'permission-denied',
  mixedDenialCodes: storm.codes.length > 1,
  probeOutcome,
});

export const decideSessionPermissionStorm = async (
  storm: SessionPermissionStorm,
  lostMessage: string
): Promise<'recovering' | 'logout'> => {
  let outcome: StormProbeOutcome = 'failed';
  try {
    outcome = hasRecentRecoveryReload() ? 'recent_recovery' : await probeSessionReadPermission();
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'readable' && markRecoveryReload()) {
    stormLogger.warn('Permission storm was transient; reloading to restart listeners', storm);
    recordOperationalTelemetry({
      category: 'auth',
      operation: 'session_permission_storm_recovered',
      status: 'degraded',
      runtimeState: 'recoverable',
      context: stormContext(storm, outcome),
    });
    defaultBrowserWindowRuntime.reload();
    return 'recovering';
  }
  stormLogger.warn('Logout due to a permission-denied storm on basic reads', storm);
  recordOperationalTelemetry({
    category: 'auth',
    operation: 'session_permission_storm_logout',
    status: 'degraded',
    runtimeState: 'unauthorized',
    issues: [lostMessage],
    context: stormContext(storm, outcome),
  });
  return 'logout';
};
