import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  SnapshotMetadata,
} from 'firebase/firestore';

export interface MockSnapshotMetadataInput {
  fromCache?: boolean;
  hasPendingWrites?: boolean;
}

const buildMetadata = (input?: MockSnapshotMetadataInput): SnapshotMetadata => ({
  fromCache: input?.fromCache ?? false,
  hasPendingWrites: input?.hasPendingWrites ?? false,
  isEqual: () => false,
});

export const createMockDocRef = <TData extends DocumentData = DocumentData>(
  path = 'hospitals/hanga_roa/dailyRecords/2026-01-01',
  extra: Record<string, unknown> = {}
): DocumentReference<TData> =>
  ({
    type: 'document',
    id: path.split('/').at(-1) ?? 'doc',
    path,
    ...extra,
  }) as DocumentReference<TData>;

export const createMockCollectionRef = <TData extends DocumentData = DocumentData>(
  path = 'hospitals/hanga_roa/dailyRecords'
): CollectionReference<TData> =>
  ({
    type: 'collection',
    id: path.split('/').at(-1) ?? 'collection',
    path,
  }) as CollectionReference<TData>;

export const createMockQuery = <TData extends DocumentData = DocumentData>(): Query<TData> =>
  ({
    type: 'query',
  }) as Query<TData>;

export const createMockDocSnapshot = <TData extends DocumentData = DocumentData>(
  data: TData | undefined,
  options: {
    id?: string;
    exists?: boolean;
    metadata?: MockSnapshotMetadataInput;
  } = {}
): DocumentSnapshot<TData> => {
  const present = options.exists ?? data !== undefined;
  return {
    id: options.id ?? 'doc',
    exists: () => present,
    data: () => (present ? data : undefined),
    get: (field: string) =>
      present && data && typeof data === 'object'
        ? (data as Record<string, unknown>)[field]
        : undefined,
    metadata: buildMetadata(options.metadata),
    ref: createMockDocRef<TData>(options.id),
  } as DocumentSnapshot<TData>;
};

export const createMockQuerySnapshot = <TData extends DocumentData = DocumentData>(
  docs: Array<{ id: string; data: TData }>,
  metadata?: MockSnapshotMetadataInput
): QuerySnapshot<TData> => {
  const snapshotMetadata = buildMetadata(metadata);
  const queryDocs = docs.map(
    entry =>
      ({
        id: entry.id,
        exists: () => true,
        data: () => entry.data,
        get: (field: string) => (entry.data as Record<string, unknown>)[field],
        metadata: snapshotMetadata,
        ref: createMockDocRef<TData>(entry.id),
      }) as QueryDocumentSnapshot<TData>
  );

  return {
    query: createMockQuery<TData>(),
    docs: queryDocs,
    empty: queryDocs.length === 0,
    size: queryDocs.length,
    metadata: snapshotMetadata,
    forEach: (callback: (doc: QueryDocumentSnapshot<TData>) => void) => queryDocs.forEach(callback),
    docChanges: () => [],
    toJSON: () => ({}),
  } as QuerySnapshot<TData>;
};
