/**
 * Transfer Service Facade
 * Public API for patient transfer request operations
 */

export { createTransferRequestMutation as createTransferRequest } from '@/services/transfers/transferMutationsService';
export { createTransferRequestMutationWithResult as createTransferRequestWithResult } from '@/services/transfers/transferMutationsService';
export { createFinalizedTransferRequestMutationWithResult as createFinalizedTransferRequestWithResult } from '@/services/transfers/transferMutationsService';
export { updateTransferRequestMutation as updateTransferRequest } from '@/services/transfers/transferMutationsService';
export { updateTransferRequestMutationWithResult as updateTransferRequestWithResult } from '@/services/transfers/transferMutationsService';
export { changeTransferStatusMutation as changeTransferStatus } from '@/services/transfers/transferMutationsService';
export { changeTransferStatusMutationWithResult as changeTransferStatusWithResult } from '@/services/transfers/transferMutationsService';
export { completeTransferMutation as completeTransfer } from '@/services/transfers/transferMutationsService';
export { completeTransferMutationWithResult as completeTransferWithResult } from '@/services/transfers/transferMutationsService';
export { deleteTransferRequestMutation as deleteTransferRequest } from '@/services/transfers/transferMutationsService';
export { deleteTransferRequestMutationWithResult as deleteTransferRequestWithResult } from '@/services/transfers/transferMutationsService';
export { deleteFinalizedTransferMutationWithResult as deleteFinalizedTransferWithResult } from '@/services/transfers/transferMutationsService';
export { deleteStatusHistoryEntryMutation as deleteStatusHistoryEntry } from '@/services/transfers/transferMutationsService';
export { deleteStatusHistoryEntryMutationWithResult as deleteStatusHistoryEntryWithResult } from '@/services/transfers/transferMutationsService';
export { getActiveTransfersQuery as getActiveTransfers } from '@/services/transfers/transferQueriesService';
export { getTransferByIdQuery as getTransferById } from '@/services/transfers/transferQueriesService';
export { getLatestOpenTransferRequestByBedIdQuery as getLatestOpenTransferRequestByBedId } from '@/services/transfers/transferQueriesService';
export { getLatestOpenTransferRequestByPatientRutQuery as getLatestOpenTransferRequestByPatientRut } from '@/services/transfers/transferQueriesService';
export { subscribeToTransfersRealtime as subscribeToTransfers } from '@/services/transfers/transferSubscriptionsService';
export type { TransferMutationResult } from '@/services/transfers/transferMutationsService';
