export const DAILY_RECORD_DELETE_OUTBOX_POLICY = {
  requiresTransactionalOutbox: false,
  remoteMode: 'best_effort_soft_delete',
  localRequirement: 'strict_local_delete_before_remote_cleanup',
  rationale: [
    'delete_day is a lifecycle/admin cleanup, not a clinical offline-first mutation',
    'the local delete must be strict so UI state does not pretend an unsafe delete succeeded',
    'remote moveToTrash/delete is already non-blocking and logged by lifecycle support',
  ],
  reviewTriggers: [
    'offline_delete_required',
    'delete_visible_as_clinical_workflow',
    'remote_delete_audit_must_be_exactly_once',
    'support_needs_retryable_trash_reconciliation',
  ],
} as const;

export const shouldQueueDailyRecordDeleteOutbox = (): boolean =>
  DAILY_RECORD_DELETE_OUTBOX_POLICY.requiresTransactionalOutbox;

export const assertDailyRecordDeleteOutboxPolicy = (): void => {
  if (!shouldQueueDailyRecordDeleteOutbox()) {
    return;
  }

  throw new Error(
    'delete/moveToTrash requires an explicit tombstone outbox before transactional delete queueing can be enabled.'
  );
};
