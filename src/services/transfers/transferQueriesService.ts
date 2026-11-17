import { getDocs, query, where } from 'firebase/firestore';
import type { TransferRequest } from '@/types/transferRequestTypes';
import { getTransfersCollection } from '@/services/transfers/transferFirestoreCollections';
import {
  pickLatestOpenTransferFromSnapshot,
  pickLatestOpenTransferFromSnapshotForMonth,
} from '@/services/transfers/transferSerializationController';
import { runWithFirestoreRuntime } from '@/services/storage/firestore/firestoreRuntimeSupport';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

interface TransferRequestLookupOptions {
  referenceDate?: string;
}

const runtime = defaultFirestoreServiceRuntime;

export const getLatestOpenTransferRequestByBedIdQuery = async (
  bedId: string,
  options: TransferRequestLookupOptions = {}
): Promise<TransferRequest | null> => {
  if (!isFirestoreEnabled()) {
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

export const getLatestOpenTransferRequestByPatientRutQuery = async (
  patientRut: string
): Promise<TransferRequest | null> => {
  const normalizedRut = patientRut.trim();
  if (!normalizedRut) {
    return null;
  }
  if (!isFirestoreEnabled()) {
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
