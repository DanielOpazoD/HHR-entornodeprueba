import React from 'react';
import type { SystemHealthReporterBridge as SystemHealthReporterBridgeComponent } from '@/hooks/admin/SystemHealthReporterBridge';

export const SYSTEM_HEALTH_REPORTING_ENABLE_DELAY_MS = 1500;

const loadSystemHealthReporterBridge = async (): Promise<
  typeof SystemHealthReporterBridgeComponent
> =>
  import('@/hooks/admin/SystemHealthReporterBridge').then(
    module => module.SystemHealthReporterBridge
  );

export const DeferredSystemHealthReporter = () => {
  const [Reporter, setReporter] = React.useState<null | typeof SystemHealthReporterBridgeComponent>(
    null
  );

  React.useEffect(() => {
    let isMounted = true;
    const timeoutId = window.setTimeout(() => {
      void loadSystemHealthReporterBridge()
        .then(component => {
          if (!isMounted) {
            return;
          }
          setReporter(() => component);
        })
        .catch(() => {
          // Diagnostics are non-critical. A transient/offline chunk failure must not
          // surface as an unhandled rejection or interrupt the clinical workspace.
        });
    }, SYSTEM_HEALTH_REPORTING_ENABLE_DELAY_MS);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (!Reporter) {
    return null;
  }

  return <Reporter enabled />;
};
