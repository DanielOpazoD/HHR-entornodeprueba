import { deleteDoc, setDoc, Timestamp } from 'firebase/firestore';
import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';
import {
  buildTransferOperationError,
  resolveTransferOperationErrorKind,
  type TransferOperationErrorKind,
} from '@/services/transfers/transferErrorPolicy';
import { transferMutationsLogger } from '@/services/transfers/transferLoggers';
import { runWithFirestoreRuntime } from '@/services/storage/firestore/firestoreRuntimeSupport';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  buildCompletedTransferRecord,
  buildStatusChange,
  buildTransferHistoryDeletionPatch,
  buildTransferRequestRecord,
  createTransferDocumentRef,
  createTransferHistoryDocumentRef,
  generateTransferId,
  readTransferRequestOrThrow,
  type CreateTransferRequestData,
  writeTransferMergePatch,
} from '@/services/transfers/transferMutationSupport';

export type TransferMutationResult<T = null> =
  | { status: 'success'; data: T }
  | {
      status: TransferOperationErrorKind;
      error: unknown;
      data: null;
      userSafeMessage: string;
    };

const buildTransferFailureResult = <T = null>(
  error: unknown,
  userSafeMessage: string
): TransferMutationResult<T> => {
  const kind = resolveTransferOperationErrorKind(error);
  const operationError = buildTransferOperationError(kind, userSafeMessage);

  return {
    status: kind,
    error: operationError,
    data: null,
    userSafeMessage: operationError.userSafeMessage,
  };
};

export const createTransferMutationsService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const createTransferRequestWithResult = async (
    data: CreateTransferRequestData
  ): Promise<TransferMutationResult<TransferRequest>> => {
    try {
      return await runWithFirestoreRuntime(runtime, async () => {
        const id = generateTransferId();
        const transfer = buildTransferRequestRecord(data, id);
        const docRef = createTransferDocumentRef(runtime, id);
        await setDoc(docRef, {
          ...transfer,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        transferMutationsLogger.info('Created transfer request', { transferId: id });
        return { status: 'success', data: transfer };
      });
    } catch (error) {
      transferMutationsLogger.error('Error creating transfer request', error);
      return buildTransferFailureResult(error, 'No se pudo crear la solicitud de traslado.');
    }
  };

  const createTransferRequest = async (
    data: CreateTransferRequestData
  ): Promise<TransferRequest> => {
    const result = await createTransferRequestWithResult(data);
    if (result.status !== 'success') throw result.error;
    return result.data;
  };

  const createFinalizedTransferRequestWithResult = async (
    data: CreateTransferRequestData,
    userId: string
  ): Promise<TransferMutationResult<TransferRequest>> => {
    try {
      return await runWithFirestoreRuntime(runtime, async () => {
        const id = generateTransferId();
        const transfer = buildTransferRequestRecord(data, id);
        const completedTransfer = buildCompletedTransferRecord(transfer, userId);
        const historyRef = createTransferHistoryDocumentRef(runtime, id);
        await setDoc(historyRef, {
          ...completedTransfer,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        transferMutationsLogger.info('Created finalized transfer request', { transferId: id });
        return {
          status: 'success',
          data: {
            ...transfer,
            status: 'TRANSFERRED',
            statusHistory: completedTransfer.statusHistory,
          },
        };
      });
    } catch (error) {
      transferMutationsLogger.error('Error creating finalized transfer request', error);
      return buildTransferFailureResult(
        error,
        'No se pudo crear el traslado finalizado automáticamente.'
      );
    }
  };

  const updateTransferRequestWithResult = async (
    id: string,
    data: Partial<TransferRequest>
  ): Promise<TransferMutationResult> => {
    try {
      return await runWithFirestoreRuntime(runtime, async () => {
        const docRef = createTransferDocumentRef(runtime, id);
        await writeTransferMergePatch(docRef, data);
        transferMutationsLogger.info('Updated transfer request', {
          transferId: id,
          fields: Object.keys(data),
        });
        return { status: 'success', data: null };
      });
    } catch (error) {
      transferMutationsLogger.error('Error updating transfer request', error);
      return buildTransferFailureResult(error, 'No se pudo actualizar la solicitud de traslado.');
    }
  };

  const updateTransferRequest = async (
    id: string,
    data: Partial<TransferRequest>
  ): Promise<void> => {
    const result = await updateTransferRequestWithResult(id, data);
    if (result.status !== 'success') throw result.error;
  };

  const changeTransferStatusWithResult = async (
    id: string,
    newStatus: TransferStatus,
    userId: string,
    notes?: string
  ): Promise<TransferMutationResult> => {
    try {
      const { docRef, transfer } = await readTransferRequestOrThrow(runtime, id);
      await writeTransferMergePatch(docRef, {
        status: newStatus,
        statusHistory: [
          ...(transfer.statusHistory || []),
          buildStatusChange(transfer.status, newStatus, userId, notes),
        ],
      });
      transferMutationsLogger.info('Changed transfer status', { transferId: id, to: newStatus });
      return { status: 'success', data: null };
    } catch (error) {
      transferMutationsLogger.error('Error changing transfer status', error);
      return buildTransferFailureResult(error, 'No se pudo cambiar el estado del traslado.');
    }
  };

  const changeTransferStatus = async (
    id: string,
    newStatus: TransferStatus,
    userId: string,
    notes?: string
  ): Promise<void> => {
    const result = await changeTransferStatusWithResult(id, newStatus, userId, notes);
    if (result.status !== 'success') throw result.error;
  };

  const completeTransferWithResult = async (
    id: string,
    userId: string
  ): Promise<TransferMutationResult> => {
    try {
      const { docRef, transfer } = await readTransferRequestOrThrow(runtime, id);
      const completedTransfer = buildCompletedTransferRecord(transfer, userId);
      const historyRef = createTransferHistoryDocumentRef(runtime, id);
      await setDoc(historyRef, completedTransfer);
      await deleteDoc(docRef);
      transferMutationsLogger.info('Completed transfer request', { transferId: id });
      return { status: 'success', data: null };
    } catch (error) {
      transferMutationsLogger.error('Error completing transfer request', error);
      return buildTransferFailureResult(error, 'No se pudo completar el traslado.');
    }
  };

  const completeTransfer = async (id: string, userId: string): Promise<void> => {
    const result = await completeTransferWithResult(id, userId);
    if (result.status !== 'success') throw result.error;
  };

  const deleteTransferRequestWithResult = async (id: string): Promise<TransferMutationResult> => {
    try {
      return await runWithFirestoreRuntime(runtime, async () => {
        const docRef = createTransferDocumentRef(runtime, id);
        await deleteDoc(docRef);
        transferMutationsLogger.info('Deleted transfer request', { transferId: id });
        return { status: 'success', data: null };
      });
    } catch (error) {
      transferMutationsLogger.error('Error deleting transfer request', error);
      return buildTransferFailureResult(error, 'No se pudo eliminar la solicitud de traslado.');
    }
  };

  const deleteTransferRequest = async (id: string): Promise<void> => {
    const result = await deleteTransferRequestWithResult(id);
    if (result.status !== 'success') throw result.error;
  };

  /** Permanently removes a finalized transfer from the history collection. */
  const deleteFinalizedTransferWithResult = async (id: string): Promise<TransferMutationResult> => {
    try {
      return await runWithFirestoreRuntime(runtime, async () => {
        const docRef = createTransferHistoryDocumentRef(runtime, id);
        await deleteDoc(docRef);
        transferMutationsLogger.info('Deleted finalized transfer from history', {
          transferId: id,
        });
        return { status: 'success', data: null };
      });
    } catch (error) {
      transferMutationsLogger.error('Error deleting finalized transfer', error);
      return buildTransferFailureResult(
        error,
        'No se pudo eliminar el registro de traslado finalizado.'
      );
    }
  };

  const deleteStatusHistoryEntryWithResult = async (
    id: string,
    historyIndex: number
  ): Promise<TransferMutationResult> => {
    try {
      const { docRef, transfer } = await readTransferRequestOrThrow(runtime, id);
      await writeTransferMergePatch(
        docRef,
        buildTransferHistoryDeletionPatch(transfer, historyIndex)
      );
      transferMutationsLogger.info('Deleted transfer history entry', {
        transferId: id,
        historyIndex,
      });
      return { status: 'success', data: null };
    } catch (error) {
      transferMutationsLogger.error('Error deleting transfer history entry', error);
      return buildTransferFailureResult(
        error,
        'No se pudo eliminar el registro del historial de traslado.'
      );
    }
  };

  const deleteStatusHistoryEntry = async (id: string, historyIndex: number): Promise<void> => {
    const result = await deleteStatusHistoryEntryWithResult(id, historyIndex);
    if (result.status !== 'success') throw result.error;
  };

  return {
    createTransferRequest,
    createTransferRequestWithResult,
    createFinalizedTransferRequestWithResult,
    updateTransferRequest,
    updateTransferRequestWithResult,
    changeTransferStatus,
    changeTransferStatusWithResult,
    completeTransfer,
    completeTransferWithResult,
    deleteTransferRequest,
    deleteTransferRequestWithResult,
    deleteFinalizedTransferWithResult,
    deleteStatusHistoryEntry,
    deleteStatusHistoryEntryWithResult,
  };
};

const defaultTransferMutationsService = createTransferMutationsService();

const resolveTransferMutationsService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) =>
  runtime === defaultFirestoreServiceRuntime
    ? defaultTransferMutationsService
    : createTransferMutationsService(runtime);

export const createTransferRequestMutation = async (
  data: Omit<TransferRequest, 'id' | 'createdAt' | 'updatedAt' | 'statusHistory'>
): Promise<TransferRequest> => defaultTransferMutationsService.createTransferRequest(data);

export const createTransferRequestMutationWithResult = async (
  data: CreateTransferRequestData,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult<TransferRequest>> =>
  resolveTransferMutationsService(runtime).createTransferRequestWithResult(data);

export const createFinalizedTransferRequestMutationWithResult = async (
  data: CreateTransferRequestData,
  userId: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult<TransferRequest>> =>
  resolveTransferMutationsService(runtime).createFinalizedTransferRequestWithResult(data, userId);

export const updateTransferRequestMutation = async (
  id: string,
  data: Partial<TransferRequest>
): Promise<void> => defaultTransferMutationsService.updateTransferRequest(id, data);

export const updateTransferRequestMutationWithResult = async (
  id: string,
  data: Partial<TransferRequest>,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).updateTransferRequestWithResult(id, data);

export const changeTransferStatusMutation = async (
  id: string,
  newStatus: TransferStatus,
  userId: string,
  notes?: string
): Promise<void> =>
  defaultTransferMutationsService.changeTransferStatus(id, newStatus, userId, notes);

export const changeTransferStatusMutationWithResult = async (
  id: string,
  newStatus: TransferStatus,
  userId: string,
  notes?: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).changeTransferStatusWithResult(
    id,
    newStatus,
    userId,
    notes
  );

export const completeTransferMutation = async (id: string, userId: string): Promise<void> =>
  defaultTransferMutationsService.completeTransfer(id, userId);

export const completeTransferMutationWithResult = async (
  id: string,
  userId: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).completeTransferWithResult(id, userId);

export const deleteTransferRequestMutation = async (id: string): Promise<void> =>
  defaultTransferMutationsService.deleteTransferRequest(id);

export const deleteTransferRequestMutationWithResult = async (
  id: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).deleteTransferRequestWithResult(id);

export const deleteFinalizedTransferMutationWithResult = async (
  id: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).deleteFinalizedTransferWithResult(id);

export const deleteStatusHistoryEntryMutation = async (
  id: string,
  historyIndex: number
): Promise<void> => defaultTransferMutationsService.deleteStatusHistoryEntry(id, historyIndex);

export const deleteStatusHistoryEntryMutationWithResult = async (
  id: string,
  historyIndex: number,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferMutationResult> =>
  resolveTransferMutationsService(runtime).deleteStatusHistoryEntryWithResult(id, historyIndex);
