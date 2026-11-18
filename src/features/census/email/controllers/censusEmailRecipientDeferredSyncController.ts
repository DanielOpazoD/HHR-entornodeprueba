import { resolveRecipientSyncState } from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import type { DeferredRecipientSyncInput } from '@/features/census/email/controllers/censusEmailRecipientSyncController';
import type { RecipientUseCaseResult } from '@/features/census/email/controllers/censusEmailRecipientUseCaseLoader';

interface ScheduleDeferredRecipientSyncOptions {
  syncInput: DeferredRecipientSyncInput;
  recipients: string[];
  delayMs?: number;
  executeSync: (
    syncInput: DeferredRecipientSyncInput
  ) => Promise<RecipientUseCaseResult<{ skipped?: boolean }>>;
  onSyncStart: () => void;
  onSyncState: (nextState: ReturnType<typeof resolveRecipientSyncState>) => void;
  onSyncComplete: () => void;
}

export const runDeferredRecipientSync = async (
  input: DeferredRecipientSyncInput,
  executeSync: ScheduleDeferredRecipientSyncOptions['executeSync']
): Promise<RecipientUseCaseResult<{ skipped?: boolean }>> => executeSync(input);

export const scheduleDeferredRecipientSync = ({
  syncInput,
  recipients,
  delayMs = 250,
  executeSync,
  onSyncStart,
  onSyncState,
  onSyncComplete,
}: ScheduleDeferredRecipientSyncOptions): (() => void) => {
  let cancelled = false;

  const timeoutId = window.setTimeout(() => {
    onSyncStart();

    void runDeferredRecipientSync(syncInput, executeSync)
      .then(result => {
        if (cancelled) return;
        onSyncState(resolveRecipientSyncState(result, recipients));
      })
      .finally(() => {
        if (!cancelled) {
          onSyncComplete();
        }
      });
  }, delayMs);

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
    onSyncComplete();
  };
};
