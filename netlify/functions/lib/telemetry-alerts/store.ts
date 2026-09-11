import { getStore, type Store } from '@netlify/blobs';
import { validateLedger } from './queuePolicy';
import type { AlertLedger, AlertLedgerStore } from './queueTypes';

export interface TelemetryRuntimeContext {
  deploy: { context: string; id: string; published: boolean };
  site: { url: string };
  ip?: string;
}
export const ALERT_LEDGER_KEY = 'delivery-ledger';

export const alertStoreName = (context: TelemetryRuntimeContext): string => {
  if (!context?.deploy?.id || !/^[a-zA-Z0-9-]{1,80}$/.test(context.deploy.id)) {
    throw new Error('alert_deploy_context_missing');
  }
  // Only the published production function can touch production receipts. Previews and
  // unpublished production deploys have separate ledgers even on the same Netlify site.
  return context.deploy.context === 'production' && context.deploy.published
    ? 'operational-alerts-v1-production'
    : `operational-alerts-v1-preview-${context.deploy.id}`;
};

export const createBlobAlertLedgerStore = (
  store: Pick<Store, 'getWithMetadata' | 'setJSON'>
): AlertLedgerStore => ({
  async read() {
    const result = await store.getWithMetadata(ALERT_LEDGER_KEY, {
      type: 'json',
      consistency: 'strong',
    });
    if (!result) return null;
    if (!result.etag) throw new Error('alert_ledger_etag_missing');
    const ledger = result.data as AlertLedger;
    validateLedger(ledger);
    return { ledger, etag: result.etag };
  },
  async compareAndSet(ledger, etag) {
    validateLedger(ledger);
    const result = await store.setJSON(
      ALERT_LEDGER_KEY,
      ledger,
      etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag }
    );
    return result.modified;
  },
});

/** SDK 11 may call a non-412 failed PUT modified:true. Verify HTTP, not just that flag. */
export const createAlertBlobFetch =
  (fetcher: typeof fetch = fetch, deadlineAt = Infinity): typeof fetch =>
  async (input, init) => {
    const remaining = deadlineAt - Date.now();
    if (remaining < 50) throw new Error('alert_execution_deadline');
    const response = await fetcher(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(Math.min(3_000, Math.ceil(remaining))),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    const method = (init?.method ?? 'GET').toUpperCase();
    if (
      !response.ok &&
      !(method === 'GET' && response.status === 404) &&
      !(method === 'PUT' && response.status === 412)
    ) {
      throw new Error('alert_blob_transport_rejected');
    }
    return response;
  };

export const getRuntimeAlertLedgerStore = (
  context: TelemetryRuntimeContext,
  deadlineAt = Infinity
): AlertLedgerStore =>
  createBlobAlertLedgerStore(
    getStore({
      name: alertStoreName(context),
      consistency: 'strong',
      fetch: createAlertBlobFetch(fetch, deadlineAt),
    })
  );
