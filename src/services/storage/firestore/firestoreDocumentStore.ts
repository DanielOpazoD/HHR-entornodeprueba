import {
  getDoc,
  onSnapshot,
  setDoc,
  type DocumentReference,
  type Firestore,
  type SetOptions,
  type SnapshotListenOptions,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore/firestoreRuntimeSupport';

export interface FirestoreDocumentRuntimePort {
  getDb: () => Firestore;
  ready?: Promise<void>;
}

type FirestoreDocumentRefResolver<TRuntime extends FirestoreDocumentRuntimePort> = (
  runtime: TRuntime
) => DocumentReference;

export const readFirestoreDocument = async <
  TDocument,
  TRuntime extends FirestoreDocumentRuntimePort,
>(
  runtime: TRuntime,
  resolveRef: FirestoreDocumentRefResolver<TRuntime>
): Promise<TDocument | null> => {
  await ensureFirestoreRuntimeReady(runtime);
  const snapshot = await getDoc(resolveRef(runtime));
  return snapshot.exists() ? (snapshot.data() as TDocument) : null;
};

export const saveFirestoreDocument = async <
  TDocument,
  TRuntime extends FirestoreDocumentRuntimePort,
>(
  runtime: TRuntime,
  resolveRef: FirestoreDocumentRefResolver<TRuntime>,
  value: TDocument,
  options?: SetOptions
): Promise<void> => {
  await ensureFirestoreRuntimeReady(runtime);
  if (options) {
    await setDoc(resolveRef(runtime), value as never, options);
    return;
  }
  await setDoc(resolveRef(runtime), value as never);
};

interface SubscribeToFirestoreDocumentInput<
  TDocument,
  TRuntime extends FirestoreDocumentRuntimePort,
> {
  runtime: TRuntime;
  resolveRef: FirestoreDocumentRefResolver<TRuntime>;
  onData: (value: TDocument | null) => void;
  onError: (error: unknown) => void;
  options?: SnapshotListenOptions;
  confirmedChangesOnly?: boolean;
}

export const subscribeToFirestoreDocument = <
  TDocument,
  TRuntime extends FirestoreDocumentRuntimePort,
>({
  runtime,
  resolveRef,
  onData,
  onError,
  options,
  confirmedChangesOnly = false,
}: SubscribeToFirestoreDocumentInput<TDocument, TRuntime>): (() => void) => {
  let active = true;
  let unsubscribeSnapshot = () => {};

  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) {
        return;
      }

      let previous: DocumentSnapshot | undefined;
      const next = (snapshot: DocumentSnapshot) => {
        if (!active || (confirmedChangesOnly && snapshot.metadata.hasPendingWrites)) return;
        if (
          confirmedChangesOnly &&
          previous &&
          JSON.stringify(previous.data()) === JSON.stringify(snapshot.data())
        )
          return;
        previous = snapshot;
        onData(snapshot.exists() ? (snapshot.data() as TDocument) : null);
      };
      const error = (snapshotError: unknown) => {
        if (active) onError(snapshotError);
      };

      const listenOptions = confirmedChangesOnly
        ? { ...options, includeMetadataChanges: true }
        : options;
      unsubscribeSnapshot = listenOptions
        ? onSnapshot(resolveRef(runtime), listenOptions, next, error)
        : onSnapshot(resolveRef(runtime), next, error);
    })
    .catch(error => {
      if (active) onError(error);
    });

  return () => {
    active = false;
    unsubscribeSnapshot();
  };
};
