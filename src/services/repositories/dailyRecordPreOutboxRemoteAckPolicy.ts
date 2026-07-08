import type { SyncQueueEnqueueOptions } from '@/services/storage/sync/syncQueueEnqueuePolicy';

const PRE_OUTBOX_DIRECT_WRITE_HOLD_MS = 5_000;
const PRE_OUTBOX_DIRECT_WRITE_HEARTBEAT_MS = 2_000;

export const buildPreOutboxRemoteAckOptions = (syncContract: {
  tabId?: string;
  clientId?: string;
}): SyncQueueEnqueueOptions => ({
  deferProcessing: true,
  holdForMs: PRE_OUTBOX_DIRECT_WRITE_HOLD_MS,
  preOutboxHoldOwner: syncContract.tabId || syncContract.clientId || 'unknown_direct_writer',
  preOutboxHoldReason: 'awaiting_remote_ack',
});

export const getPreOutboxRemoteAckLeaseMs = (): number => PRE_OUTBOX_DIRECT_WRITE_HOLD_MS;

export const getPreOutboxRemoteAckHeartbeatMs = (): number => PRE_OUTBOX_DIRECT_WRITE_HEARTBEAT_MS;
