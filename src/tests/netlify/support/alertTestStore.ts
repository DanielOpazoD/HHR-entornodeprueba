import type {
  AlertLedger,
  AlertLedgerStore,
} from '../../../../netlify/functions/lib/telemetry-alerts/queueTypes';

/** Atomic memory CAS for deterministic tests, not used by deployed code. */
export const createAlertTestStore = (): AlertLedgerStore => {
  let ledger: AlertLedger | null = null;
  let version = 0;
  return {
    async read() {
      return ledger ? { ledger: structuredClone(ledger), etag: String(version) } : null;
    },
    async compareAndSet(next, etag) {
      if ((ledger ? String(version) : null) !== etag) return false;
      ledger = structuredClone(next);
      version++;
      return true;
    },
  };
};
