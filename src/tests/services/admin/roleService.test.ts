import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpsCallable } from 'firebase/functions';

const getDocMock = vi.fn();
const setDocMock = vi.fn();
const getFunctionsMock = vi.fn();
const callableMock = vi.fn();

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDoc: (...args: unknown[]) => getDocMock(...args),
    setDoc: (...args: unknown[]) => setDocMock(...args),
  },
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: (...args: unknown[]) => getFunctionsMock(...args),
  },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

import { createRoleService, roleService } from '@/services/admin/roleService';

describe('roleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocMock.mockResolvedValue({});
    setDocMock.mockResolvedValue(undefined);
    getFunctionsMock.mockResolvedValue({ name: 'functions' });
    callableMock.mockResolvedValue({ data: { success: true, message: 'synced' } });
    vi.mocked(httpsCallable).mockReturnValue(callableMock as never);
  });

  it('normalizes legacy role aliases from config/roles and writes back the canonical map', async () => {
    getDocMock.mockResolvedValue({
      'legacy.viewer@hospital.cl': 'viewer_census',
      'editor@hospital.cl': 'editor',
    });

    await expect(roleService.getRolesSnapshot()).resolves.toEqual({
      roles: {
        'legacy.viewer@hospital.cl': 'viewer',
        'editor@hospital.cl': 'editor',
      },
      migratedLegacyEntries: ['legacy.viewer@hospital.cl'],
    });

    expect(setDocMock).toHaveBeenCalledWith('config', 'roles', {
      'legacy.viewer@hospital.cl': 'viewer',
      'editor@hospital.cl': 'editor',
    });
  });

  it('canonicalizes lingering legacy aliases before persisting a managed role mutation', async () => {
    getDocMock.mockResolvedValue({
      'legacy.viewer@hospital.cl': 'viewer_census',
      'editor@hospital.cl': 'editor',
    });

    await roleService.setRole('nurse@hospital.cl', 'nurse_hospital');

    expect(setDocMock).toHaveBeenCalledWith('config', 'roles', {
      'legacy.viewer@hospital.cl': 'viewer',
      'editor@hospital.cl': 'editor',
      'nurse@hospital.cl': 'nurse_hospital',
    });
  });

  it('preserves an explicit revocation while hiding it from the active roles list', async () => {
    getDocMock.mockResolvedValue({
      'nurse@example.test': 'nurse_hospital',
      'other@example.test': 'viewer',
    });
    await roleService.removeRole(' NURSE@example.test ');
    expect(setDocMock).toHaveBeenCalledWith('config', 'roles', {
      'nurse@example.test': 'unauthorized',
      'other@example.test': 'viewer',
    });
    getDocMock.mockResolvedValue(setDocMock.mock.calls[0][2]);
    await expect(roleService.getRoles()).resolves.toEqual({ 'other@example.test': 'viewer' });
    await roleService.setRole('nurse@example.test', 'nurse_hospital');
    expect(setDocMock).toHaveBeenLastCalledWith('config', 'roles', {
      'nurse@example.test': 'nurse_hospital',
      'other@example.test': 'viewer',
    });
  });

  it('force-syncs a user role through an injected functions runtime', async () => {
    const service = createRoleService(
      {
        getDoc: getDocMock,
        setDoc: setDocMock,
      },
      {
        getFunctions: getFunctionsMock,
      }
    );

    await expect(service.forceSyncUser('nurse@hospital.cl', 'nurse_hospital')).resolves.toEqual({
      success: true,
      message: 'synced',
    });

    expect(getFunctionsMock).toHaveBeenCalledTimes(1);
    expect(httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'setUserRole');
    expect(callableMock).toHaveBeenCalledWith({
      email: 'nurse@hospital.cl',
      role: 'nurse_hospital',
    });
  });

  it('preserves the default singleton API for existing consumers', async () => {
    await expect(roleService.forceSyncUser('admin@hospital.cl', 'admin')).resolves.toEqual({
      success: true,
      message: 'synced',
    });
  });
});
