import { createRuntimeAlertQueue, logAlertDelivery } from './lib/telemetry-alerts/runtime';
import type { TelemetryRuntimeContext } from './lib/telemetry-alerts/store';

/** Netlify invokes this privately; config.schedule prevents public HTTP invocation. */
export default async (_request: Request, context: TelemetryRuntimeContext): Promise<void> => {
  try {
    const result = await createRuntimeAlertQueue(context).drain(1);
    logAlertDelivery(
      JSON.stringify({ source: 'operational-telemetry', kind: 'retry_sweep', ...result })
    );
  } catch {
    logAlertDelivery(
      JSON.stringify({
        source: 'operational-telemetry',
        kind: 'retry_unavailable',
        code: 'alert_store_unavailable',
      })
    );
    // Surface a failed scheduled invocation, without logging raw provider/storage errors.
    throw new Error('alert_retry_unavailable');
  }
};
export const config = { schedule: '*/5 * * * *' };
