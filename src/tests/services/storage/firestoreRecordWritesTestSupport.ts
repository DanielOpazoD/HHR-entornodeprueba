import { vi } from 'vitest';
const { firestoreWriteLoggerWarn, firestoreWriteLoggerError } = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
}));
const { mockEnsureUserRoleClaim, mockResolveFirebaseUserRole, mockGetCurrentUser, mockAuthReady } =
  vi.hoisted(() => ({
    mockEnsureUserRoleClaim: vi.fn(),
    mockResolveFirebaseUserRole: vi.fn(),
    mockGetCurrentUser: vi.fn(),
    mockAuthReady: Promise.resolve(),
  }));
const { mockHttpsCallable, mockSpecialistCallable, mockGetFunctions } = vi.hoisted(() => ({
  mockHttpsCallable: vi.fn(),
  mockSpecialistCallable: vi.fn(),
  mockGetFunctions: vi.fn().mockResolvedValue({ name: 'functions-runtime' }),
}));
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());

    toDate = () => new Date('2026-03-14T12:34:56.789Z');
  }

  return {
    ...actual,
    getDoc: vi.fn(),
    collection: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn(),
    Timestamp: MockTimestamp,
    updateDoc: vi.fn(),
  };
});
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));
vi.mock('@/utils/networkUtils', () => ({
  withRetry: vi.fn((operation: () => Promise<unknown> | unknown) => operation()),
}));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  flattenObject: vi.fn((value: Record<string, unknown>) => value),
  getRecordDocRef: vi.fn((date: string) => ({ date })),
  sanitizeForFirestore: vi.fn((value: unknown) => value),
}));
vi.mock('@/services/storage/firestore/firestoreWriteSupport', async () => ({
  ConcurrencyError: (await import('@/services/storage/syncErrorCatalog')).ConcurrencyError,
  asFirestoreUpdatePayload: vi.fn((payload: Record<string, unknown>) => payload),
  assertFirestoreConcurrency: vi.fn(),
  createDeletedRecordRef: vi.fn((date: string) => ({ trashRef: date })),
  saveHistorySnapshot: vi.fn(),
  saveRecordAtomically: vi.fn(),
  updateRecordPartiallyAtomically: vi.fn(),
}));
vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreWriteLogger: {
    warn: firestoreWriteLoggerWarn,
    error: firestoreWriteLoggerError,
  },
}));
vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: (...args: unknown[]) => mockEnsureUserRoleClaim(...args),
}));
vi.mock('@/services/auth/authAccessResolution', () => ({
  resolveFirebaseUserRole: (...args: unknown[]) => mockResolveFirebaseUserRole(...args),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: mockAuthReady,
    getCurrentUser: () => mockGetCurrentUser(),
  },
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: () => mockGetFunctions(),
    getRegionalFunctions: () => mockGetFunctions(),
  },
}));
const specialistHandoffTargets = [
  {
    bedId: 'R4',
    target: 'bed' as const,
    clinicalEpisodeId: 'synthetic-episode-A',
    patientName: 'Paciente A Sintético',
    rut: '99.999.999-9',
    documentType: 'RUT',
  },
];
const specialistSnapshot = (episode = 'synthetic-episode-A') => ({
  exists: () => true,
  data: () => ({ beds: { R4: { ...specialistHandoffTargets[0], clinicalEpisodeId: episode } } }),
});

export {
  firestoreWriteLoggerWarn,
  firestoreWriteLoggerError,
  mockEnsureUserRoleClaim,
  mockResolveFirebaseUserRole,
  mockGetCurrentUser,
  mockHttpsCallable,
  mockSpecialistCallable,
  mockGetFunctions,
  specialistHandoffTargets,
  specialistSnapshot,
};
