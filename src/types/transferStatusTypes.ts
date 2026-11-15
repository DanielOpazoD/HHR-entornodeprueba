/**
 * Transfer request status progression.
 */
export type TransferStatus =
  | 'REQUESTED'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_CAPACITY'
  | 'ACCEPTED_WAITING_CAPACITY'
  | 'REJECTED'
  | 'NO_RESPONSE'
  | 'TRANSFERRED'
  | 'CANCELLED';
