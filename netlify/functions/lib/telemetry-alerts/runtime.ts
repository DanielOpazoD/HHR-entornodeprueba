import { createAlertMailer } from './mail';
import { createAlertQueue } from './queue';
import { getRuntimeAlertLedgerStore, type TelemetryRuntimeContext } from './store';

export const createRuntimeAlertQueue = (
  context: TelemetryRuntimeContext,
  deadlineAt = Date.now() + 28_000
) =>
  createAlertQueue({
    // Reserve claim PUT (3s), Gmail (8s), receipt GET+PUT (6s), and a 2s margin.
    canClaim: () => deadlineAt - Date.now() >= 19_000,
    store: getRuntimeAlertLedgerStore(context, deadlineAt),
    send:
      context.deploy.context === 'production' && context.deploy.published
        ? createAlertMailer({ env: () => ({ ...process.env, URL: context.site.url }) })
        : async () => ({ kind: 'permanent', code: 'mail_not_configured' }),
  });

/** Only controlled codes/counts and sanitized events belong in these logs. */
export const logAlertDelivery = (line: string): void => {
  // eslint-disable-next-line no-console
  console.info(line);
};
