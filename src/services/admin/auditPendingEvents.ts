/**
 * Edits are coalesced in memory for a short while (first "before", last "after"). Anything that
 * ends the page or the session asks every pending buffer to write now.
 */
type PendingAuditFlush = () => Promise<void>;

const flushers = new Set<PendingAuditFlush>();

export const registerPendingAuditFlush = (flush: PendingAuditFlush): (() => void) => {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
};

export const flushPendingAuditEvents = async (): Promise<void> => {
  await Promise.allSettled([...flushers].map(flush => flush()));
};
