/**
 * Public surface of the transfer requests that the census writes and reads.
 */

export { createFinalizedTransferRequestMutationWithResult as createFinalizedTransferRequestWithResult } from '@/services/transfers/transferMutationsService';
export { completeTransferMutationWithResult as completeTransferWithResult } from '@/services/transfers/transferMutationsService';
export { getLatestOpenTransferRequestByBedIdQuery as getLatestOpenTransferRequestByBedId } from '@/services/transfers/transferQueriesService';
export { getLatestOpenTransferRequestByPatientRutQuery as getLatestOpenTransferRequestByPatientRut } from '@/services/transfers/transferQueriesService';
