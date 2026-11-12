import 'fake-indexeddb/auto';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { saveErrorLog, getErrorLogs } from '@/services/storage/indexeddb/indexedDbErrorLogService';
import {
  reconcileAuthorizedSessionOwner,
  clearSessionScopedClientState,
} from '@/services/storage/sessionScopedStorageService';
import {
  getSessionGeneration,
  setSessionGeneration,
  onSessionChange,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  recordOperationalTelemetry,
  getOperationalTelemetryEvents,
  clearOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetryRecorder';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import { LocalErrorLogsView } from '@/features/admin/components/LocalErrorLogsView';
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn().mockResolvedValue(true),
}));
const auth = vi.hoisted(() => ({ role: 'viewer' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
const event = {
  category: 'sync' as const,
  status: 'failed' as const,
  operation: 'firestore_write' as const,
  context: { patientName: 'SYNTHETIC PATIENT A' },
};
const log = {
  id: 'synthetic-a',
  timestamp: '2026-11-12T12:00:00Z',
  severity: 'medium' as const,
  message: 'SYNTHETIC ERROR A',
};
beforeEach(async () => {
  auth.role = 'viewer';
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
  clearOperationalTelemetryEvents();
  await hospitalDB.errorLogs.clear();
  await reconcileAuthorizedSessionOwner('user:synthetic-a');
  vi.clearAllMocks();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await hospitalDB.errorLogs.clear();
  localStorage.clear();
  setSessionGeneration(null);
  clearOperationalTelemetryEvents();
});
it.each(['admin', 'viewer', 'editor', 'nurse_hospital', 'doctor_urgency', 'doctor_specialist'])(
  'support screen for %s',
  async role => {
    auth.role = role;
    await saveErrorLog(log);
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner('user:synthetic-admin');
    render(<LocalErrorLogsView />);
    if (role === 'admin') await screen.findByText(log.message);
    else await screen.findByText('No hay errores locales registrados para tu usuario.');
  }
);
it('old tab retains its admitted owner when B replaces shared storage', async () => {
  const admitted = getSessionGeneration();
  // Other document writes the shared origin keys; this document has not admitted B.
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-b');
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation-b');
  expect(getSessionGeneration()).toBe(admitted);
  recordOperationalTelemetry(event);
  await saveErrorLog(log);
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  expect(
    getOperationalTelemetryEvents().some(e => e.context?.patientName === 'SYNTHETIC PATIENT A')
  ).toBe(false);
  expect((await getErrorLogs()).some(e => e.id === log.id)).toBe(false);
});
it('bootstrap with retained shared owner leaves events unattributed', async () => {
  setSessionGeneration(null);
  recordOperationalTelemetry(event);
  await saveErrorLog(log);
  await reconcileAuthorizedSessionOwner('user:synthetic-a');
  expect(getOperationalTelemetryEvents()).toHaveLength(0);
  expect(await getErrorLogs()).toHaveLength(0);
});
it('no-owner events are retained but hidden from ordinary readers', async () => {
  await clearSessionScopedClientState('manual');
  clearOperationalTelemetryEvents();
  recordOperationalTelemetry(event);
  await saveErrorLog(log);
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  expect(getOperationalTelemetryEvents()).toHaveLength(0);
  expect(await getErrorLogs()).toHaveLength(0);
  expect(await hospitalDB.errorLogs.count()).toBe(1);
});
it('owner storage read failure must not suppress external dispatch', () => {
  const original = vi.mocked(localStorage.getItem).getMockImplementation()!;
  vi.spyOn(localStorage, 'getItem').mockImplementation(k => {
    if (k === SESSION_OWNER_KEY) throw new Error('synthetic storage denied');
    return original(k);
  });
  try {
    expect(() => recordOperationalTelemetry(event)).not.toThrow();
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledTimes(1);
  } finally {
    vi.mocked(localStorage.getItem).mockImplementation(original);
  }
});
it('A outbound payload remains identical during B and return A', async () => {
  recordOperationalTelemetry(event);
  const sent = structuredClone(vi.mocked(dispatchOperationalTelemetryExternally).mock.calls[0][0]);
  expect(sent).not.toHaveProperty('localOwnerKey');
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  expect(vi.mocked(dispatchOperationalTelemetryExternally).mock.calls[0][0]).toEqual(sent);
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:synthetic-a');
  expect(
    getOperationalTelemetryEvents().some(e => e.context?.patientName === 'SYNTHETIC PATIENT A')
  ).toBe(true);
});

it('event during logout retains A and event after logout remains unowned', async () => {
  await clearSessionScopedClientState('manual', async () => {
    await saveErrorLog({ ...log, id: 'during-logout' });
  });
  await saveErrorLog({ ...log, id: 'after-logout' });
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  expect((await getErrorLogs()).map(e => e.id)).toEqual([]);
  await clearSessionScopedClientState('manual');
  await reconcileAuthorizedSessionOwner('user:synthetic-a');
  expect((await getErrorLogs()).map(e => e.id)).toEqual(['during-logout']);
});
it('session-change listener records admitted B owner', async () => {
  await clearSessionScopedClientState('manual');
  clearOperationalTelemetryEvents();
  const off = onSessionChange(() => recordOperationalTelemetry(event));
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  off();
  expect(getOperationalTelemetryEvents()).toHaveLength(1);
});

it('restricted storage without admission retains unowned errors and still dispatches', async () => {
  setSessionGeneration(null);
  const original = vi.mocked(localStorage.getItem).getMockImplementation()!;
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('synthetic storage denied');
  });
  try {
    expect(() => recordOperationalTelemetry(event)).not.toThrow();
    await saveErrorLog(log);
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.errorLogs.get(log.id)).toMatchObject({ localOwnerKey: null });
  } finally {
    vi.mocked(localStorage.getItem).mockImplementation(original);
  }
  await reconcileAuthorizedSessionOwner('user:synthetic-b');
  expect(getOperationalTelemetryEvents().filter(e => e.operation === event.operation)).toEqual([]);
  expect(await getErrorLogs()).toEqual([]);
  expect((await getErrorLogs(50, 'admin')).map(e => e.id)).toContain(log.id);
});
