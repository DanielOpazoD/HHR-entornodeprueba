import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test case
afterEach(() => {
    cleanup();
});

// Mock localStorage and sessionStorage for JSDOM
// We use a more direct approach here to ensure availability during module evaluation
const storageMock = () => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value.toString(); }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { store = {}; }),
        length: 0,
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

// Mock Firebase Auth user
const mockUser = {
    uid: 'test-user-123',
    email: 'test@hospital.cl',
    displayName: 'Test User',
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
};

// Mock Firebase Auth
const mockAuth = {
    currentUser: mockUser,
    onAuthStateChanged: vi.fn((callback: (user: typeof mockUser | null) => void) => {
        callback(mockUser);
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
    firebaseReady: Promise.resolve({ auth: mockAuth, db: mockFirestore }),
    mountConfigWarning: () => { }
};

// Use @ alias or absolute relative paths
vi.mock('@/firebaseConfig', () => firebaseMock);
vi.mock('../firebaseConfig', () => firebaseMock);

// Mock firebase/auth module
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => mockAuth),
    onAuthStateChanged: vi.fn((auth, callback) => {
        callback(mockUser);
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
    class MockTimestamp {
        constructor(public seconds: number, public nanoseconds: number) { }
        static now() { return new MockTimestamp(Math.floor(Date.now() / 1000), 0); }
        static fromDate(date: Date) { return new MockTimestamp(Math.floor(date.getTime() / 1000), 0); }
        toDate() { return new Date(this.seconds * 1000); }
        toMillis() { return this.seconds * 1000; }
        toISOString() { return this.toDate().toISOString(); }
    }

    return {
        collection: vi.fn(() => ({})),
        doc: vi.fn(() => ({})),
        getDoc: vi.fn().mockResolvedValue(mockDoc),
        getDocs: vi.fn().mockResolvedValue({ docs: [], empty: true }),
        setDoc: vi.fn().mockResolvedValue(undefined),
        updateDoc: vi.fn().mockResolvedValue(undefined),
        deleteDoc: vi.fn().mockResolvedValue(undefined),
        query: vi.fn(() => ({})),
        where: vi.fn(() => ({})),
        onSnapshot: vi.fn(() => vi.fn()),
        orderBy: vi.fn(() => ({})),
        limit: vi.fn(() => ({})),
        startAfter: vi.fn(() => ({})),
        Timestamp: MockTimestamp,
        runTransaction: vi.fn(),
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
        size: 1024
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
    AUDIT_ACTION_LABELS: {}
};

// Use factory function to prevent shared state issues across different imports
const mockAuditFactory = () => mockAuditService;

vi.mock('@/services/admin/auditService', () => mockAuditFactory());
vi.mock('../services/admin/auditService', () => mockAuditFactory());

vi.mock('@/services/repositories/DailyRecordRepository', () => ({
    CatalogRepository: {
        getNurses: vi.fn().mockResolvedValue(["Enfermero/a 1", "Enfermero/a 2", "Test Nurse"]),
        saveNurses: vi.fn().mockResolvedValue(undefined),
        subscribeNurses: vi.fn((cb) => {
            cb(["Enfermero/a 1", "Enfermero/a 2", "Test Nurse"]);
            return () => { };
        }),
        getTens: vi.fn().mockResolvedValue(["TENS 1", "TENS 2"]),
        saveTens: vi.fn().mockResolvedValue(undefined),
        subscribeTens: vi.fn((cb) => {
            cb(["TENS 1", "TENS 2"]);
            return () => { };
        }),
    },
    DailyRecordRepository: {
        getForDate: vi.fn(),
        getPreviousDay: vi.fn(),
        save: vi.fn(),
        subscribe: vi.fn(),
        initializeDay: vi.fn(),
        deleteDay: vi.fn(),
    },
    setDemoModeActive: vi.fn(),
    isDemoModeActive: vi.fn().mockReturnValue(false),
    setFirestoreEnabled: vi.fn(),
}));

// Mock authService globally
const mockAuthService = {
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    onAuthChange: vi.fn((cb) => {
        cb(mockUser);
        return () => { };
    }),
    getCurrentUser: vi.fn(() => mockUser),
    isCurrentUserAllowed: vi.fn().mockResolvedValue(true),
    createUser: vi.fn(),
    signInAnonymouslyForPassport: vi.fn().mockResolvedValue('anonymous-uid'),
    hasActiveFirebaseSession: vi.fn().mockReturnValue(true),
};

const mockAuthFactory = () => mockAuthService;

vi.mock('@/services/auth/authService', () => mockAuthFactory());
vi.mock('../services/auth/authService', () => mockAuthFactory());

// Mock AuthContext and useAuth
const mockAuthContextValue = {
    user: mockUser,
    role: 'admin' as const,
    isLoading: false,
    isAuthenticated: true,
    isEditor: true,
    isViewer: false,
    isOfflineMode: false,
    isFirebaseConnected: true,
    signOut: vi.fn().mockResolvedValue(undefined),
    canDownloadPassport: true,
    handleDownloadPassport: vi.fn().mockResolvedValue(true),
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
    logPatientView: vi.fn(),
    logUserLogin: vi.fn(),
    logUserLogout: vi.fn(),
    logEvent: vi.fn(),
    logDebouncedEvent: vi.fn(),
    fetchLogs: vi.fn().mockResolvedValue([]),
    getActionLabel: vi.fn().mockReturnValue(''),
    userId: 'test-user-123'
};

vi.mock('@/context/AuditContext', () => ({
    AuditProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuditContext: () => mockAuditContextValue
}));

vi.mock('../context/AuditContext', () => ({
    AuditProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuditContext: () => mockAuditContextValue
}));

// Mock VersionContext
const mockVersionContextValue = {
    isOutdated: false,
    appVersion: 1,
    remoteVersion: 1,
    checkVersion: vi.fn(),
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
export { mockUser, mockAuth, mockFirestore, mockAuditContextValue, mockAuthContextValue, mockAuditService, mockAuthService };
