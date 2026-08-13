import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { wrapConsoleForOperationalNoise } from '@/tests/utils/operationalConsoleNoiseFilter';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

wrapConsoleForOperationalNoise(['log', 'warn', 'error', 'info', 'debug']);

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Mock localStorage and sessionStorage for JSDOM
// We use a more direct approach here to ensure availability during module evaluation
const storageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    ),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
};

const mockLS = storageMock();
const mockSS = storageMock();

// Stub globals before any other imports
vi.stubGlobal('localStorage', mockLS);
vi.stubGlobal('sessionStorage', mockSS);

// Force them onto global object too
Object.defineProperty(global, 'localStorage', { value: mockLS, configurable: true });
Object.defineProperty(global, 'sessionStorage', { value: mockSS, configurable: true });

// Mock Worker for Vitest environment
class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}
vi.stubGlobal('Worker', MockWorker);
Object.defineProperty(global, 'Worker', { value: MockWorker, configurable: true });

// Mock crypto.randomUUID
if (!global.crypto) {
  Object.defineProperty(global, 'crypto', {
    value: { randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000000') },
    configurable: true,
    writable: true,
  });
} else if (!global.crypto.randomUUID) {
  Object.defineProperty(global.crypto, 'randomUUID', {
    value: vi.fn(() => '00000000-0000-0000-0000-000000000000'),
    configurable: true,
    writable: true,
  });
}

// Mock Firebase Auth user
const mockUser = {
  uid: 'test-user-123',
  email: 'test@hospital.cl',
  displayName: 'Test User',
  getIdToken: vi.fn().mockResolvedValue('mock-token'),
};

// Mock Firebase Auth
const mockAuth = {
  currentUser: null as typeof mockUser | null,
  onAuthStateChanged: vi.fn((callback: (user: typeof mockUser | null) => void) => {
    callback(null);
    return vi.fn();
  }),
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: mockUser }),
  signOut: vi.fn().mockResolvedValue(undefined),
  onIdTokenChanged: vi.fn(() => vi.fn()),
};

// Mock Firestore
const mockDoc = {
  id: 'mock-doc-id',
  data: () => ({}),
  exists: () => true,
};

const mockFirestore = {
  collection: vi.fn(() => ({
    doc: vi.fn(() => ({
      get: vi.fn().mockResolvedValue(mockDoc),
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onSnapshot: vi.fn(() => vi.fn()),
    })),
    add: vi.fn().mockResolvedValue({ id: 'new-doc-id' }),
    where: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({ docs: [] }),
      onSnapshot: vi.fn(() => vi.fn()),
    })),
  })),
  doc: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(mockDoc),
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn(() => vi.fn()),
  })),
};

// Mock Firebase to prevent initialization errors in tests
const firebaseMock = {
  auth: mockAuth,
  db: mockFirestore,
  storage: {},
  functions: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
  firebaseReady: Promise.resolve({ auth: mockAuth, db: mockFirestore }),
  mountConfigWarning: () => {},
};

// Use @ alias or absolute relative paths
vi.mock('@/firebaseConfig', () => firebaseMock);
vi.mock('../firebaseConfig', () => firebaseMock);

// Mock firebase/auth module
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => mockAuth),
  onAuthStateChanged: vi.fn((auth, callback) => {
    callback(null);
    return vi.fn();
  }),
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: mockUser }),
  signOut: vi.fn().mockResolvedValue(undefined),
  onIdTokenChanged: vi.fn(() => vi.fn()),
  GoogleAuthProvider: class {
    static credential = vi.fn();
    setCustomParameters = vi.fn();
  },
  signInAnonymously: vi.fn().mockResolvedValue({ user: { uid: 'anon-123', isAnonymous: true } }),
  signInWithPopup: vi.fn().mockResolvedValue({ user: mockUser }),
  createUserWithEmailAndPassword: vi.fn().mockResolvedValue({ user: mockUser }),
}));

// Mock firestore module
vi.mock('firebase/firestore', () => {
  const mockSnap = {
    id: 'mock-doc-id',
    data: () => ({}),
    exists: () => true,
    get: (_field: string) => undefined,
  };

  class MockTimestamp {
    constructor(
      public seconds: number,
      public nanoseconds: number
    ) {}
    static now() {
      return new MockTimestamp(Math.floor(Date.now() / 1000), 0);
    }
    static fromDate(date: Date) {
      return new MockTimestamp(Math.floor(date.getTime() / 1000), 0);
    }
    toDate() {
      return new Date(this.seconds * 1000);
    }
    toMillis() {
      return this.seconds * 1000;
    }
    toISOString() {
      return this.toDate().toISOString();
    }
  }

  return {
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    doc: vi.fn(() => ({ id: 'mock-doc-path' })),
    getDoc: vi.fn().mockResolvedValue(mockSnap),
    getDocs: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    onSnapshot: vi.fn(() => vi.fn(() => {})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    startAfter: vi.fn(() => ({})),
    Timestamp: MockTimestamp,
    runTransaction: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock storage module
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: vi.fn(() => ({
    fullPath: 'mock-path',
    name: 'mock-file',
  })),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://mock-download-url.com'),
  listAll: vi.fn().mockResolvedValue({ prefixes: [], items: [] }),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  getMetadata: vi.fn().mockResolvedValue({
    customMetadata: {},
    timeCreated: new Date().toISOString(),
    size: 1024,
  }),
}));

// Mock auditService globally
const mockAuditService = {
  logAuditEvent: vi.fn(),
  logUserLogin: vi.fn(),
  logUserLogout: vi.fn(),
  logPatientAdmission: vi.fn(),
  logPatientDischarge: vi.fn(),
  logPatientTransfer: vi.fn(),
  logPatientCleared: vi.fn(),
  logPatientView: vi.fn(),
  logDailyRecordDeleted: vi.fn(),
  logDailyRecordCreated: vi.fn(),
  logSystemError: vi.fn(),
  getAuditLogs: vi.fn().mockResolvedValue([]),
  getAuditLogsForDate: vi.fn().mockResolvedValue([]),
  getLocalAuditLogs: vi.fn().mockReturnValue([]),
};

// Use factory function to prevent shared state issues across different imports
const mockAuditFactory = () => mockAuditService;

vi.mock('@/services/admin/auditService', () => mockAuditFactory());
vi.mock('../services/admin/auditService', () => mockAuditFactory());

const globalCatalogRepositoryMock = {
  getNurses: vi.fn().mockResolvedValue(['Enfermero/a 1', 'Enfermero/a 2', 'Test Nurse']),
  saveNurses: vi.fn().mockResolvedValue(undefined),
  subscribeNurses: vi.fn(cb => {
    cb(['Enfermero/a 1', 'Enfermero/a 2', 'Test Nurse']);
    return () => {};
  }),
  getTens: vi.fn().mockResolvedValue(['TENS 1', 'TENS 2']),
  saveTens: vi.fn().mockResolvedValue(undefined),
  subscribeTens: vi.fn(cb => {
    cb(['TENS 1', 'TENS 2']);
    return () => {};
  }),
};

const globalDailyRecordRepositoryPortMock = {
  getForDate: vi.fn().mockResolvedValue(null),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  save: vi.fn(),
  saveDetailed: vi.fn().mockResolvedValue({
    date: '2026-01-01',
    outcome: 'clean',
    savedLocally: true,
    savedRemotely: true,
    queuedForRetry: false,
    autoMerged: false,
  }),
  subscribe: vi.fn(() => () => {}),
  subscribeDetailed: vi.fn(() => () => {}),
  initializeDay: vi.fn(),
  initializeDayDetailed: vi.fn(),
  deleteDay: vi.fn(),
  getAllDates: vi.fn().mockResolvedValue([]),
  getAvailableDates: vi.fn().mockResolvedValue([]),
  getMonthRecords: vi.fn().mockResolvedValue([]),
  copyPatientToDate: vi.fn().mockResolvedValue(true),
  copyPatientToDateDetailed: vi.fn().mockResolvedValue({
    sourceDate: '2026-01-01',
    targetDate: '2026-01-02',
    outcome: 'clean',
    sourceBedId: 'R1',
    targetBedId: 'R2',
    sourceCompatibilityIntensity: 'none',
    sourceMigrationRulesApplied: [],
  }),
  updatePartial: vi.fn().mockResolvedValue(undefined),
  updatePartialDetailed: vi.fn().mockResolvedValue({
    date: '2026-01-01',
    outcome: 'clean',
    savedLocally: true,
    updatedRemotely: true,
    queuedForRetry: false,
    autoMerged: false,
    patchedFields: 1,
  }),
  syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
    date: '2026-01-01',
    outcome: 'clean',
    record: null,
  }),
};

vi.mock('@/services/repositories/CatalogRepository', () => ({
  CatalogRepository: globalCatalogRepositoryMock,
  ...globalCatalogRepositoryMock,
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: globalDailyRecordRepositoryPortMock,
  defaultDailyRecordWritePort: {
    updatePartial: globalDailyRecordRepositoryPortMock.updatePartialDetailed,
    save: globalDailyRecordRepositoryPortMock.saveDetailed,
    delete: globalDailyRecordRepositoryPortMock.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: globalDailyRecordRepositoryPortMock.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: globalDailyRecordRepositoryPortMock,
}));

// DailyRecordContext is no longer mocked globally to allow customRender to provide real context
/*
vi.mock('@/context/DailyRecordContext', () => ({
    DailyRecordProvider: ({ children }: { children: React.ReactNode }) => children,
    useDailyRecordData: () => mockDailyRecordContextValue,
// ...
*/

// Mock StaffContext
const mockStaffContextValue = {
  nursesList: ['Enfermera 1', 'Enfermera 2'],
  tensList: ['TENS 1', 'TENS 2'],
  professionalsCatalog: [],
  refreshNurses: vi.fn(),
  refreshTens: vi.fn(),
  saveNurses: vi.fn(),
  saveTens: vi.fn(),
};

vi.mock('@/context/StaffContext', () => ({
  StaffProvider: ({ children }: { children: React.ReactNode }) => children,
  useStaffContext: () => mockStaffContextValue,
}));

vi.mock('../context/StaffContext', () => ({
  StaffProvider: ({ children }: { children: React.ReactNode }) => children,
  useStaffContext: () => mockStaffContextValue,
}));

// Mock useStabilityRules hook
const mockStabilityRules = {
  isDateLocked: false,
  isDayShiftLocked: false,
  isNightShiftLocked: false,
  canEditField: vi.fn().mockReturnValue(true),
  canPerformActions: true,
  lockReason: undefined,
};

vi.mock('@/hooks/useStabilityRules', () => ({
  useStabilityRules: () => mockStabilityRules,
}));

vi.mock('../hooks/useStabilityRules', () => ({
  useStabilityRules: () => mockStabilityRules,
}));

// Mock useAuthState hook
const mockAuthState = {
  sessionState: {
    status: 'authorized',
    user: mockUser,
  },
  currentUser: mockUser,
  authorizedUser: mockUser,
  user: mockUser,
  role: 'admin' as const,
  authLoading: false,
  isEditor: true,
  isViewer: false,
  isAuthenticated: true,
  isLoading: false,
  isFirebaseConnected: true,
};

vi.mock('@/hooks/useAuthState', () => ({
  useAuthState: () => mockAuthState,
}));

vi.mock('../hooks/useAuthState', () => ({
  useAuthState: () => mockAuthState,
}));

// Mock canonical auth entrypoints globally
const mockAuthFlow = {
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
  warmGoogleSignInRuntime: vi.fn(),
  createUser: vi.fn(),
};

const mockAuthSession = {
  signOut: vi.fn(),
  onAuthSessionStateChange: vi.fn(cb => {
    cb({ status: 'unauthenticated', user: null });
    return () => {};
  }),
  getCurrentAuthSessionState: vi.fn(() => ({ status: 'unauthenticated', user: null })),
  resolveCurrentAuthSessionState: vi.fn().mockResolvedValue({
    status: 'unauthenticated',
    user: null,
  }),
};

const mockAuthFallback = {
  signInWithGoogleRedirect: vi.fn(),
  handleSignInRedirectResult: vi.fn().mockResolvedValue(null),
  hasActiveFirebaseSession: vi.fn().mockReturnValue(false),
};

const mockAuthFlowFactory = () => mockAuthFlow;
const mockAuthSessionFactory = () => mockAuthSession;
const mockAuthFallbackFactory = () => mockAuthFallback;

vi.mock('@/services/auth/authFlow', () => mockAuthFlowFactory());
vi.mock('../services/auth/authFlow', () => mockAuthFlowFactory());
vi.mock('@/services/auth/authSession', () => mockAuthSessionFactory());
vi.mock('../services/auth/authSession', () => mockAuthSessionFactory());
vi.mock('@/services/auth/authFallback', () => mockAuthFallbackFactory());
vi.mock('../services/auth/authFallback', () => mockAuthFallbackFactory());

vi.mock('@/application/auth/authSessionUseCases', () => ({
  executeGoogleSignIn: vi.fn(),
  executeGoogleSignInWarmup: vi.fn(),
  executeCredentialSignIn: vi.fn(),
  executeRedirectAuthResolution: vi.fn().mockResolvedValue({
    status: 'success',
    data: null,
    issues: [],
  }),
  executeResolvedCurrentAuthSessionState: vi.fn().mockResolvedValue({
    status: 'success',
    data: null,
    issues: [],
  }),
  executeCurrentAuthSessionState: vi.fn(),
}));

// Mock AuthContext and useAuth
const mockAuthContextValue = {
  user: mockUser,
  role: 'admin' as const,
  isLoading: false,
  isAuthenticated: true,
  isEditor: true,
  isViewer: false,
  isFirebaseConnected: true,
  signOut: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuthContextValue,
  useCanEdit: () => true,
}));

vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuthContextValue,
  useCanEdit: () => true,
}));

// Mock AuditContext
const mockAuditContextValue = {
  logPatientAdmission: vi.fn(),
  logPatientDischarge: vi.fn(),
  logPatientTransfer: vi.fn(),
  logPatientCleared: vi.fn(),
  logDailyRecordDeleted: vi.fn(),
  logDailyRecordCreated: vi.fn(),
  logCudyrModified: vi.fn(),
  logHandoffNovedadesModified: vi.fn(),
  logMedicalHandoffModified: vi.fn(),
  logNurseHandoffModified: vi.fn(),
  logPatientView: vi.fn(),
  logClinicalDocumentCreated: vi.fn(),
  logClinicalDocumentEdited: vi.fn(),
  logClinicalDocumentDeleted: vi.fn(),
  logUserLogin: vi.fn(),
  logUserLogout: vi.fn(),
  logEvent: vi.fn(),
  logViewEvent: vi.fn(),
  logDebouncedEvent: vi.fn(),
  fetchLogs: vi.fn().mockResolvedValue([]),
  getActionLabel: vi.fn().mockReturnValue(''),
  userId: 'test-user-123',
};

vi.mock('@/context/AuditContext', () => ({
  AuditProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuditContext: () => mockAuditContextValue,
}));

vi.mock('../context/AuditContext', () => ({
  AuditProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuditContext: () => mockAuditContextValue,
}));

// Mock VersionContext
const mockVersionContextValue = {
  isOutdated: false,
  appVersion: 1,
  remoteVersion: 1,
  updateReason: 'current',
  runtimeContract: null,
  checkVersion: vi.fn(),
  checkRuntimeContract: vi.fn(),
  forceUpdate: vi.fn(),
};

vi.mock('@/context/VersionContext', () => ({
  VersionProvider: ({ children }: { children: React.ReactNode }) => children,
  useVersion: () => mockVersionContextValue,
}));

vi.mock('../context/VersionContext', () => ({
  VersionProvider: ({ children }: { children: React.ReactNode }) => children,
  useVersion: () => mockVersionContextValue,
}));

// Export mocks for use in tests
export {
  mockUser,
  mockAuth,
  mockFirestore,
  mockAuditContextValue,
  mockAuthContextValue,
  mockAuditService,
  mockAuthFlow,
  mockAuthSession,
  mockAuthFallback,
};
