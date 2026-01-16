import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    writeBatch,
    QueryConstraint as FirebaseQueryConstraint,
    startAfter,
    Firestore
} from 'firebase/firestore';
import { db as firebaseDb } from '../../../firebaseConfig';
import {
    IDatabaseProvider,
    QueryOptions,
    IDatabaseBatch,
    QueryConstraint,
    OrderByConstraint
} from './types';

export class FirestoreProvider implements IDatabaseProvider {
    private db: Firestore;

    constructor(db: Firestore = firebaseDb) {
        this.db = db;
    }

    async getDoc<T>(collectionName: string, id: string): Promise<T | null> {
        const docRef = doc(this.db, collectionName, id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? (docSnap.data() as T) : null;
    }

    async getDocs<T>(collectionName: string, options?: QueryOptions): Promise<T[]> {
        const constraints = this.buildConstraints(options);
        const q = query(collection(this.db, collectionName), ...constraints);
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
    }

    async setDoc<T>(collectionName: string, id: string, data: T): Promise<void> {
        const docRef = doc(this.db, collectionName, id);
        await setDoc(docRef, data as any);
    }

    async updateDoc(collectionName: string, id: string, data: Record<string, any>): Promise<void> {
        const docRef = doc(this.db, collectionName, id);
        await updateDoc(docRef, data);
    }

    async deleteDoc(collectionName: string, id: string): Promise<void> {
        const docRef = doc(this.db, collectionName, id);
        await deleteDoc(docRef);
    }

    subscribeDoc<T>(collectionName: string, id: string, callback: (data: T | null) => void): () => void {
        const docRef = doc(this.db, collectionName, id);
        return onSnapshot(docRef, (docSnap) => {
            callback(docSnap.exists() ? (docSnap.data() as T) : null);
        });
    }

    subscribeQuery<T>(collectionName: string, options: QueryOptions, callback: (data: T[]) => void): () => void {
        const constraints = this.buildConstraints(options);
        const q = query(collection(this.db, collectionName), ...constraints);
        return onSnapshot(q, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T)));
        });
    }

    async runBatch(operations: (batch: IDatabaseBatch) => void): Promise<void> {
        const batch = writeBatch(this.db);
        const dbBatch: IDatabaseBatch = {
            set: (col, id, data) => batch.set(doc(this.db, col, id), data as any),
            update: (col, id, data) => batch.update(doc(this.db, col, id), data),
            delete: (col, id) => batch.delete(doc(this.db, col, id))
        };
        operations(dbBatch);
        await batch.commit();
    }

    private buildConstraints(options?: QueryOptions): FirebaseQueryConstraint[] {
        const constraints: FirebaseQueryConstraint[] = [];

        if (options?.where) {
            options.where.forEach(w => {
                constraints.push(where(w.field, w.operator, w.value));
            });
        }

        if (options?.orderBy) {
            options.orderBy.forEach(o => {
                constraints.push(orderBy(o.field, o.direction));
            });
        }

        if (options?.limit) {
            constraints.push(limit(options.limit));
        }

        if (options?.startAfter) {
            constraints.push(startAfter(options.startAfter));
        }

        return constraints;
    }
}
