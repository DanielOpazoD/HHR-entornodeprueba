import { deleteDoc, setDoc, Timestamp } from 'firebase/firestore';
import type { TransferRequest } from '@/types/transferRequestTypes';
import { transferMutationsLogger } from '@/services/transfers/transferLoggers';
import { runWithFirestoreRuntime } from '@/services/storage/firestore/firestoreRuntimeSupport';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  buildCompletedTransferRecord,
  buildTransferRequestRecord,
  createTransferHistoryDocumentRef,
  generateTransferId,
  readTransferRequestOrThrow,
  type CreateTransferRequestData,
} from '@/services/transfers/transferMutationSupport';

type TransferErrorLike = {
  code?: string;
  message?: string;
};

export type TransferOperationErrorKind = 'permission_denied' | 'not_found' | 'conflict' | 'unknown';

const normalizeText = (value: unknown): string => String(value || '').toLowerCase();

export const resolveTransferOperationErrorKind = (error: unknown): TransferOperationErrorKind => {
  const typed = error as TransferErrorLike;
  const code = normalizeText(typed?.code);
  const message = normalizeText(typed?.message);

  if (
    code.includes('permission-denied') ||
    code.includes('unauthorized') ||
    message.includes('missing or insufficient permissions')
  ) {
    return 'permission_denied';
  }

  if (message.includes('not found')) {
    return 'not_found';
  }

  if (message.includes('cannot delete') || message.includes('conflict')) {
    return 'conflict';
  }

  return 'unknown';
};

export const buildTransferOperationError = (
  kind: TransferOperationErrorKind,
  fallback: string
): Error & { code: TransferOperationErrorKind; userSafeMessage: string } => {
  const message =
    kind === 'permission_denied'
      ? 'No tienes permisos para completar esta acción de traslado.'
      : kind === 'not_found'
        ? 'La solicitud de traslado ya no existe o fue movida.'
        : kind === 'conflict'
          ? 'La acción no se puede completar por el estado actual del traslado.'
          : fallback;

  const error = new Error(message) as Error & {
    code: TransferOperationErrorKind;
    userSafeMessage: string;
  };
  error.code = kind;
  error.userSafeMessage = message;
  return error;
};

type TransferMutationResult<T = null> =
  | { status: 'success'; data: T }
  | {
      status: TransferOperationErrorKind;
      error: unknown;
      data: null;
      userSafeMessage: string;
    };

const runtime = defaultFirestoreServiceRuntime;

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

/** Writes a transfer the census already executed straight into the history collection. */
export const createFinalizedTransferRequestMutationWithResult = async (
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

/** Moves an open transfer request into the history collection as TRANSFERRED. */
export const completeTransferMutationWithResult = async (
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
