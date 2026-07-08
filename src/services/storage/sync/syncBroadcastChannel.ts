const CHANNEL_NAME = 'hhr_records_sync_channel';

const TAB_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}`;

export interface SyncDailyRecordStoreChangedDetail {
  dates?: string[];
  operation: 'save' | 'delete' | 'clear';
}

export type SyncBroadcastMessage = {
  type: 'DAILY_RECORD_STORE_CHANGED';
  detail: SyncDailyRecordStoreChangedDetail;
  tabId: string;
};

let channel: BroadcastChannel | null = null;

const isStoreChangedOperation = (
  operation: unknown
): operation is SyncDailyRecordStoreChangedDetail['operation'] =>
  operation === 'save' || operation === 'delete' || operation === 'clear';

const isStoreChangedDetail = (detail: unknown): detail is SyncDailyRecordStoreChangedDetail => {
  if (!detail || typeof detail !== 'object') return false;
  const candidate = detail as Partial<SyncDailyRecordStoreChangedDetail>;
  if (!isStoreChangedOperation(candidate.operation)) return false;
  if (candidate.dates === undefined) return true;
  return Array.isArray(candidate.dates) && candidate.dates.every(date => typeof date === 'string');
};

const isSyncBroadcastMessage = (message: unknown): message is SyncBroadcastMessage => {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<SyncBroadcastMessage>;
  return (
    candidate.type === 'DAILY_RECORD_STORE_CHANGED' &&
    typeof candidate.tabId === 'string' &&
    isStoreChangedDetail(candidate.detail)
  );
};

const getChannel = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return channel;
};

export const broadcastDailyRecordStoreChanged = (
  detail: SyncDailyRecordStoreChangedDetail
): void => {
  getChannel()?.postMessage({
    type: 'DAILY_RECORD_STORE_CHANGED',
    detail,
    tabId: TAB_ID,
  } satisfies SyncBroadcastMessage);
};

export const onSyncBroadcastMessage = (
  callback: (message: SyncBroadcastMessage) => void
): (() => void) => {
  const ch = getChannel();
  if (!ch) return () => {};

  const handler = (event: MessageEvent<unknown>) => {
    if (!isSyncBroadcastMessage(event.data)) return;
    if (event.data.tabId === TAB_ID) return;
    callback(event.data);
  };

  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
};

export const resetSyncBroadcastChannelForTests = (): void => {
  channel?.close();
  channel = null;
};
