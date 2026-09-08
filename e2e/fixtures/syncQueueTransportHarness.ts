import type { Page } from '@playwright/test';

interface PendingSyncTaskCall {
  task: Record<string, unknown>;
  succeed: () => void;
  reject: (message?: string) => void;
}

export interface SyncQueueTransportHarness {
  nextCall: () => Promise<PendingSyncTaskCall>;
  disable: () => Promise<void>;
}

export const installSyncQueueTransportHarness = async (
  page: Page
): Promise<SyncQueueTransportHarness> => {
  const queuedCalls: PendingSyncTaskCall[] = [];
  const waitingConsumers: Array<(call: PendingSyncTaskCall) => void> = [];

  await page.exposeFunction(
    '__HHR_E2E_RUN_SYNC_TASK__',
    (task: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        const call: PendingSyncTaskCall = {
          task,
          succeed: resolve,
          reject: (message = 'Synthetic sync transport failure') => reject(new Error(message)),
        };
        const consumer = waitingConsumers.shift();
        if (consumer) consumer(call);
        else queuedCalls.push(call);
      })
  );

  return {
    disable: () =>
      page.evaluate(() => {
        (
          window as Window & {
            __HHR_E2E_RUN_SYNC_TASK__?: unknown;
          }
        ).__HHR_E2E_RUN_SYNC_TASK__ = undefined;
      }),
    nextCall: () => {
      const queued = queuedCalls.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise(resolve => waitingConsumers.push(resolve));
    },
  };
};
