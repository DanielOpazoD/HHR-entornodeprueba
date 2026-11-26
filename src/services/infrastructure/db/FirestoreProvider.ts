import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type QueryConstraint as FirebaseQueryConstraint,
  type UpdateData,
  type WithFieldValue,
} from 'firebase/firestore';
import { IDatabaseBatch, IDatabaseProvider, QueryOptions } from './types';

export interface FirestoreProviderApi {
  collection: typeof collection;
  deleteDoc: typeof deleteDoc;
  doc: typeof doc;
  getDoc: typeof getDoc;
  getDocs: typeof getDocs;
  getDocsFromServer?: typeof getDocsFromServer;
  limit: typeof limit;
  onSnapshot: typeof onSnapshot;
  orderBy: typeof orderBy;
  query: typeof query;
  setDoc: typeof setDoc;
  startAfter: typeof startAfter;
  updateDoc: typeof updateDoc;
  where: typeof where;
  writeBatch: typeof writeBatch;
}

const defaultFirestoreProviderApi: FirestoreProviderApi = {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
};

interface FirestoreProviderOptions {
  firestore?: Firestore;
  getFirestore?: () => Firestore;
  api?: FirestoreProviderApi;
}

export class FirestoreProvider implements IDatabaseProvider {
  private readonly getFirestoreInstance: () => Firestore;
  private readonly api: FirestoreProviderApi;

  constructor({
    firestore,
    getFirestore,
    api = defaultFirestoreProviderApi,
  }: FirestoreProviderOptions) {
    const resolveFirestore = getFirestore ?? (firestore ? () => firestore : null);

    if (!resolveFirestore) {
      throw new Error('FirestoreProvider requires a firestore instance or getter.');
    }

    this.getFirestoreInstance = () => {
      const instance = resolveFirestore();
      if (!instance) {
        throw new Error('Firestore instance is not available yet.');
      }
      return instance;
    };
    this.api = api;
  }

  async getDoc<T>(collectionName: string, id: string): Promise<T | null> {
    const docRef = this.api.doc(this.getFirestoreInstance(), collectionName, id);
    const snapshot = await this.api.getDoc(docRef);
    return snapshot.exists() ? (snapshot.data() as T) : null;
  }

  async getDocs<T>(collectionName: string, options?: QueryOptions): Promise<T[]> {
    const constraints = this.buildConstraints(options);
    const collectionRef = this.api.collection(this.getFirestoreInstance(), collectionName);
    const readDocs =
      options?.source === 'server'
        ? (this.api.getDocsFromServer ?? getDocsFromServer)
        : this.api.getDocs;
    const snapshot = await readDocs(this.api.query(collectionRef, ...constraints));
    if (options?.source === 'server' && snapshot.metadata?.fromCache) {
      throw new Error('Server read unavailable: Firestore returned cached results.');
    }
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as T);
  }

  async setDoc<T>(
    collectionName: string,
    id: string,
    data: T,
    options?: { merge?: boolean }
  ): Promise<void> {
    const docRef = this.api.doc(
      this.getFirestoreInstance(),
      collectionName,
      id
    ) as DocumentReference<T>;

    if (options?.merge) {
      await this.api.setDoc(docRef, data as WithFieldValue<T>, { merge: true });
      return;
    }

    await this.api.setDoc(docRef, data as WithFieldValue<T>);
  }

  async updateDoc(
    collectionName: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const docRef = this.api.doc(this.getFirestoreInstance(), collectionName, id);
    await this.api.updateDoc(docRef, data as UpdateData<Record<string, unknown>>);
  }

  async deleteDoc(collectionName: string, id: string): Promise<void> {
    const docRef = this.api.doc(this.getFirestoreInstance(), collectionName, id);
    await this.api.deleteDoc(docRef);
  }

  subscribeDoc<T>(
    collectionName: string,
    id: string,
    callback: (data: T | null) => void
  ): () => void {
    const docRef = this.api.doc(this.getFirestoreInstance(), collectionName, id);
    return this.api.onSnapshot(docRef, snapshot => {
      callback(snapshot.exists() ? (snapshot.data() as T) : null);
    });
  }

  subscribeQuery<T>(
    collectionName: string,
    options: QueryOptions,
    callback: (data: T[]) => void
  ): () => void {
    const constraints = this.buildConstraints(options);
    const collectionRef = this.api.collection(this.getFirestoreInstance(), collectionName);
    return this.api.onSnapshot(this.api.query(collectionRef, ...constraints), snapshot => {
      callback(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as T));
    });
  }

  async runBatch(operations: (batch: IDatabaseBatch) => void): Promise<void> {
    const firestore = this.getFirestoreInstance();
    const batch = this.api.writeBatch(firestore);
    const dbBatch: IDatabaseBatch = {
      set: (collectionName, id, data, options) => {
        const docRef = this.api.doc(firestore, collectionName, id) as DocumentReference<
          Record<string, unknown>
        >;
        if (options?.merge) {
          batch.set(docRef, data as WithFieldValue<Record<string, unknown>>, { merge: true });
          return;
        }
        batch.set(docRef, data as WithFieldValue<Record<string, unknown>>);
      },
      update: (collectionName, id, data) =>
        batch.update(
          this.api.doc(firestore, collectionName, id) as DocumentReference<Record<string, unknown>>,
          data as UpdateData<Record<string, unknown>>
        ),
      delete: (collectionName, id) => batch.delete(this.api.doc(firestore, collectionName, id)),
    };

    operations(dbBatch);
    await batch.commit();
  }

  private buildConstraints(options?: QueryOptions): FirebaseQueryConstraint[] {
    const constraints: FirebaseQueryConstraint[] = [];

    if (options?.where) {
      options.where.forEach(item => {
        constraints.push(this.api.where(item.field, item.operator, item.value));
      });
    }

    if (options?.orderBy) {
      options.orderBy.forEach(item => {
        constraints.push(this.api.orderBy(item.field, item.direction));
      });
    }

    if (options?.limit) {
      constraints.push(this.api.limit(options.limit));
    }

    if (options?.startAfter) {
      constraints.push(this.api.startAfter(options.startAfter));
    }

    return constraints;
  }
}
