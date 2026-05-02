import { doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import type { TransferRequest } from '@/types/transferRequestTypes';
import {
  getTransferHistoryCollection,
  getTransfersCollection,
} from '@/services/transfers/transferFirestoreCollections';
import {
  pickLatestOpenTransferFromSnapshot,
  pickLatestOpenTransferFromSnapshotForMonth,
  querySnapshotToTransfers,
  transferDocToEntity,
} from '@/services/transfers/transferSerializationController';
import { runWithFirestoreRuntime } from '@/services/storage/firestore/firestoreRuntimeSupport';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

interface TransferRequestLookupOptions {
  referenceDate?: string;
}

export const createTransferQueriesService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const shouldQueryRemote = (): boolean =>
    runtime !== defaultFirestoreServiceRuntime || isFirestoreEnabled();

  const getActiveTransfers = async (): Promise<TransferRequest[]> => {
    if (!shouldQueryRemote()) {
      return [];
    }

    return runWithFirestoreRuntime(runtime, async () => {
      const q = query(
        getTransfersCollection(runtime),
        where('status', '!=', 'TRANSFERRED'),
        orderBy('status'),
        orderBy('requestDate', 'desc')
      );

      const querySnapshot = await getDocs(q);
      return querySnapshotToTransfers(querySnapshot);
    });
  };

  const getTransferById = async (id: string): Promise<TransferRequest | null> => {
    if (!shouldQueryRemote()) {
      return null;
    }

    return runWithFirestoreRuntime(runtime, async () => {
      const activeDocRef = doc(getTransfersCollection(runtime), id);
      const activeSnapshot = await getDoc(activeDocRef);

      if (activeSnapshot.exists()) {
        return transferDocToEntity(activeSnapshot.data() as Record<string, unknown>, id);
      }

      const historyDocRef = doc(getTransferHistoryCollection(runtime), id);
      const historySnapshot = await getDoc(historyDocRef);

      if (historySnapshot.exists()) {
        return transferDocToEntity(historySnapshot.data() as Record<string, unknown>, id);
      }

      return null;
    });
  };

  const getLatestOpenTransferRequestByBedId = async (
    bedId: string,
    options: TransferRequestLookupOptions = {}
  ): Promise<TransferRequest | null> => {
    if (!shouldQueryRemote()) {
      return null;
    }

    return runWithFirestoreRuntime(runtime, async () => {
      const q = query(getTransfersCollection(runtime), where('bedId', '==', bedId));
      const querySnapshot = await getDocs(q);
      if (options.referenceDate) {
        return pickLatestOpenTransferFromSnapshotForMonth(querySnapshot, options.referenceDate);
      }
      return pickLatestOpenTransferFromSnapshot(querySnapshot);
    });
  };

  const getLatestOpenTransferRequestByPatientRut = async (
    patientRut: string
  ): Promise<TransferRequest | null> => {
    const normalizedRut = patientRut.trim();
    if (!normalizedRut) {
      return null;
    }
    if (!shouldQueryRemote()) {
      return null;
    }

    return runWithFirestoreRuntime(runtime, async () => {
      const q = query(
        getTransfersCollection(runtime),
        where('patientSnapshot.rut', '==', normalizedRut)
      );
      const querySnapshot = await getDocs(q);
      return pickLatestOpenTransferFromSnapshot(querySnapshot);
    });
  };

  return {
    getActiveTransfers,
    getTransferById,
    getLatestOpenTransferRequestByBedId,
    getLatestOpenTransferRequestByPatientRut,
  };
};

const defaultTransferQueriesService = createTransferQueriesService();

export const getActiveTransfersQuery = async (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferRequest[]> =>
  (runtime === defaultFirestoreServiceRuntime
    ? defaultTransferQueriesService
    : createTransferQueriesService(runtime)
  ).getActiveTransfers();

export const getTransferByIdQuery = async (
  id: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferRequest | null> =>
  (runtime === defaultFirestoreServiceRuntime
    ? defaultTransferQueriesService
    : createTransferQueriesService(runtime)
  ).getTransferById(id);

export const getLatestOpenTransferRequestByBedIdQuery = async (
  bedId: string,
  options: TransferRequestLookupOptions = {},
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferRequest | null> =>
  (runtime === defaultFirestoreServiceRuntime
    ? defaultTransferQueriesService
    : createTransferQueriesService(runtime)
  ).getLatestOpenTransferRequestByBedId(bedId, options);

export const getLatestOpenTransferRequestByPatientRutQuery = async (
  patientRut: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): Promise<TransferRequest | null> =>
  (runtime === defaultFirestoreServiceRuntime
    ? defaultTransferQueriesService
    : createTransferQueriesService(runtime)
  ).getLatestOpenTransferRequestByPatientRut(patientRut);
